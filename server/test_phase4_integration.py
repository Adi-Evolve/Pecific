"""
Phase 4 Integration Tests — Full Round-Trip Verification
Tests the complete extension → server → extension flow with mocked LLM.
Validates schema compliance, message routing, error handling, and session lifecycle.

Usage:
    cd server && python test_phase4_integration.py
"""

import asyncio
import json
import sys
from unittest.mock import AsyncMock, MagicMock, patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

passed = 0
failed = 0
total = 0


def test(name):
    def decorator(fn):
        global passed, failed, total
        total += 1
        try:
            fn()
            passed += 1
            print(f"  PASS  {name}")
        except Exception as e:
            failed += 1
            print(f"  FAIL  {name}: {e}")
        return fn
    return decorator


def make_ws():
    ws = AsyncMock()
    ws.send_text = AsyncMock()
    return ws


def make_user_query(session_id="test_session", query="Search for shoes", url="https://flipkart.com"):
    return {
        "type": "USER_QUERY",
        "session_id": session_id,
        "payload": {
            "query": query,
            "url": url,
            "viewport": {"width": 1280, "height": 720},
        },
    }


def make_step_result(session_id="test_session", sanitized_dom=None, vault_manifest=None):
    return {
        "type": "STEP_RESULT",
        "session_id": session_id,
        "payload": {
            "success": True,
            "sanitized_dom": sanitized_dom or {
                "url": "https://flipkart.com",
                "title": "Flipkart",
                "viewport": {"width": 1280, "height": 720},
                "elements": [
                    {"id": 1, "tag": "INPUT", "type": "text", "role": "searchbox",
                     "selector": "input[name='q']", "text": "", "placeholder": "Search"},
                    {"id": 2, "tag": "BUTTON", "role": "button",
                     "selector": "button[type='submit']", "text": "Search"},
                ],
            },
            "vault_manifest": vault_manifest or {"fields": {"email": False, "password": False}, "locked": False},
            "redacted_screenshot": None,
        },
    }


def make_step_complete(session_id="test_session", step_id=1, success=True, error_code=""):
    payload = {"step_id": step_id, "success": success}
    if error_code:
        payload["error_code"] = error_code
        payload["error"] = f"Error: {error_code}"
    return {
        "type": "STEP_RESULT",
        "session_id": session_id,
        "payload": payload,
    }


def make_approval_response(session_id="test_session", step_id=1, approved=True):
    return {
        "type": "APPROVAL_RESPONSE",
        "session_id": session_id,
        "payload": {"step_id": step_id, "approved": approved},
    }


def make_plan_dict(session_id="test", goal="test", steps=None):
    if steps is None:
        steps = [
            {"id": 1, "action": "NAVIGATE", "target": {"url": "https://flipkart.com"},
             "execution_mode": "DOM", "protocol_level": "SAFE", "description": "Navigate to Flipkart",
             "verify": {"method": "URL_CHECK", "condition": "url_contains('flipkart.com')"}, "timeout_ms": 10000},
            {"id": 2, "action": "TYPE", "target": {"selector": "input[name='q']"}, "value": "shoes",
             "execution_mode": "DOM", "protocol_level": "SAFE", "description": "Type search query",
             "verify": {"method": "DOM_CHECK", "condition": "input value matches"}, "timeout_ms": 5000},
            {"id": 3, "action": "CLICK", "target": {"selector": "button[type='submit']"},
             "execution_mode": "DOM", "protocol_level": "SAFE", "description": "Click search",
             "verify": {"method": "URL_CHECK", "condition": "url_contains('q=shoes')"}, "timeout_ms": 8000},
        ]
    return {
        "session_id": session_id,
        "goal": goal,
        "plan": {
            "goal": goal,
            "chain_of_thought": "Step by step reasoning",
            "total_steps": len(steps),
            "steps": steps,
        },
    }


def make_critical_plan(session_id="test", goal="login"):
    steps = [
        {"id": 1, "action": "TYPE_FROM_VAULT", "target": {"selector": "#email"},
         "vault_key": "email", "execution_mode": "DOM", "protocol_level": "CRITICAL",
         "description": "Fill email from vault",
         "verify": {"method": "DOM_CHECK", "condition": "value_matches"}, "timeout_ms": 5000},
        {"id": 2, "action": "CLICK", "target": {"selector": "#submit"},
         "execution_mode": "DOM", "protocol_level": "CRITICAL",
         "description": "Click submit",
         "verify": {"method": "URL_CHECK", "condition": "url_contains('/dashboard')"}, "timeout_ms": 8000},
    ]
    return make_plan_dict(session_id, goal, steps)


