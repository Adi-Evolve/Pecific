"""
Local integration tests — validates all components work together
without needing a running server or GPU.

Tests:
1. Schema validation & message parsing
2. Task tracker state machine
3. Plan generation pipeline (mocked LLM)
4. Websocket handler message routing (mocked websocket)
5. Protocol engine classification
6. Session manager CRUD
7. Memory store operations
"""

import asyncio
import json
import sys
from unittest.mock import AsyncMock, MagicMock, patch
from pathlib import Path
from fastapi import WebSocketDisconnect

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


# ============================================================================
# 1. Schema validation
# ============================================================================
print("\n=== 1. Schema Validation ===")


@test("WebSocketMessage parses USER_QUERY")
def _():
    from schemas.messages import WebSocketMessage, MessageType
    msg = WebSocketMessage(
        type=MessageType.USER_QUERY,
        session_id="session_1726052000100",
        payload={"query": "test", "url": "https://example.com"},
    )
    assert msg.type == MessageType.USER_QUERY
    assert msg.session_id == "session_1726052000100"
    assert msg.payload["query"] == "test"


@test("WebSocketMessage parses STEP_RESULT with sanitized_dom")
def _():
    from schemas.messages import WebSocketMessage, MessageType
    msg = WebSocketMessage(
        type=MessageType.STEP_RESULT,
        session_id="session_1726052000100",
        payload={
            "success": True,
            "sanitized_dom": {
                "url": "https://example.com",
                "title": "Test",
                "elements": [{"id": 1, "tag": "INPUT", "selector": "input#q"}],
            },
        },
    )
    assert msg.type == MessageType.STEP_RESULT
    assert len(msg.payload["sanitized_dom"]["elements"]) == 1


@test("WebSocketMessage parses STEP_RESULT with step_id (execution result)")
def _():
    from schemas.messages import WebSocketMessage, MessageType
    msg = WebSocketMessage(
        type=MessageType.STEP_RESULT,
        session_id="session_1726052000100",
        payload={"step_id": 1, "success": True, "action": "CLICK"},
    )
    assert msg.payload["step_id"] == 1
    assert msg.payload["success"] is True


@test("ActionPlan parses from LLM-style dict")
def _():
    from schemas.actions import ActionPlan
    data = {
        "session_id": "session_123",
        "goal": "Search for something",
        "plan": {
            "goal": "Search for something",
            "chain_of_thought": "Step 1: navigate, Step 2: search",
            "total_steps": 2,
            "steps": [
                {
                    "id": 1,
                    "action": "NAVIGATE",
                    "target": {"url": "https://example.com"},
                    "execution_mode": "DOM",
                    "protocol_level": "SAFE",
                    "description": "Navigate to example.com",
                    "verify": {"method": "URL_CHECK", "condition": "contains example.com"},
                },
                {
                    "id": 2,
                    "action": "TYPE",
                    "target": {"selector": "input#q"},
                    "value": "search term",
                    "execution_mode": "DOM",
                    "protocol_level": "SAFE",
                    "description": "Type search term",
                },
            ],
        },
    }
    plan = ActionPlan(**data)
    assert plan.plan.total_steps == 2
    assert plan.plan.steps[0].action.value == "NAVIGATE"
    assert plan.plan.steps[1].action.value == "TYPE"
    assert plan.plan.steps[1].value == "search term"


@test("ActionPlan validates all 17 action types")
def _():
    from schemas.actions import ActionType
    expected = {
        "TYPE", "CLICK", "PRESS_KEY", "NAVIGATE", "NEW_TAB", "EXTRACT",
        "DISMISS_POPUP", "TYPE_FROM_VAULT", "CAPTCHA_HANDOFF", "REPORT_RESULT",
        "SCROLL", "SELECT", "WAIT", "SCREENSHOT", "SWITCH_TAB", "CLOSE_TAB", "HOVER",
    }
    actual = {a.value for a in ActionType}
    assert expected == actual, f"Missing: {expected - actual}, Extra: {actual - expected}"


# ============================================================================
# 2. Task Tracker State Machine
# ============================================================================
print("\n=== 2. Task Tracker ===")


@test("TaskTracker initializes plan with steps")
def _():
    from state.task_tracker import get_tracker, remove_tracker
    session_id = "test_tracker_init"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_1", step_ids=[1, 2, 3])
    assert tracker.get_next_executable() is not None
    assert tracker.get_next_executable().step_id == 1
    remove_tracker(session_id)


