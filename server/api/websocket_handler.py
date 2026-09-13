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


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    """WebSocket handler — validates envelope, routes by message type."""
    await ws.accept()
    session_id: str | None = None
    logger.info("WebSocket connected")

    try:
        while True:
            raw = await ws.receive_text()
            try:
                data: dict[str, Any] = json.loads(raw)
            except json.JSONDecodeError:
                await _send_error(ws, "INVALID_JSON", "Message is not valid JSON")
                continue

            # Validate envelope
            try:
                msg = WebSocketMessage(**data)
            except Exception as e:
                await _send_error(ws, "INVALID_ENVELOPE", str(e))
                continue

            session_id = msg.session_id
            logger.info("Received %s from %s", msg.type.value, session_id)

            # Route by message type
            try:
                await _route_message(ws, msg)
            except Exception as e:
                logger.exception("Error handling %s: %s", msg.type.value, e)
                await _send_error(ws, "INTERNAL_ERROR", str(e))

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected: %s", session_id)
        if session_id:
            remove_tracker(session_id)
    except Exception as e:
        logger.exception("WebSocket error: %s", e)
        try:
            await ws.close()
        except Exception:
            pass


async def _route_message(ws: WebSocket, msg: WebSocketMessage):
    """Dispatch message to the correct handler based on type."""
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
        await _send_error(ws, "UNKNOWN_TYPE", f"Unhandled message type: {msg.type.value}")


# ---------------------------------------------------------------------------
# USER_QUERY — the main entry point: plan generation + approval gate
# ---------------------------------------------------------------------------

async def _handle_user_query(ws: WebSocket, msg: WebSocketMessage):
    """Process a user query: generate plan, classify steps, emit PLAN or APPROVAL_REQUIRED."""
    from state.session_manager import get_session_manager

    payload = msg.payload
    goal = payload.get("query", "")

    # Ensure session exists in the session manager
    manager = get_session_manager()
    manager.create_session(msg.session_id, goal=goal)

    try:
        plan = await generate_plan(
            goal=goal,
            url=payload.get("current_url", ""),
            sanitized_dom=payload.get("sanitized_dom", {}),
            vault_manifest=payload.get("vault_manifest", {}),
            session_id=msg.session_id,
            redacted_screenshot=payload.get("redacted_screenshot"),
        )
    except ValueError as e:
        await _send_error(ws, "PLAN_GENERATION_FAILED", str(e))
        return

    # Classify protocol levels
    classifications = classify_plan_steps(plan)

    # Initialize task tracker
    tracker = get_tracker(msg.session_id)
    step_ids = [s.id for s in plan.plan.steps]
    tracker.initialize_plan(plan_id=f"plan_{msg.session_id}", step_ids=step_ids)

    # Update session with plan info
    manager.update_session(
        msg.session_id,
        goal=goal,
        plan_id=f"plan_{msg.session_id}",
        step_ids=step_ids,
    )

    # Mark all non-critical steps as PENDING, critical steps as BLOCKED_APPROVAL
    if has_critical_steps(plan):
        critical_ids = {s.id for s in get_critical_steps(plan)}
        for step in plan.plan.steps:
            if step.id in critical_ids:
                tracker.mark_blocked_approval(step.id)
            # Non-critical steps stay PENDING

        # Send the full plan first
        await _send_plan(ws, msg.session_id, plan)

        # Send approval required for the first critical step
        critical = get_critical_steps(plan)
        first_critical = critical[0]
        await ws.send_text(json.dumps({
            "type": "APPROVAL_REQUIRED",
            "session_id": msg.session_id,
            "payload": {
                "step": first_critical.model_dump(),
                "reason": f"Step {first_critical.id}: {first_critical.description} — requires user approval",
                "vault_key": first_critical.vault_key,
            },
        }))
        logger.info("Sent APPROVAL_REQUIRED for step %d", first_critical.id)
    else:
        # No critical steps — send full plan and dispatch first step
        await _send_plan(ws, msg.session_id, plan)
        await _dispatch_next_step(ws, msg.session_id, plan)