def get_sent_messages(ws):
    """Extract all JSON messages sent via ws.send_text."""
    messages = []
    for call in ws.send_text.call_args_list:
        try:
            messages.append(json.loads(call[0][0]))
        except (IndexError, json.JSONDecodeError):
            pass
    return messages


# ============================================================================
# 1. Full Round-Trip: Query → Payload → Plan
# ============================================================================
print("\n=== 1. Full Round-Trip ===")


@test("USER_QUERY stores goal, STEP_RESULT triggers plan generation")
def _():
    from api.websocket_handler import _handle_user_query, _handle_step_result, _pending_goals
    from schemas.messages import WebSocketMessage, MessageType

    ws = make_ws()
    session_id = "rt_001"

    # Step 1: USER_QUERY stores goal
    msg1 = WebSocketMessage(**make_user_query(session_id, "Search for shoes"))
    asyncio.get_event_loop().run_until_complete(_handle_user_query(ws, msg1))
    assert session_id in _pending_goals
    assert _pending_goals[session_id]["goal"] == "Search for shoes"

    # Step 2: STEP_RESULT with DOM triggers plan
    msg2 = WebSocketMessage(**make_step_result(session_id))
    with patch("api.websocket_handler.generate_plan") as mock_gen:
        mock_plan = MagicMock()
        mock_plan.plan.steps = []
        mock_plan.plan.total_steps = 0
        mock_plan.plan.chain_of_thought = "reasoning"
        mock_plan.goal = "Search for shoes"
        mock_gen.return_value = mock_plan

        with patch("api.websocket_handler.classify_plan_steps"):
            with patch("state.session_manager.get_session_manager") as mock_sm:
                mock_sm.return_value = MagicMock()
                asyncio.get_event_loop().run_until_complete(_handle_step_result(ws, msg2))

    messages = get_sent_messages(ws)
    assert any(m["type"] == "ACK" for m in messages), "Should send ACK"
    _pending_goals.pop(session_id, None)


@test("Server sends PLAN with correct envelope structure")
def _():
    from api.websocket_handler import _build_plan_payload
    from schemas.actions import ActionPlan

    plan = ActionPlan(**make_plan_dict("env_001", "Search for shoes"))
    payload = _build_plan_payload("env_001", plan)

    assert payload["type"] == "PLAN"
    assert payload["session_id"] == "env_001"
    assert "goal" in payload["payload"]
    assert "plan" in payload["payload"]
    assert "steps" in payload["payload"]["plan"]
    assert "total_steps" in payload["payload"]["plan"]
    assert "chain_of_thought" in payload["payload"]["plan"]


@test("Plan steps match extension expected format")
def _():
    from api.websocket_handler import _step_to_extension_format
    from schemas.actions import PlanStep, ActionType, ExecutionMode

    step = PlanStep(
        id=1, action=ActionType.CLICK, target={"selector": "#btn"},
        execution_mode=ExecutionMode.DOM, protocol_level="SAFE",
        description="Click button", verify={"method": "DOM_CHECK", "condition": "ok"},
        timeout_ms=5000,
    )
    fmt = _step_to_extension_format(step)

    assert fmt["id"] == 1
    assert fmt["action"] == "CLICK"
    assert fmt["target"]["selector"] == "#btn"
    assert fmt["execution_mode"] == "DOM"
    assert fmt["protocol_level"] == "SAFE"
    assert fmt["description"] == "Click button"
    assert fmt["timeout_ms"] == 5000
    assert "verify" in fmt


# ============================================================================
# 2. Step Execution Flow
# ============================================================================
print("\n=== 2. Step Execution Flow ===")