@test("TaskTracker step lifecycle: PENDING -> RUNNING -> SUCCESS")
def _():
    from state.task_tracker import get_tracker, remove_tracker, StepState
    session_id = "test_tracker_lifecycle"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_2", step_ids=[1, 2])

    step = tracker.get_next_executable()
    assert step.state == StepState.PENDING

    tracker.mark_running(1)
    step = tracker.get_step(1)
    assert step.state == StepState.RUNNING

    tracker.mark_success(1)
    step = tracker.get_step(1)
    assert step.state == StepState.SUCCESS

    next_step = tracker.get_next_executable()
    assert next_step.step_id == 2
    remove_tracker(session_id)


@test("TaskTracker plan completion detection")
def _():
    from state.task_tracker import get_tracker, remove_tracker
    session_id = "test_tracker_complete"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_3", step_ids=[1])

    tracker.mark_running(1)
    tracker.mark_success(1)
    assert tracker.is_plan_complete() is True
    assert tracker.get_next_executable() is None
    remove_tracker(session_id)


@test("TaskTracker failure and retry")
def _():
    from state.task_tracker import get_tracker, remove_tracker, StepState
    session_id = "test_tracker_retry"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_4", step_ids=[1])

    tracker.mark_running(1)
    tracker.mark_failed(1, error="Element not found")
    step = tracker.get_step(1)
    assert step.state == StepState.FAILED
    assert step.last_error == "Element not found"
    remove_tracker(session_id)


@test("TaskTracker pause/resume")
def _():
    from state.task_tracker import get_tracker, remove_tracker, StepState
    session_id = "test_tracker_pause"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_5", step_ids=[1, 2])
    tracker.mark_running(1)

    tracker.pause()
    assert tracker.is_paused() is True

    tracker.resume()
    assert tracker.is_paused() is False
    remove_tracker(session_id)


@test("TaskTracker stop")
def _():
    from state.task_tracker import get_tracker, remove_tracker, StepState
    session_id = "test_tracker_stop"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_6", step_ids=[1, 2])
    tracker.mark_running(1)

    tracker.stop()
    assert tracker.is_stopped() is True
    assert tracker.get_next_executable() is None
    remove_tracker(session_id)


@test("Global registry tracks multiple sessions")
def _():
    from state.task_tracker import get_tracker, remove_tracker, _trackers
    remove_tracker("test_reg_a")
    remove_tracker("test_reg_b")
    get_tracker("test_reg_a").initialize_plan("p1", step_ids=[1])
    get_tracker("test_reg_b").initialize_plan("p2", step_ids=[1, 2])
    assert "test_reg_a" in _trackers
    assert "test_reg_b" in _trackers
    remove_tracker("test_reg_a")
    remove_tracker("test_reg_b")
    assert "test_reg_a" not in _trackers
    assert "test_reg_b" not in _trackers


# ============================================================================
# 3. Protocol Engine
# ============================================================================
print("\n=== 3. Protocol Engine ===")


@test("SAFE actions classified correctly")
def _():
    from schemas.actions import ActionPlan
    from core.protocol_engine import classify_plan_steps
    plan = ActionPlan(
        session_id="s1", goal="test",
        plan={
            "goal": "test", "chain_of_thought": "x", "total_steps": 1,
            "steps": [{"id": 1, "action": "NAVIGATE", "target": {"url": "https://example.com"},
                        "execution_mode": "DOM", "protocol_level": "SAFE",
                        "description": "nav", "verify": {"method": "URL_CHECK", "condition": "ok"}}],
        },
    )
    classify_plan_steps(plan)
    assert plan.plan.steps[0].protocol_level == "SAFE"


@test("CRITICAL actions detected for purchase")
def _():
    from schemas.actions import ActionPlan
    from core.protocol_engine import classify_plan_steps, has_critical_steps
    plan = ActionPlan(
        session_id="s2", goal="buy item",
        plan={
            "goal": "buy", "chain_of_thought": "x", "total_steps": 1,
            "steps": [{"id": 1, "action": "CLICK", "target": {"selector": "#buy-now"},
                        "execution_mode": "DOM", "protocol_level": "SAFE",
                        "description": "click buy", "verify": {"method": "DOM_CHECK", "condition": "ok"}}],
        },
    )
    classify_plan_steps(plan)
    assert has_critical_steps(plan) is True


@test("FORBIDDEN action rejected")
def _():
    from schemas.protocols import classify_protocol_level
    level = classify_protocol_level(action="CLOSE_TAB", description="Close the tab")
    assert level == "FORBIDDEN"


# ============================================================================
# 4. WebSocket Handler Routing (mocked)
# ============================================================================
print("\n=== 4. WebSocket Handler Routing ===")