async def _send_plan(ws: WebSocket, session_id: str, plan: ActionPlan):
    """Send a PLAN message to the client."""
    await ws.send_text(json.dumps({
        "type": "PLAN",
        "session_id": session_id,
        "payload": plan.model_dump(),
    }))
    logger.info("Sent PLAN with %d steps", plan.plan.total_steps)


async def _dispatch_next_step(ws: WebSocket, session_id: str, plan: ActionPlan):
    """Dispatch the next executable step from the plan."""
    tracker = get_tracker(session_id)
    next_step = tracker.get_next_executable()

    if next_step is None:
        if tracker.is_plan_complete():
            await ws.send_text(json.dumps({
                "type": "TASK_COMPLETE",
                "session_id": session_id,
                "payload": {"status": "completed", "message": "All steps completed"},
            }))
            logger.info("Plan complete for session %s", session_id)
        elif tracker.is_plan_failed():
            await _send_error(ws, "PLAN_FAILED", "All steps exhausted retries")
        return

    # Mark step as running
    tracker.mark_running(next_step.step_id)

    # Find the step details from the plan
    step_detail = None
    for s in plan.plan.steps:
        if s.id == next_step.step_id:
            step_detail = s
            break

    if step_detail:
        await ws.send_text(json.dumps({
            "type": "NEXT_STEP",
            "session_id": session_id,
            "payload": {
                "step_id": next_step.step_id,
                "action": step_detail.action.value,
                "target": step_detail.target.model_dump() if step_detail.target else None,
                "value": step_detail.value,
                "execution_mode": step_detail.execution_mode.value,
                "protocol_level": step_detail.protocol_level,
                "description": step_detail.description,
                "verify": step_detail.verify.model_dump() if step_detail.verify else None,
                "timeout_ms": step_detail.timeout_ms,
            },
        }))
        logger.info("Dispatched step %d (%s)", next_step.step_id, step_detail.action.value)


# ---------------------------------------------------------------------------
# STEP_RESULT — step execution result from extension
# ---------------------------------------------------------------------------