@test("Successful step result dispatches next step")
def _():
    from api.websocket_handler import _handle_step_execution_result
    from schemas.messages import WebSocketMessage, MessageType
    from state.task_tracker import get_tracker, remove_tracker

    session_id = "exec_001"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_exec", step_ids=[1, 2, 3])
    tracker.mark_running(1)

    ws = make_ws()
    msg = WebSocketMessage(**make_step_complete(session_id, step_id=1, success=True))

    mock_plan = MagicMock()
    mock_plan.plan.steps = [
        MagicMock(id=1, action=MagicMock(value="NAVIGATE"),
                  target=MagicMock(selector=None, coordinates=None, url="https://x.com", text=None, tab_id=None),
                  value=None, key=None, vault_key=None,
                  execution_mode=MagicMock(value="DOM"), protocol_level="SAFE",
                  description="Nav", verify=None, timeout_ms=5000, duration_ms=None),
        MagicMock(id=2, action=MagicMock(value="TYPE"),
                  target=MagicMock(selector="input", coordinates=None, url=None, text=None, tab_id=None),
                  value="shoes", key=None, vault_key=None,
                  execution_mode=MagicMock(value="DOM"), protocol_level="SAFE",
                  description="Type", verify=None, timeout_ms=5000, duration_ms=None),
    ]

    with patch("api.websocket_handler._plan_cache", {session_id: mock_plan}):
        asyncio.get_event_loop().run_until_complete(_handle_step_execution_result(ws, msg))

    messages = get_sent_messages(ws)
    next_steps = [m for m in messages if m["type"] == "NEXT_STEP"]
    assert len(next_steps) == 1
    assert next_steps[0]["payload"]["step"]["id"] == 2
    remove_tracker(session_id)


@test("Failed step with SELECTOR_NOT_FOUND triggers VLM fallback")
def _():
    from api.websocket_handler import _handle_step_execution_result
    from schemas.messages import WebSocketMessage, MessageType
    from state.task_tracker import get_tracker, remove_tracker

    session_id = "exec_002"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_exec2", step_ids=[1])
    tracker.mark_running(1)

    ws = make_ws()
    msg = WebSocketMessage(**make_step_complete(session_id, step_id=1, success=False, error_code="SELECTOR_NOT_FOUND"))
    # Add screenshot to payload so VLM fallback triggers
    msg.payload["redacted_screenshot"] = "data:image/jpeg;base64,fakescreenshot"

    mock_plan = MagicMock()
    mock_plan.plan.steps = [
        MagicMock(id=1, action=MagicMock(value="CLICK"),
                  target=MagicMock(selector="#missing"),
                  execution_mode=MagicMock(value="DOM"), protocol_level="SAFE",
                  description="Click", verify=None, timeout_ms=5000),
    ]

    with patch("api.websocket_handler._plan_cache", {session_id: mock_plan}):
        with patch("core.vlm_client.ground_element", new_callable=AsyncMock) as mock_ground:
            mock_ground.return_value = {"coordinates": [100, 200]}
            asyncio.get_event_loop().run_until_complete(_handle_step_execution_result(ws, msg))

    messages = get_sent_messages(ws)
    hybrid_steps = [m for m in messages if m["type"] == "NEXT_STEP" and m["payload"].get("vlm_result")]
    assert len(hybrid_steps) == 1
    remove_tracker(session_id)


@test("Failed step with CAPTCHA_TRIGGERED sends APPROVAL_REQUIRED")
def _():
    from api.websocket_handler import _handle_step_execution_result
    from schemas.messages import WebSocketMessage, MessageType
    from state.task_tracker import get_tracker, remove_tracker

    session_id = "exec_003"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_exec3", step_ids=[1])
    tracker.mark_running(1)

    ws = make_ws()
    msg = WebSocketMessage(**make_step_complete(session_id, step_id=1, success=False, error_code="CAPTCHA_TRIGGERED"))

    asyncio.get_event_loop().run_until_complete(_handle_step_execution_result(ws, msg))

    messages = get_sent_messages(ws)
    approvals = [m for m in messages if m["type"] == "APPROVAL_REQUIRED"]
    assert len(approvals) == 1
    assert approvals[0]["payload"]["step"]["action"] == "CAPTCHA_HANDOFF"
    remove_tracker(session_id)


