from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from schemas.messages import WebSocketMessage, MessageType
from schemas.actions import ActionPlan
from core.planner import generate_plan, replan_after_failure
from core.protocol_engine import classify_plan_steps, has_critical_steps, get_critical_steps
from state.task_tracker import get_tracker, remove_tracker, StepState

logger = logging.getLogger(__name__)
router = APIRouter()

_pending_goals: dict[str, dict[str, Any]] = {}
_plan_cache: dict[str, ActionPlan] = {}


async def _safe_send(ws: WebSocket, data: dict) -> bool:
    """Send JSON over WebSocket, returning False if disconnected."""
    try:
        await ws.send_text(json.dumps(data))
        return True
    except WebSocketDisconnect:
        logger.warning("Client disconnected during send")
        return False
    except Exception as e:
        logger.warning("Send failed: %s", e)
        return False


@router.websocket("/ws/browser-agent")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    session_id: str | None = None
    logger.info("WebSocket connected")

    try:
        while True:
            try:
                raw = await ws.receive_text()
            except (WebSocketDisconnect, RuntimeError):
                logger.info("WebSocket closed during receive: %s", session_id)
                break
            try:
                data: dict[str, Any] = json.loads(raw)
            except json.JSONDecodeError:
                await _safe_send(ws, {
                    "type": "ERROR",
                    "session_id": "unknown",
                    "payload": {"code": "INVALID_JSON", "message": "Message is not valid JSON"},
                })
                continue

            try:
                msg = WebSocketMessage(**data)
            except Exception as e:
                await _safe_send(ws, {
                    "type": "ERROR",
                    "session_id": data.get("session_id", "unknown"),
                    "payload": {"code": "INVALID_ENVELOPE", "message": str(e)},
                })
                continue

            session_id = msg.session_id
            print(f"[WS] Received {msg.type.value} from {session_id}")
            logger.info("Received %s from %s", msg.type.value, session_id)

            try:
                await _route_message(ws, msg)
            except Exception as e:
                print(f"[WS] Error handling {msg.type.value}: {e}", flush=True)
                logger.exception("Error handling %s: %s", msg.type.value, e)
                await _safe_send(ws, {
                    "type": "ERROR",
                    "session_id": session_id or "unknown",
                    "payload": {"code": "INTERNAL_ERROR", "message": str(e)[:200]},
                })

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected: %s", session_id)
    except Exception as e:
        logger.exception("WebSocket error: %s", e)
    finally:
        if session_id:
            remove_tracker(session_id)
            _pending_goals.pop(session_id, None)
            _plan_cache.pop(session_id, None)
        try:
            await ws.close()
        except Exception:
            pass


async def _route_message(ws: WebSocket, msg: WebSocketMessage):
    handlers = {
        MessageType.USER_QUERY: _handle_user_query,
        MessageType.STEP_RESULT: _handle_step_result,
        MessageType.APPROVAL_RESPONSE: _handle_approval_response,
        MessageType.SESSION_RESTORE: _handle_session_restore,
        MessageType.PAUSE_AGENT: _handle_pause_agent,
        MessageType.RESUME_AGENT: _handle_resume_agent,
        MessageType.STOP_AGENT: _handle_stop_agent,
    }

    handler = handlers.get(msg.type)
    if handler:
        await handler(ws, msg)
    else:
        await _safe_send(ws, {
            "type": "ERROR",
            "session_id": msg.session_id,
            "payload": {"code": "UNKNOWN_TYPE", "message": f"Unhandled message type: {msg.type.value}"},
        })


# ---------------------------------------------------------------------------
# USER_QUERY
# ---------------------------------------------------------------------------

async def _handle_user_query(ws: WebSocket, msg: WebSocketMessage):
    payload = msg.payload
    goal = payload.get("query", "")
    url = payload.get("url", "")

    _pending_goals[msg.session_id] = {
        "goal": goal,
        "url": url,
        "viewport": payload.get("viewport", {}),
    }
    print(f"[WS] Stored goal for {msg.session_id}: {goal[:80]}")

    if payload.get("sanitized_dom") or payload.get("domSnapshot"):
        await _generate_plan_from_payload(ws, msg, payload)