@test("USER_QUERY routes to _handle_user_query")
def _():
    from api.websocket_handler import _route_message, _pending_goals
    from schemas.messages import WebSocketMessage, MessageType

    ws = AsyncMock()
    msg = WebSocketMessage(
        type=MessageType.USER_QUERY,
        session_id="test_route_1",
        payload={"query": "test goal", "url": "https://example.com"},
    )
    asyncio.get_event_loop().run_until_complete(_route_message(ws, msg))
    assert "test_route_1" in _pending_goals
    assert _pending_goals["test_route_1"]["goal"] == "test goal"
    _pending_goals.pop("test_route_1", None)


@test("STEP_RESULT with dom triggers plan generation")
def _():
    from api.websocket_handler import _handle_step_result, _pending_goals
    from schemas.messages import WebSocketMessage, MessageType

    _pending_goals["test_route_2"] = {"goal": "test", "url": "https://example.com"}
    ws = AsyncMock()
    msg = WebSocketMessage(
        type=MessageType.STEP_RESULT,
        session_id="test_route_2",
        payload={
            "sanitized_dom": {"url": "https://example.com", "elements": []},
            "vault_manifest": {},
        },
    )

    with patch("api.websocket_handler.generate_plan") as mock_gen:
        mock_plan = MagicMock()
        mock_plan.plan.steps = []
        mock_plan.plan.total_steps = 0
        mock_plan.goal = "test"
        mock_gen.return_value = mock_plan

        with patch("api.websocket_handler.get_session_manager", create=True) as mock_sm:
            mock_sm.return_value = MagicMock()
            with patch("state.session_manager.get_session_manager") as mock_sm2:
                mock_sm2.return_value = MagicMock()
                asyncio.get_event_loop().run_until_complete(_handle_step_result(ws, msg))

    assert ws.send_text.called
    first_call = ws.send_text.call_args_list[0]
    sent = json.loads(first_call[0][0])
    assert sent["type"] == "ACK"
    _pending_goals.pop("test_route_2", None)


@test("STEP_RESULT with step_id routes to execution handler")
def _():
    from api.websocket_handler import _handle_step_result, _pending_goals
    from schemas.messages import WebSocketMessage, MessageType

    ws = AsyncMock()
    msg = WebSocketMessage(
        type=MessageType.STEP_RESULT,
        session_id="test_route_3",
        payload={"step_id": 1, "success": True},
    )

    with patch("api.websocket_handler._handle_step_execution_result") as mock_exec:
        asyncio.get_event_loop().run_until_complete(_handle_step_result(ws, msg))
        assert mock_exec.called


@test("Unknown message type returns ERROR")
def _():
    from api.websocket_handler import _route_message
    from schemas.messages import WebSocketMessage, MessageType

    ws = AsyncMock()
    msg = WebSocketMessage(
        type=MessageType.USER_QUERY,
        session_id="test_unknown",
        payload={},
    )
    asyncio.get_event_loop().run_until_complete(_route_message(ws, msg))


@test("Invalid JSON returns INVALID_JSON error")
def _():
    from api.websocket_handler import _send_error
    ws = AsyncMock()
    asyncio.get_event_loop().run_until_complete(
        _send_error(ws, "INVALID_JSON", "Message is not valid JSON")
    )
    assert ws.send_text.called
    sent = json.loads(ws.send_text.call_args_list[-1][0][0])
    assert sent["type"] == "ERROR"
    assert sent["payload"]["code"] == "INVALID_JSON"


# ============================================================================
# 5. Session Manager
# ============================================================================
print("\n=== 5. Session Manager ===")


@test("Create and retrieve session")
def _():
    from state.session_manager import get_session_manager
    mgr = get_session_manager()
    mgr.create_session("test_sm_1", goal="buy milk")
    session = mgr.restore_session("test_sm_1")
    assert session is not None
    assert session["goal"] == "buy milk"
    mgr.archive_session("test_sm_1")


@test("Update session with plan data")
def _():
    from state.session_manager import get_session_manager
    mgr = get_session_manager()
    mgr.create_session("test_sm_2", goal="search")
    mgr.update_session("test_sm_2", plan_id="plan_x", step_ids=[1, 2, 3])
    session = mgr.restore_session("test_sm_2")
    assert session["plan_id"] == "plan_x"
    assert session["step_ids"] == [1, 2, 3]
    mgr.archive_session("test_sm_2")


@test("Non-existent session returns None")
def _():
    from state.session_manager import get_session_manager
    mgr = get_session_manager()
    session = mgr.restore_session("nonexistent_session_xyz")
    assert session is None


# ============================================================================
# 6. Memory Store
# ============================================================================
print("\n=== 6. Memory Store ===")