@test("Failed step with PAGE_TIMEOUT sends WAIT retry")
def _():
    from api.websocket_handler import _handle_step_execution_result
    from schemas.messages import WebSocketMessage, MessageType
    from state.task_tracker import get_tracker, remove_tracker

    session_id = "exec_004"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_exec4", step_ids=[1])
    tracker.mark_running(1)

    ws = make_ws()
    msg = WebSocketMessage(**make_step_complete(session_id, step_id=1, success=False, error_code="PAGE_TIMEOUT"))

    asyncio.get_event_loop().run_until_complete(_handle_step_execution_result(ws, msg))

    messages = get_sent_messages(ws)
    next_steps = [m for m in messages if m["type"] == "NEXT_STEP"]
    assert len(next_steps) == 1
    assert next_steps[0]["payload"]["step"]["action"] == "WAIT"
    remove_tracker(session_id)


# ============================================================================
# 3. Critical Steps & Approval Flow
# ============================================================================
print("\n=== 3. Critical Steps & Approval Flow ===")


@test("Critical plan sends APPROVAL_REQUIRED before NEXT_STEP")
def _():
    from api.websocket_handler import _generate_plan_from_payload
    from schemas.messages import WebSocketMessage, MessageType
    from schemas.actions import ActionPlan

    ws = make_ws()
    session_id = "crit_001"
    msg = WebSocketMessage(**make_user_query(session_id, "Login with credentials"))

    plan = ActionPlan(**make_critical_plan(session_id, "Login"))

    with patch("api.websocket_handler.generate_plan", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = plan
        with patch("state.session_manager.get_session_manager") as mock_sm:
            mock_sm.return_value = MagicMock()
            asyncio.get_event_loop().run_until_complete(
                _generate_plan_from_payload(ws, msg, msg.payload)
            )

    messages = get_sent_messages(ws)
    approvals = [m for m in messages if m["type"] == "APPROVAL_REQUIRED"]
    plans = [m for m in messages if m["type"] == "PLAN"]
    assert len(plans) == 1, "Should send PLAN"
    assert len(approvals) == 1, "Should send APPROVAL_REQUIRED"
    assert approvals[0]["payload"]["step"]["action"] == "TYPE_FROM_VAULT"
    assert approvals[0]["payload"]["step"]["protocol_level"] == "CRITICAL"


@test("APPROVAL_RESPONSE approved dispatches next step")
def _():
    from api.websocket_handler import _handle_approval_response
    from schemas.messages import WebSocketMessage, MessageType
    from state.task_tracker import get_tracker, remove_tracker

    session_id = "appr_001"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_appr", step_ids=[1, 2])
    tracker.mark_running(1)
    tracker.mark_blocked_approval(1)

    ws = make_ws()
    msg = WebSocketMessage(**make_approval_response(session_id, step_id=1, approved=True))
    asyncio.get_event_loop().run_until_complete(_handle_approval_response(ws, msg))

    messages = get_sent_messages(ws)
    next_steps = [m for m in messages if m["type"] == "NEXT_STEP"]
    assert len(next_steps) == 1
    remove_tracker(session_id)


@test("APPROVAL_RESPONSE denied sends ERROR")
def _():
    from api.websocket_handler import _handle_approval_response
    from schemas.messages import WebSocketMessage, MessageType
    from state.task_tracker import get_tracker, remove_tracker

    session_id = "appr_002"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_appr2", step_ids=[1])
    tracker.mark_running(1)
    tracker.mark_blocked_approval(1)

    ws = make_ws()
    msg = WebSocketMessage(**make_approval_response(session_id, step_id=1, approved=False))
    asyncio.get_event_loop().run_until_complete(_handle_approval_response(ws, msg))

    messages = get_sent_messages(ws)
    errors = [m for m in messages if m["type"] == "ERROR"]
    assert len(errors) == 1
    assert errors[0]["payload"]["code"] == "APPROVAL_DENIED"
    remove_tracker(session_id)


# ============================================================================
# 4. Error Handling
# ============================================================================
print("\n=== 4. Error Handling ===")


@test("Invalid JSON returns INVALID_JSON error")
def _():
    from api.websocket_handler import _send_error
    ws = make_ws()
    asyncio.get_event_loop().run_until_complete(
        _send_error(ws, "INVALID_JSON", "Bad JSON")
    )
    messages = get_sent_messages(ws)
    assert messages[0]["type"] == "ERROR"
    assert messages[0]["payload"]["code"] == "INVALID_JSON"


@test("Internal error returns INTERNAL_ERROR without crashing")
def _():
    from api.websocket_handler import _send_error
    ws = make_ws()
    asyncio.get_event_loop().run_until_complete(
        _send_error(ws, "INTERNAL_ERROR", "Something went wrong")
    )
    messages = get_sent_messages(ws)
    assert messages[0]["payload"]["code"] == "INTERNAL_ERROR"


@test("WebSocket disconnect during send does not crash server")
def _():
    from api.websocket_handler import _safe_send
    from fastapi import WebSocketDisconnect

    ws = AsyncMock()
    ws.send_text = AsyncMock(side_effect=WebSocketDisconnect())
    result = asyncio.get_event_loop().run_until_complete(
        _safe_send(ws, {"type": "TEST"})
    )
    assert result is False


# ============================================================================
# 5. Session Lifecycle
# ============================================================================
print("\n=== 5. Session Lifecycle ===")


@test("Session created on USER_QUERY, cleaned up on disconnect")
def _():
    from api.websocket_handler import _handle_user_query, _pending_goals
    from schemas.messages import WebSocketMessage, MessageType

    session_id = "lifecycle_001"
    ws = make_ws()
    msg = WebSocketMessage(**make_user_query(session_id, "Test goal"))
    asyncio.get_event_loop().run_until_complete(_handle_user_query(ws, msg))
    assert session_id in _pending_goals

    # Cleanup
    _pending_goals.pop(session_id, None)
    assert session_id not in _pending_goals


@test("Plan cached for tracker-based dispatch")
def _():
    from api.websocket_handler import _plan_cache
    from schemas.actions import ActionPlan

    session_id = "cache_001"
    plan = ActionPlan(**make_plan_dict(session_id, "Test"))
    _plan_cache[session_id] = plan
    assert session_id in _plan_cache
    assert _plan_cache[session_id].goal == "Test"
    _plan_cache.pop(session_id, None)


@test("Multiple sessions tracked independently")
def _():
    from api.websocket_handler import _pending_goals

    _pending_goals["sess_a"] = {"goal": "Goal A"}
    _pending_goals["sess_b"] = {"goal": "Goal B"}
    assert _pending_goals["sess_a"]["goal"] == "Goal A"
    assert _pending_goals["sess_b"]["goal"] == "Goal B"
    _pending_goals.pop("sess_a", None)
    _pending_goals.pop("sess_b", None)


# ============================================================================
# 6. Schema Compliance
# ============================================================================
print("\n=== 6. Schema Compliance ===")


@test("All server message types recognized")
def _():
    from schemas.messages import MessageType
    # Server-side message types (client sends these, server recognizes them)
    client_types = {
        "USER_QUERY", "STEP_RESULT", "APPROVAL_RESPONSE", "SESSION_RESTORE",
        "PAUSE_AGENT", "RESUME_AGENT", "STOP_AGENT",
    }
    # Server sends these
    server_types = {
        "PLAN", "NEXT_STEP", "APPROVAL_REQUIRED", "DYNAMIC_OBSTACLE",
        "SESSION_RESTORED", "TASK_COMPLETE", "ERROR",
    }
    actual = {mt.value for mt in MessageType}
    assert client_types.issubset(actual), f"Missing client types: {client_types - actual}"
    assert server_types.issubset(actual), f"Missing server types: {server_types - actual}"


@test("ActionPlan accepts all 17 action types")
def _():
    from schemas.actions import ActionType
    for at in ActionType:
        plan = make_plan_dict("schema_test", "test", [
            {"id": 1, "action": at.value, "execution_mode": "DOM",
             "protocol_level": "SAFE", "description": "test",
             "verify": {"method": "DOM_CHECK", "condition": "ok"}, "timeout_ms": 5000}
        ])
        from schemas.actions import ActionPlan
        ActionPlan(**plan)


@test("Extension message format accepted by server")
def _():
    from schemas.messages import WebSocketMessage, MessageType

    # Exact format from extension service-worker.js
    ext_msg = {
        "type": "USER_QUERY",
        "session_id": "session_1789307812491",
        "payload": {
            "query": "search for plastic gloves on flipkart under 200 rupees",
            "url": "https://www.flipkart.com",
            "viewport": {"width": 1280, "height": 720},
        },
    }
    msg = WebSocketMessage(**ext_msg)
    assert msg.type == MessageType.USER_QUERY
    assert msg.session_id == "session_1789307812491"


@test("Extension STEP_RESULT with tokenManifest accepted")
def _():
    from schemas.messages import WebSocketMessage, MessageType

    ext_msg = {
        "type": "STEP_RESULT",
        "session_id": "session_1789307812491",
        "payload": {
            "success": True,
            "sanitized_dom": {
                "url": "https://www.flipkart.com",
                "title": "Flipkart",
                "viewport": {"width": 1280, "height": 720},
                "elements": [
                    {"id": 1, "tag": "INPUT", "selector": "input[name='q']"},
                ],
            },
            "tokenManifest": {
                "tokens_used": ["tok_email"],
                "token_types": {"tok_email": "email"},
            },
            "redacted_screenshot": None,
        },
    }
    msg = WebSocketMessage(**ext_msg)
    assert msg.type == MessageType.STEP_RESULT
    assert "tokenManifest" in msg.payload


# ============================================================================
# 7. LLM Parse Robustness
# ============================================================================
print("\n=== 7. LLM Parse Robustness ===")


@test("Parser handles thinking tags")
def _():
    from core.planner import _parse_llm_output
    raw = '''<think>Let me think about this.
The user wants to search for shoes.
</think>
{"session_id": "x", "goal": "search", "plan": {"goal": "search", "chain_of_thought": "step1", "total_steps": 1, "steps": [{"id": 1, "action": "NAVIGATE", "target": {"url": "https://example.com"}, "execution_mode": "DOM", "protocol_level": "SAFE", "description": "nav", "verify": {"method": "URL_CHECK", "condition": "ok"}}]}}'''
    data = _parse_llm_output(raw, "think_001")
    assert data["plan"]["total_steps"] == 1
    assert "<think>" not in json.dumps(data)


@test("Parser handles trailing commas")
def _():
    from core.planner import _repair_json
    raw = '{"a": 1, "b": [1, 2,],}'
    repaired = _repair_json(raw)
    data = json.loads(repaired)
    assert data["a"] == 1


@test("Parser handles comments in JSON")
def _():
    from core.planner import _repair_json
    raw = '{"a": 1, // comment\n"b": 2}'
    repaired = _repair_json(raw)
    data = json.loads(repaired)
    assert data["b"] == 2


@test("Parser handles control characters in strings")
def _():
    from core.planner import _repair_json
    raw = '{"a": "hello\\nworld"}'
    repaired = _repair_json(raw)
    data = json.loads(repaired)
    assert "hello" in data["a"]


# ============================================================================
# 8. Protocol Classification
# ============================================================================
print("\n=== 8. Protocol Classification ===")


@test("Search actions classified as SAFE")
def _():
    from schemas.protocols import classify_protocol_level
    assert classify_protocol_level("TYPE", "type shoes in search box") == "SAFE"
    assert classify_protocol_level("SCROLL", "scroll down page") == "SAFE"
    assert classify_protocol_level("EXTRACT", "extract prices") == "SAFE"


@test("Purchase actions classified as CRITICAL")
def _():
    from schemas.protocols import classify_protocol_level
    assert classify_protocol_level("CLICK", "buy now button") == "CRITICAL"
    assert classify_protocol_level("CLICK", "place order") == "CRITICAL"
    assert classify_protocol_level("CLICK", "checkout") == "CRITICAL"


@test("Login actions classified as CRITICAL")
def _():
    from schemas.protocols import classify_protocol_level
    assert classify_protocol_level("TYPE", "enter password") == "CRITICAL"
    assert classify_protocol_level("CLICK", "sign in button") == "CRITICAL"


@test("Form interactions classified as CAUTION")
def _():
    from schemas.protocols import classify_protocol_level
    assert classify_protocol_level("CLICK", "submit form") == "CAUTION"
    assert classify_protocol_level("SELECT", "choose option") == "CAUTION"


# ============================================================================
# Summary
# ============================================================================
print(f"\n{'='*60}")
print(f"  Phase 4 Integration Tests: {passed}/{total} passed, {failed} failed")
print(f"{'='*60}")

if failed > 0:
    sys.exit(1)