# ---------------------------------------------------------------------------
# STEP_RESULT
# ---------------------------------------------------------------------------

async def _handle_step_result(ws: WebSocket, msg: WebSocketMessage):
    payload = msg.payload
    sanitized_dom = payload.get("sanitized_dom") or payload.get("domSnapshot")
    has_step_id = "step_id" in payload
    print(f"[WS] STEP_RESULT: has_dom={sanitized_dom is not None}, has_step_id={has_step_id}", flush=True)

    if sanitized_dom and not has_step_id:
        await _generate_plan_from_payload(ws, msg, payload)
    elif has_step_id:
        await _handle_step_execution_result(ws, msg)
    else:
        logger.warning("STEP_RESULT with no sanitized_dom and no step_id from %s", msg.session_id)


async def _generate_plan_from_payload(ws: WebSocket, msg: WebSocketMessage, payload: dict):
    from state.session_manager import get_session_manager

    session_id = msg.session_id

    pending = _pending_goals.pop(session_id, {})
    goal = pending.get("goal", "") or payload.get("query", "")
    url = pending.get("url", "") or payload.get("url", "")

    sanitized_dom = payload.get("sanitized_dom", {})
    if not sanitized_dom and payload.get("domSnapshot"):
        sanitized_dom = payload.get("domSnapshot", {})

    vault_manifest = payload.get("vault_manifest", {})
    if not vault_manifest and payload.get("tokenManifest"):
        token_manifest = payload.get("tokenManifest", {})
        token_types = token_manifest.get("token_types", {})
        fields = {}
        for token_key in token_manifest.get("tokens_used", []):
            pii_type = token_types.get(token_key, "unknown")
            fields[pii_type.lower()] = True
        vault_manifest = {"fields": fields, "locked": False}

    redacted_screenshot = payload.get("redacted_screenshot")

    manager = get_session_manager()
    manager.create_session(session_id, goal=goal)

    print(f"[WS] Generating plan for {session_id}: goal={goal[:50]}, elements={len(sanitized_dom.get('elements', []))}")

    # ACK immediately so client knows we're working
    await _safe_send(ws, {
        "type": "ACK",
        "session_id": session_id,
        "payload": {"status": "generating_plan", "message": "Processing your request..."},
    })

    try:
        plan = await generate_plan(
            goal=goal,
            url=url,
            sanitized_dom=sanitized_dom,
            vault_manifest=vault_manifest,
            session_id=session_id,
            redacted_screenshot=redacted_screenshot,
        )
    except Exception as e:
        print(f"[WS] Plan generation failed for {session_id}: {e}", flush=True)
        logger.exception("Plan generation failed for %s", session_id)
        await _safe_send(ws, {
            "type": "ERROR",
            "session_id": session_id,
            "payload": {"code": "PLAN_GENERATION_FAILED", "message": str(e)[:200]},
        })
        return

    classify_plan_steps(plan)

    _plan_cache[session_id] = plan

    tracker = get_tracker(session_id)
    step_ids = [s.id for s in plan.plan.steps]
    tracker.initialize_plan(plan_id=f"plan_{session_id}", step_ids=step_ids)

    manager.update_session(
        session_id,
        goal=goal,
        plan_id=f"plan_{session_id}",
        step_ids=step_ids,
    )

    if has_critical_steps(plan):
        critical_ids = {s.id for s in get_critical_steps(plan)}
        for step in plan.plan.steps:
            if step.id in critical_ids:
                tracker.mark_blocked_approval(step.id)

        await _safe_send(ws, _build_plan_payload(session_id, plan))

        critical = get_critical_steps(plan)
        first_critical = critical[0]
        await _safe_send(ws, {
            "type": "APPROVAL_REQUIRED",
            "session_id": session_id,
            "payload": {
                "step": _step_to_extension_format(first_critical),
                "reason": f"Step {first_critical.id}: {first_critical.description} — requires user approval",
                "vault_key": first_critical.vault_key,
            },
        })
        logger.info("Sent APPROVAL_REQUIRED for step %d", first_critical.id)
    else:
        await _safe_send(ws, _build_plan_payload(session_id, plan))
        await _dispatch_next_step(ws, session_id, plan)