@test("Store and retrieve preferences")
def _():
    from state.memory_store import get_memory_store
    store = get_memory_store()
    store.store_preference("test_pref_key", {"theme": "dark"})
    prefs = store.get_preferences()
    assert isinstance(prefs, dict)


@test("Store and retrieve goals")
def _():
    from state.memory_store import get_memory_store
    store = get_memory_store()
    store.store_goal("test_goal_1", {"goal": "Search for shoes", "status": "completed"})
    goals = store.get_completed_goals()
    assert isinstance(goals, list)


@test("Session context assembly")
def _():
    from state.memory_store import get_memory_store
    store = get_memory_store()
    ctx = store.get_session_context("any_session_id")
    assert isinstance(ctx, dict)


# ============================================================================
# 7. Planner (mocked LLM)
# ============================================================================
print("\n=== 7. Planner (mocked LLM) ===")


@test("generate_plan builds correct prompt structure")
def _():
    from core.planner import _build_prompt
    prompt = _build_prompt(
        goal="Search for laptop",
        url="https://flipkart.com",
        sanitized_dom={"elements": [{"id": 1, "tag": "INPUT", "selector": "input#q", "role": "searchbox"}]},
        vault_manifest={"fields": {"email": False}},
    )
    assert "Search for laptop" in prompt
    assert "flipkart.com" in prompt
    assert "[1]" in prompt
    assert "email" in prompt


@test("DOM elements formatted correctly for prompt")
def _():
    from core.planner import _format_dom_elements
    dom = {
        "elements": [
            {"id": 1, "tag": "INPUT", "role": "searchbox", "selector": "input#q", "text": "", "type": "text", "placeholder": "Search"},
            {"id": 2, "tag": "BUTTON", "role": "button", "selector": "button[type=submit]", "text": "Submit"},
        ]
    }
    text = _format_dom_elements(dom)
    assert "[1] <INPUT>" in text
    assert "[2] <BUTTON>" in text
    assert "role=searchbox" in text


@test("LLM output parser extracts JSON from markdown fences")
def _():
    from core.planner import _parse_llm_output
    raw = '''Here is the plan:
```json
{"session_id": "x", "goal": "test", "plan": {"goal": "test", "chain_of_thought": "step1", "total_steps": 1, "steps": [{"id": 1, "action": "NAVIGATE", "target": {"url": "https://example.com"}, "execution_mode": "DOM", "protocol_level": "SAFE", "description": "nav", "verify": {"method": "URL_CHECK", "condition": "ok"}}]}}
```
'''
    data = _parse_llm_output(raw, "session_override")
    assert data["session_id"] == "session_override"
    assert data["plan"]["total_steps"] == 1


@test("LLM output parser handles raw JSON (no fences)")
def _():
    from core.planner import _parse_llm_output
    raw = '{"session_id": "x", "goal": "y", "plan": {"goal": "y", "chain_of_thought": "z", "total_steps": 0, "steps": []}}'
    data = _parse_llm_output(raw, "s1")
    assert data["plan"]["steps"] == []


@test("LLM output parser handles JSON with surrounding text")
def _():
    from core.planner import _parse_llm_output
    raw = 'Sure! Here is the plan:\n{"session_id":"x","goal":"y","plan":{"goal":"y","chain_of_thought":"z","total_steps":0,"steps":[]}}\nLet me know if you need changes.'
    data = _parse_llm_output(raw, "s2")
    assert data["plan"]["total_steps"] == 0


# ============================================================================
# 8. VLM Client (httpx-based, mocked)
# ============================================================================
print("\n=== 8. VLM Client ===")


@test("VLM client constructs correct URLs")
def _():
    from core.vlm_client import VLM_ENDPOINTS
    from config import get_settings
    settings = get_settings()
    assert settings.VLM_SERVER_URL is not None
    assert "detect_obstacle" in VLM_ENDPOINTS
    assert "ground" in VLM_ENDPOINTS


@test("VLM client sends correct request format")
def _():
    from core.vlm_client import _post
    from config import get_settings

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"grounded": True, "elements": []}
    mock_response.raise_for_status = MagicMock()

    with patch("core.vlm_client.httpx.AsyncClient") as mock_httpx:
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_httpx.return_value = mock_client
        result = asyncio.get_event_loop().run_until_complete(
            _post("/detect_obstacle", {"screenshot": "fake_b64"})
        )
        assert result is not None


# ============================================================================
# Summary
# ============================================================================
print(f"\n{'='*60}")
print(f"  Results: {passed}/{total} passed, {failed} failed")
print(f"{'='*60}")

if failed > 0:
    sys.exit(1)