async def _handle_step_result(ws: WebSocket, msg: WebSocketMessage):
    """Handle step execution result from the extension.

    Updates task tracker and routes error recovery via VLM.
    """
    payload = msg.payload
    step_id = payload.get("step_id")
    status = payload.get("status")
    error_code = payload.get("result", {}).get("error_code", "")
    error_message = payload.get("result", {}).get("message", "")
    logger.info("Step %s result: %s (error=%s)", step_id, status, error_code)

    tracker = get_tracker(msg.session_id)

    # Determine next state from the result
    next_state = tracker.handle_step_result(
        step_id=step_id,
        status=status,
        error_code=error_code,
        error_message=error_message,
    )

    # Error recovery paths per COMMUNICATION_SPEC.md §6.2
    if status == "error" and error_code:
        if error_code == "SELECTOR_NOT_FOUND":
            screenshot = payload.get("redacted_screenshot")
            if screenshot:
                try:
                    from core.vlm_client import ground_element
                    result = await ground_element(screenshot, f"Find the element for step {step_id}")
                    tracker.mark_hybrid_fallback(step_id)
                    await ws.send_text(json.dumps({
                        "type": "NEXT_STEP",
                        "session_id": msg.session_id,
                        "payload": {
                            "step_id": step_id,
                            "action": "CLICK",
                            "execution_mode": "HYBRID",
                            "vlm_result": result,
                        },
                    }))
                    return
                except Exception as e:
                    logger.warning("VLM ground fallback failed: %s", e)

        elif error_code == "ELEMENT_OBSCURED":
            screenshot = payload.get("redacted_screenshot")
            if screenshot:
                try:
                    from core.vlm_client import detect_obstacles
                    result = await detect_obstacles(screenshot)
                    close_btn = result.get("result", {}).get("close_button")
                    if close_btn:
                        tracker.mark_retrying(step_id)
                        await ws.send_text(json.dumps({
                            "type": "NEXT_STEP",
                            "session_id": msg.session_id,
                            "payload": {
                                "step_id": step_id,
                                "action": "DISMISS_POPUP",
                                "target": {"coordinates": close_btn.get("coordinates")},
                                "execution_mode": "HYBRID",
                            },
                        }))
                        return
                except Exception as e:
                    logger.warning("VLM obstacle detection failed: %s", e)

        elif error_code == "CAPTCHA_TRIGGERED":
            tracker.mark_blocked_approval(step_id)
            await ws.send_text(json.dumps({
                "type": "APPROVAL_REQUIRED",
                "session_id": msg.session_id,
                "payload": {
                    "step_id": step_id,
                    "action": "CAPTCHA_HANDOFF",
                    "protocol_level": "CAUTION",
                    "description": "Please solve the CAPTCHA on screen",
                },
            }))
            return

        elif error_code == "PAGE_TIMEOUT":
            tracker.set_error(step_id, error_message, error_code)
            tracker.mark_retrying(step_id)
            await ws.send_text(json.dumps({
                "type": "NEXT_STEP",
                "session_id": msg.session_id,
                "payload": {
                    "step_id": step_id,
                    "action": "WAIT",
                    "timeout_ms": 3000,
                    "description": "Waiting for page load before retry",
                },
            }))
            return

        elif error_code == "AUTH_REQUIRED":
            tracker.mark_blocked_approval(step_id)
            await ws.send_text(json.dumps({
                "type": "APPROVAL_REQUIRED",
                "session_id": msg.session_id,
                "payload": {
                    "step_id": step_id,
                    "action": "TYPE_FROM_VAULT",
                    "protocol_level": "CRITICAL",
                    "description": "Authentication required — please approve",
                },
            }))
            return

    # Success — mark as complete and dispatch next
    if status == "success":
        tracker.mark_success(step_id)

    # Dispatch next step
    # Reload the plan from the tracker context
    await _dispatch_next_step_from_tracker(ws, msg.session_id)


async def _dispatch_next_step_from_tracker(ws: WebSocket, session_id: str):
    """Dispatch the next step using the tracker state (without full plan reload)."""
    tracker = get_tracker(session_id)
    next_step = tracker.get_next_executable()

    if next_step is None:
        if tracker.is_plan_complete():
            await ws.send_text(json.dumps({
                "type": "TASK_COMPLETE",
                "session_id": session_id,
                "payload": {"status": "completed", "message": "All steps completed"},
            }))
        elif tracker.is_plan_failed():
            await _send_error(ws, "PLAN_FAILED", "All steps exhausted retries")
        return

    tracker.mark_running(next_step.step_id)

    # For retrying steps, send a RETRY indication
    if next_step.state == StepState.RETRYING:
        await ws.send_text(json.dumps({
            "type": "NEXT_STEP",
            "session_id": session_id,
            "payload": {
                "step_id": next_step.step_id,
                "action": "RETRY",
                "description": f"Retrying step {next_step.step_id} (attempt {next_step.attempts})",
                "retry_count": next_step.attempts,
            },
        }))
    else:
        # For fresh steps, send a basic dispatch (extension re-reads from PLAN)
        await ws.send_text(json.dumps({
            "type": "NEXT_STEP",
            "session_id": session_id,
            "payload": {
                "step_id": next_step.step_id,
                "action": "EXECUTE",
                "description": f"Execute step {next_step.step_id}",
            },
        }))


# ---------------------------------------------------------------------------
# APPROVAL_RESPONSE — user approved/denied a critical step
# ---------------------------------------------------------------------------