# ---------------------------------------------------------------------------
# Plan & step dispatch
# ---------------------------------------------------------------------------

def _build_plan_payload(session_id: str, plan: ActionPlan) -> dict:
    return {
        "type": "PLAN",
        "session_id": session_id,
        "payload": {
            "goal": plan.goal,
            "plan": {
                "goal": plan.goal,
                "chain_of_thought": plan.plan.chain_of_thought,
                "total_steps": plan.plan.total_steps,
                "steps": [_step_to_extension_format(s) for s in plan.plan.steps],
            },
        },
    }


def _step_to_extension_format(step) -> dict:
    target = {}
    if step.target:
        if step.target.selector:
            target["selector"] = step.target.selector
        if step.target.coordinates:
            target["coordinates"] = step.target.coordinates
        if step.target.url:
            target["url"] = step.target.url
        if step.target.text:
            target["text"] = step.target.text
        if step.target.tab_id is not None:
            target["tab_id"] = step.target.tab_id

    result = {
        "id": step.id,
        "action": step.action.value,
        "target": target if target else None,
        "value": step.value,
        "key": step.key,
        "vault_key": step.vault_key,
        "execution_mode": step.execution_mode.value,
        "protocol_level": step.protocol_level,
        "description": step.description,
        "timeout_ms": step.timeout_ms,
    }

    if step.verify:
        result["verify"] = {
            "method": step.verify.method,
            "condition": step.verify.condition,
        }

    if step.duration_ms is not None:
        result["duration_ms"] = step.duration_ms

    return result


async def _dispatch_next_step(ws: WebSocket, session_id: str, plan: ActionPlan):
    tracker = get_tracker(session_id)
    next_step = tracker.get_next_executable()

    if next_step is None:
        if tracker.is_plan_complete():
            await _safe_send(ws, {
                "type": "TASK_COMPLETE",
                "session_id": session_id,
                "payload": {
                    "summary": "All steps completed successfully",
                    "steps_completed": len(tracker.get_completed_step_ids()),
                    "total": tracker.get_summary()["total_steps"],
                },
            })
            logger.info("Plan complete for session %s", session_id)
        elif tracker.is_plan_failed():
            await _safe_send(ws, {
                "type": "ERROR",
                "session_id": session_id,
                "payload": {"code": "PLAN_FAILED", "message": "All steps exhausted retries"},
            })
        return

    tracker.mark_running(next_step.step_id)

    step_detail = None
    for s in plan.plan.steps:
        if s.id == next_step.step_id:
            step_detail = s
            break

    if step_detail:
        await _safe_send(ws, {
            "type": "NEXT_STEP",
            "session_id": session_id,
            "payload": {
                "step": _step_to_extension_format(step_detail),
            },
        })
        logger.info("Dispatched step %d (%s)", next_step.step_id, step_detail.action.value)


# ---------------------------------------------------------------------------
# STEP_RESULT — step execution result from extension
# ---------------------------------------------------------------------------

