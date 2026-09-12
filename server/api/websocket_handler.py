from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from schemas.messages import WebSocketMessage, MessageType
from schemas.actions import ActionPlan
from core.planner import generate_plan, replan_after_failure
from core.protocol_engine import classify_plan_steps, has_critical_steps, get_critical_steps

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
# USER_QUERY — the main entry point: plan generation
# ---------------------------------------------------------------------------

async def _handle_user_query(ws: WebSocket, msg: WebSocketMessage):
    """Process a user query: generate plan, classify steps, emit PLAN or APPROVAL_REQUIRED."""
    payload = msg.payload

    try:
        plan = await generate_plan(
            goal=payload.get("query", ""),
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

    # Check for critical steps
    if has_critical_steps(plan):
        # Send the full plan first
        await _send_plan(ws, msg.session_id, plan)

        # Then send approval required for the first critical step
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
        # No critical steps — send full plan
        await _send_plan(ws, msg.session_id, plan)


async def _send_plan(ws: WebSocket, session_id: str, plan: ActionPlan):
    """Send a PLAN message to the client."""
    await ws.send_text(json.dumps({
        "type": "PLAN",
        "session_id": session_id,
        "payload": plan.model_dump(),
    }))
    logger.info("Sent PLAN with %d steps", plan.plan.total_steps)


# ---------------------------------------------------------------------------
# STEP_RESULT — step execution result from extension
# ---------------------------------------------------------------------------

async def _handle_step_result(ws: WebSocket, msg: WebSocketMessage):
    """Handle step execution result from the extension.

    On failure with error codes, triggers VLM re-planning.
    """
    payload = msg.payload
    step_id = payload.get("step_id")
    status = payload.get("status")
    error_code = payload.get("result", {}).get("error_code")
    logger.info("Step %s result: %s (error=%s)", step_id, status, error_code)

    if status == "error" and error_code:
        # Error recovery paths per COMMUNICATION_SPEC.md §6.2
        if error_code == "SELECTOR_NOT_FOUND":
            # Fall back to VLM /ground
            screenshot = payload.get("redacted_screenshot")
            if screenshot:
                try:
                    from core.vlm_client import ground_element
                    result = await ground_element(screenshot, f"Find the element for step {step_id}")
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
            # Fall back to VLM /detect-obstacles → DISMISS_POPUP
            screenshot = payload.get("redacted_screenshot")
            if screenshot:
                try:
                    from core.vlm_client import detect_obstacles
                    result = await detect_obstacles(screenshot)
                    close_btn = result.get("result", {}).get("close_button")
                    if close_btn:
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
            await ws.send_text(json.dumps({
                "type": "NEXT_STEP",
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

    # Success or unhandled error — acknowledge
    await ws.send_text(json.dumps({
        "type": "NEXT_STEP",
        "session_id": msg.session_id,
        "payload": {"acknowledged_step_id": step_id, "status": status},
    }))


# ---------------------------------------------------------------------------
# APPROVAL_RESPONSE — user approved/denied a critical step
# ---------------------------------------------------------------------------

async def _handle_approval_response(ws: WebSocket, msg: WebSocketMessage):
    """Handle user approval decision.

    Phase 5 will add full approval gate logic.
    """
    payload = msg.payload
    approved = payload.get("approved", False)
    step_id = payload.get("step_id")
    logger.info("Approval for step %s: %s", step_id, "approved" if approved else "denied")

    if approved:
        # Phase 5: Resume plan execution from this step
        await ws.send_text(json.dumps({
            "type": "NEXT_STEP",
            "session_id": msg.session_id,
            "payload": {"step_id": step_id, "status": "approved"},
        }))
    else:
        await ws.send_text(json.dumps({
            "type": "ERROR",
            "session_id": msg.session_id,
            "payload": {"error_code": "APPROVAL_DENIED", "message": f"Step {step_id} denied by user"},
        }))


# ---------------------------------------------------------------------------
# SESSION_RESTORE — reconnect to prior session
# ---------------------------------------------------------------------------

async def _handle_session_restore(ws: WebSocket, msg: WebSocketMessage):
    """Restore a prior session.

    Phase 6 will add full session memory restore.
    """
    # Phase 6: Load session from SQLite, send SESSION_RESTORED
    await ws.send_text(json.dumps({
        "type": "SESSION_RESTORED",
        "session_id": msg.session_id,
        "payload": {
            "session_id": msg.session_id,
            "restored": False,
            "message": "Session restore not yet implemented",
        },
    }))


# ---------------------------------------------------------------------------
# PAUSE / RESUME / STOP — agent control
# ---------------------------------------------------------------------------

async def _handle_pause_agent(ws: WebSocket, msg: WebSocketMessage):
    """Pause agent action dispatch."""
    logger.info("Agent paused for session %s", msg.session_id)
    await ws.send_text(json.dumps({
        "type": "ACK",
        "session_id": msg.session_id,
        "payload": {"status": "paused"},
    }))


async def _handle_resume_agent(ws: WebSocket, msg: WebSocketMessage):
    """Resume agent action dispatch."""
    logger.info("Agent resumed for session %s", msg.session_id)
    await ws.send_text(json.dumps({
        "type": "ACK",
        "session_id": msg.session_id,
        "payload": {"status": "resumed"},
    }))


async def _handle_stop_agent(ws: WebSocket, msg: WebSocketMessage):
    """Stop agent and cancel pending steps."""
    logger.info("Agent stopped for session %s", msg.session_id)
    await ws.send_text(json.dumps({
        "type": "TASK_COMPLETE",
        "session_id": msg.session_id,
        "payload": {"status": "stopped", "message": "Agent stopped by user"},
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