async def _handle_approval_response(ws: WebSocket, msg: WebSocketMessage):
    """Handle user approval decision with full task tracker integration."""
    payload = msg.payload
    approved = payload.get("approved", False)
    step_id = payload.get("step_id")
    logger.info("Approval for step %s: %s", step_id, "approved" if approved else "denied")

    tracker = get_tracker(msg.session_id)

    if approved:
        try:
            tracker.approve_step(step_id)
            await ws.send_text(json.dumps({
                "type": "NEXT_STEP",
                "session_id": msg.session_id,
                "payload": {
                    "step_id": step_id,
                    "action": "EXECUTE",
                    "status": "approved",
                    "description": f"Step {step_id} approved — executing",
                },
            }))
            logger.info("Step %d approved and dispatched", step_id)
        except ValueError as e:
            await _send_error(ws, "INVALID_APPROVAL", str(e))
    else:
        tracker.deny_step(step_id)
        await ws.send_text(json.dumps({
            "type": "ERROR",
            "session_id": msg.session_id,
            "payload": {"error_code": "APPROVAL_DENIED", "message": f"Step {step_id} denied by user"},
        }))
        logger.info("Step %d denied — plan halted", step_id)


# ---------------------------------------------------------------------------
# SESSION_RESTORE — reconnect to prior session
# ---------------------------------------------------------------------------

async def _handle_session_restore(ws: WebSocket, msg: WebSocketMessage):
    """Restore a prior session from session manager."""
    from state.session_manager import get_session_manager

    payload = msg.payload
    target_session_id = payload.get("target_session_id", msg.session_id)

    manager = get_session_manager()
    session_data = manager.restore_session(target_session_id)

    if session_data:
        # Initialize task tracker from restored session
        tracker = get_tracker(msg.session_id)
        if "plan_id" in session_data and "step_ids" in session_data:
            tracker.initialize_plan(session_data["plan_id"], session_data["step_ids"])

        await ws.send_text(json.dumps({
            "type": "SESSION_RESTORED",
            "session_id": msg.session_id,
            "payload": {
                "session_id": target_session_id,
                "restored": True,
                "session_data": session_data,
                "message": "Session restored successfully",
            },
        }))
        logger.info("Session %s restored for %s", target_session_id, msg.session_id)
    else:
        await ws.send_text(json.dumps({
            "type": "SESSION_RESTORED",
            "session_id": msg.session_id,
            "payload": {
                "session_id": target_session_id,
                "restored": False,
                "message": "Session not found",
            },
        }))


# ---------------------------------------------------------------------------
# PAUSE / RESUME / STOP — agent control
# ---------------------------------------------------------------------------

async def _handle_pause_agent(ws: WebSocket, msg: WebSocketMessage):
    """Pause agent action dispatch."""
    tracker = get_tracker(msg.session_id)
    tracker.pause()
    await ws.send_text(json.dumps({
        "type": "ACK",
        "session_id": msg.session_id,
        "payload": {"status": "paused", "tracker": tracker.get_summary()},
    }))


async def _handle_resume_agent(ws: WebSocket, msg: WebSocketMessage):
    """Resume agent action dispatch."""
    tracker = get_tracker(msg.session_id)
    tracker.resume()
    await ws.send_text(json.dumps({
        "type": "ACK",
        "session_id": msg.session_id,
        "payload": {"status": "resumed", "tracker": tracker.get_summary()},
    }))


async def _handle_stop_agent(ws: WebSocket, msg: WebSocketMessage):
    """Stop agent and cancel pending steps."""
    tracker = get_tracker(msg.session_id)
    tracker.stop()
    await ws.send_text(json.dumps({
        "type": "TASK_COMPLETE",
        "session_id": msg.session_id,
        "payload": {
            "status": "stopped",
            "message": "Agent stopped by user",
            "tracker": tracker.get_summary(),
        },
    }))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _send_error(ws: WebSocket, code: str, message: str):
    """Send an ERROR envelope to the client."""
    await ws.send_text(json.dumps({
        "type": "ERROR",
        "session_id": "unknown",
        "payload": {"error_code": code, "message": message},
    }))