async def _handle_step_execution_result(ws: WebSocket, msg: WebSocketMessage):
    payload = msg.payload
    step_id = payload.get("step_id")
    success = payload.get("success", False)
    status = "success" if success else "error"
    error_code = payload.get("error_code", "")
    error_msg = payload.get("error", "")
    screenshot = payload.get("redacted_screenshot")
    logger.info("Step %s result: %s (error_code=%s)", step_id, status, error_code)

    tracker = get_tracker(msg.session_id)

    if success:
        tracker.mark_success(step_id)
        await _dispatch_next_step_from_tracker(ws, msg.session_id)
        return

    tracker.mark_failed(step_id, error=error_msg, error_code=error_code)

    if error_code == "SELECTOR_NOT_FOUND":
        if screenshot:
            try:
                from core.vlm_client import ground_element
                result = await ground_element(screenshot, f"Find the element for step {step_id}")
                tracker.mark_hybrid_fallback(step_id)
                await _safe_send(ws, {
                    "type": "NEXT_STEP",
                    "session_id": msg.session_id,
                    "payload": {
                        "step": {
                            "id": step_id,
                            "action": "CLICK",
                            "execution_mode": "HYBRID",
                        },
                        "vlm_result": result,
                    },
                })
                return
            except Exception as e:
                logger.warning("VLM ground fallback failed: %s", e)

    elif error_code == "ELEMENT_OBSCURED":
        if screenshot:
            try:
                from core.vlm_client import detect_obstacles
                result = await detect_obstacles(screenshot)
                close_btn = result.get("result", {}).get("close_button")

                await _safe_send(ws, {
                    "type": "DYNAMIC_OBSTACLE",
                    "session_id": msg.session_id,
                    "payload": {
                        "step_id": step_id,
                        "obstacle_type": result.get("result", {}).get("obstacle_type", "unknown"),
                        "description": result.get("result", {}).get("description", ""),
                        "recommended_action": "DISMISS_POPUP",
                    },
                })

                if close_btn:
                    await _safe_send(ws, {
                        "type": "NEXT_STEP",
                        "session_id": msg.session_id,
                        "payload": {
                            "step": {
                                "id": step_id,
                                "action": "DISMISS_POPUP",
                                "target": {"coordinates": close_btn.get("coordinates")},
                                "execution_mode": "HYBRID",
                                "protocol_level": "SAFE",
                                "description": f"Dismiss {result.get('result', {}).get('obstacle_type', 'obstacle')}",
                                "verify": {"method": "DOM_CHECK", "condition": "modal_closed"},
                                "timeout_ms": 5000,
                            },
                        },
                    })
                    return
            except Exception as e:
                logger.warning("VLM obstacle detection failed: %s", e)

    elif error_code == "CAPTCHA_TRIGGERED":
        tracker.mark_blocked_approval(step_id)
        await _safe_send(ws, {
            "type": "APPROVAL_REQUIRED",
            "session_id": msg.session_id,
            "payload": {
                "step": {
                    "id": step_id,
                    "action": "CAPTCHA_HANDOFF",
                    "protocol_level": "CAUTION",
                    "description": "Please solve the CAPTCHA on screen to continue",
                },
                "reason": "CAPTCHA detected — requires manual user intervention",
            },
        })
        return

    elif error_code == "PAGE_TIMEOUT":
        await _safe_send(ws, {
            "type": "NEXT_STEP",
            "session_id": msg.session_id,
            "payload": {
                "step": {
                    "id": step_id,
                    "action": "WAIT",
                    "timeout_ms": 3000,
                    "protocol_level": "SAFE",
                    "description": "Waiting for page load before retry",
                    "verify": {"method": "DOM_CHECK", "condition": "always_true"},
                },
            },
        })
        return

    elif error_code == "AUTH_REQUIRED":
        tracker.mark_blocked_approval(step_id)
        await _safe_send(ws, {
            "type": "APPROVAL_REQUIRED",
            "session_id": msg.session_id,
            "payload": {
                "step": {
                    "id": step_id,
                    "action": "TYPE_FROM_VAULT",
                    "protocol_level": "CRITICAL",
                    "description": "Authentication required — user approval needed",
                },
                "reason": "Page requires authentication — approve to continue with vault credentials",
            },
        })
        return

    await _dispatch_next_step_from_tracker(ws, msg.session_id)


async def _dispatch_next_step_from_tracker(ws: WebSocket, session_id: str):
    tracker = get_tracker(session_id)
    next_step = tracker.get_next_executable()

    if next_step is None:
        if tracker.is_plan_complete():
            await _safe_send(ws, {
                "type": "TASK_COMPLETE",
                "session_id": session_id,
                "payload": {
                    "summary": "All steps completed successfully",
                    "steps_completed": len(tracker.get_completed_step_ids()),
                    "total": tracker.get_summary()["total_steps"],
                },
            })
        elif tracker.is_plan_failed():
            await _safe_send(ws, {
                "type": "ERROR",
                "session_id": session_id,
                "payload": {"code": "PLAN_FAILED", "message": "All steps exhausted retries"},
            })
        return

    tracker.mark_running(next_step.step_id)

    plan = _plan_cache.get(session_id)
    step_detail = None
    if plan:
        for s in plan.plan.steps:
            if s.id == next_step.step_id:
                step_detail = s
                break

    if step_detail:
        await _safe_send(ws, {
            "type": "NEXT_STEP",
            "session_id": session_id,
            "payload": {
                "step": _step_to_extension_format(step_detail),
            },
        })
        logger.info("Dispatched step %d (%s)", next_step.step_id, step_detail.action.value)
    else:
        await _safe_send(ws, {
            "type": "NEXT_STEP",
            "session_id": session_id,
            "payload": {
                "step": {
                    "id": next_step.step_id,
                    "action": "EXECUTE",
                    "description": f"Step {next_step.step_id}",
                },
            },
        })


# ---------------------------------------------------------------------------
# APPROVAL_RESPONSE
# ---------------------------------------------------------------------------

async def _handle_approval_response(ws: WebSocket, msg: WebSocketMessage):
    payload = msg.payload
    approved = payload.get("approved", False)
    step_id = payload.get("step_id") or payload.get("actionId")
    logger.info("Approval for step %s: %s", step_id, "approved" if approved else "denied")

    tracker = get_tracker(msg.session_id)

    if approved:
        try:
            tracker.approve_step(step_id)
            await _safe_send(ws, {
                "type": "NEXT_STEP",
                "session_id": msg.session_id,
                "payload": {
                    "step": {
                        "id": step_id,
                        "action": "EXECUTE",
                        "status": "approved",
                    },
                },
            })
            logger.info("Step %d approved and dispatched", step_id)
        except ValueError as e:
            await _safe_send(ws, {
                "type": "ERROR",
                "session_id": msg.session_id,
                "payload": {"code": "INVALID_APPROVAL", "message": str(e)},
            })
    else:
        tracker.deny_step(step_id)
        await _safe_send(ws, {
            "type": "ERROR",
            "session_id": msg.session_id,
            "payload": {"code": "APPROVAL_DENIED", "message": f"Step {step_id} denied by user"},
        })


# ---------------------------------------------------------------------------
# SESSION_RESTORE
# ---------------------------------------------------------------------------

async def _handle_session_restore(ws: WebSocket, msg: WebSocketMessage):
    from state.session_manager import get_session_manager

    payload = msg.payload
    target_session_id = payload.get("session_id", msg.session_id)

    manager = get_session_manager()
    session_data = manager.restore_session(target_session_id)

    if session_data:
        tracker = get_tracker(msg.session_id)
        if "plan_id" in session_data and "step_ids" in session_data:
            tracker.initialize_plan(session_data["plan_id"], session_data["step_ids"])

    await _safe_send(ws, {
        "type": "SESSION_RESTORED",
        "session_id": msg.session_id,
        "payload": {
            "session_id": target_session_id,
            "restored": session_data is not None,
            "session_data": session_data or {},
        },
    })


# ---------------------------------------------------------------------------
# PAUSE / RESUME / STOP
# ---------------------------------------------------------------------------

async def _handle_pause_agent(ws: WebSocket, msg: WebSocketMessage):
    tracker = get_tracker(msg.session_id)
    tracker.pause()
    await _safe_send(ws, {
        "type": "ACK",
        "session_id": msg.session_id,
        "payload": {"status": "paused"},
    })


async def _handle_resume_agent(ws: WebSocket, msg: WebSocketMessage):
    tracker = get_tracker(msg.session_id)
    tracker.resume()
    await _safe_send(ws, {
        "type": "ACK",
        "session_id": msg.session_id,
        "payload": {"status": "resumed"},
    })


async def _handle_stop_agent(ws: WebSocket, msg: WebSocketMessage):
    tracker = get_tracker(msg.session_id)
    tracker.stop()
    await _safe_send(ws, {
        "type": "TASK_COMPLETE",
        "session_id": msg.session_id,
        "payload": {"status": "stopped", "summary": "Agent stopped by user"},
    })
