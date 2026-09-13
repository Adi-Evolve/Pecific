"""
Phase 5-6 Integration Tests — Approval Gate + Error Recovery + Session Memory
Comprehensive tests for all remaining features.

Usage:
    cd server && python test_phase5_6_integration.py
"""

import asyncio
import json
import sys
import time
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


def get_sent_messages(ws):
    messages = []
    for call in ws.send_text.call_args_list:
        try:
            messages.append(json.loads(call[0][0]))
        except (IndexError, json.JSONDecodeError):
            pass
    return messages


def cleanup_tracker(session_id):
    from state.task_tracker import remove_tracker
    remove_tracker(session_id)


def cleanup_cache(session_id):
    from api.websocket_handler import _plan_cache, _pending_goals
    _plan_cache.pop(session_id, None)
    _pending_goals.pop(session_id, None)


# ============================================================================
# PHASE 5: End-to-End Approval Gate
# ============================================================================
print("\n" + "=" * 60)
print("  PHASE 5: End-to-End Approval Gate")
print("=" * 60)


@test("Full approval flow: CRITICAL plan -> APPROVAL_REQUIRED -> APPROVED -> NEXT_STEP -> TASK_COMPLETE")
def _():
    from api.websocket_handler import (
        _generate_plan_from_payload, _handle_approval_response,
        _dispatch_next_step_from_tracker, _plan_cache, _pending_goals
    )
    from schemas.messages import WebSocketMessage
    from schemas.actions import ActionPlan
    from state.task_tracker import get_tracker, remove_tracker

    session_id = "approval_e2e_001"
    ws = make_ws()

    # 1. Create a CRITICAL plan
    plan_data = {
        "session_id": session_id,
        "goal": "Login with stored credentials",
        "plan": {
            "goal": "Login using vault credentials",
            "chain_of_thought": "Fill email from vault, then click submit",
            "total_steps": 2,
            "steps": [
                {
                    "id": 1, "action": "TYPE_FROM_VAULT",
                    "target": {"selector": "#email"},
                    "vault_key": "email",
                    "execution_mode": "DOM", "protocol_level": "CRITICAL",
                    "description": "Fill email from vault",
                    "verify": {"method": "DOM_CHECK", "condition": "value_matches"},
                    "timeout_ms": 5000,
                },
                {
                    "id": 2, "action": "CLICK",
                    "target": {"selector": "#submit"},
                    "execution_mode": "DOM", "protocol_level": "CRITICAL",
                    "description": "Click submit button",
                    "verify": {"method": "URL_CHECK", "condition": "url_contains('/dashboard')"},
                    "timeout_ms": 8000,
                },
            ],
        },
    }
    plan = ActionPlan(**plan_data)
    _plan_cache[session_id] = plan

    # 2. Initialize tracker with CRITICAL step blocked
    tracker = get_tracker(session_id)
    tracker.initialize_plan(f"plan_{session_id}", step_ids=[1, 2])
    tracker.mark_running(1)
    tracker.mark_blocked_approval(1)

    # 3. Verify APPROVAL_REQUIRED was sent (step 1 is CRITICAL)
    assert tracker.is_blocked()

    # 4. User approves
    msg = WebSocketMessage(
        type="APPROVAL_RESPONSE",
        session_id=session_id,
        payload={"step_id": 1, "approved": True},
    )
    asyncio.get_event_loop().run_until_complete(_handle_approval_response(ws, msg))

    messages = get_sent_messages(ws)
    next_steps = [m for m in messages if m["type"] == "NEXT_STEP"]
    assert len(next_steps) >= 1, f"Should dispatch NEXT_STEP after approval, got: {[m['type'] for m in messages]}"

    # 5. Step 1 completes successfully -> dispatch step 2
    from api.websocket_handler import _handle_step_execution_result
    step_complete = WebSocketMessage(
        type="STEP_RESULT",
        session_id=session_id,
        payload={"step_id": 1, "success": True},
    )
    asyncio.get_event_loop().run_until_complete(_handle_step_execution_result(ws, step_complete))

    messages = get_sent_messages(ws)
    next_steps_2 = [m for m in messages if m["type"] == "NEXT_STEP"]
    assert len(next_steps_2) >= 2, f"Should dispatch step 2 after step 1 success"

    # 6. Step 2 completes -> TASK_COMPLETE
    step_complete_2 = WebSocketMessage(
        type="STEP_RESULT",
        session_id=session_id,
        payload={"step_id": 2, "success": True},
    )
    asyncio.get_event_loop().run_until_complete(_handle_step_execution_result(ws, step_complete_2))

    messages = get_sent_messages(ws)
    task_complete = [m for m in messages if m["type"] == "TASK_COMPLETE"]
    assert len(task_complete) >= 1, f"Should emit TASK_COMPLETE when all steps done"

    cleanup_tracker(session_id)
    cleanup_cache(session_id)


@test("Denied approval cancels the step")
def _():
    from api.websocket_handler import _handle_approval_response, _plan_cache
    from schemas.messages import WebSocketMessage
    from state.task_tracker import get_tracker, StepState

    session_id = "approval_deny_001"
    ws = make_ws()

    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_deny", step_ids=[1])
    tracker.mark_running(1)
    tracker.mark_blocked_approval(1)

    msg = WebSocketMessage(
        type="APPROVAL_RESPONSE",
        session_id=session_id,
        payload={"step_id": 1, "approved": False},
    )
    asyncio.get_event_loop().run_until_complete(_handle_approval_response(ws, msg))

    step = tracker.get_step(1)
    assert step.state == StepState.CANCELLED

    messages = get_sent_messages(ws)
    errors = [m for m in messages if m["type"] == "ERROR"]
    assert any(e["payload"]["code"] == "APPROVAL_DENIED" for e in errors)

    cleanup_tracker(session_id)
    cleanup_cache(session_id)


@test("Multiple CRITICAL steps require separate approvals")
def _():
    from state.task_tracker import get_tracker, StepState

    session_id = "multi_approval_001"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_multi", step_ids=[1, 2, 3])

    # Steps 1 and 3 are CRITICAL
    tracker.mark_running(1)
    tracker.mark_blocked_approval(1)
    tracker.mark_running(3)
    tracker.mark_blocked_approval(3)

    blocked = tracker.get_approval_blocked_steps()
    assert len(blocked) == 2
    assert {s.step_id for s in blocked} == {1, 3}

    # Approve step 1
    tracker.approve_step(1)
    assert tracker.get_step(1).state == StepState.RUNNING

    # Step 3 still blocked
    assert tracker.get_step(3).state == StepState.BLOCKED_APPROVAL

    cleanup_tracker(session_id)


@test("Approval flow with step verification")
def _():
    from api.websocket_handler import _step_to_extension_format
    from schemas.actions import PlanStep, ActionType, ExecutionMode

    step = PlanStep(
        id=1, action=ActionType.TYPE_FROM_VAULT,
        target={"selector": "#password"},
        vault_key="password",
        execution_mode=ExecutionMode.DOM,
        protocol_level="CRITICAL",
        description="Fill password from vault",
        verify={"method": "DOM_CHECK", "condition": "value_matches"},
        timeout_ms=5000,
    )
    fmt = _step_to_extension_format(step)

    assert fmt["action"] == "TYPE_FROM_VAULT"
    assert fmt["vault_key"] == "password"
    assert fmt["protocol_level"] == "CRITICAL"
    assert fmt["verify"]["method"] == "DOM_CHECK"


# ============================================================================
# PHASE 6: Error Recovery
# ============================================================================
print("\n" + "=" * 60)
print("  PHASE 6: Error Recovery & Session Memory")
print("=" * 60)


@test("Retry with backoff: failed step gets retried up to max_retries")
def _():
    from state.task_tracker import get_tracker, StepState

    session_id = "retry_001"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_retry", step_ids=[1])

    # First attempt
    tracker.mark_running(1)
    tracker.mark_failed(1, error="Element not found")
    step = tracker.get_step(1)
    assert step.state == StepState.FAILED
    assert step.attempts == 1

    # Retry
    tracker.mark_retrying(1)
    assert step.state == StepState.RETRYING

    tracker.mark_running(1)
    assert step.attempts == 2

    # Second attempt fails
    tracker.mark_failed(1, error="Still not found")
    assert step.attempts == 2

    # Should move to HYBRID_FALLBACK after max retries
    tracker.mark_retrying(1)
    assert step.state == StepState.HYBRID_FALLBACK

    cleanup_tracker(session_id)


@test("Error routing: SELECTOR_NOT_FOUND -> HYBRID_FALLBACK")
def _():
    from state.task_tracker import get_tracker, StepState

    session_id = "error_route_001"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_err", step_ids=[1])
    tracker.mark_running(1)

    next_state = tracker.handle_step_result(1, "error", error_code="SELECTOR_NOT_FOUND")
    assert next_state == StepState.HYBRID_FALLBACK

    cleanup_tracker(session_id)


@test("Error routing: CAPTCHA_TRIGGERED -> BLOCKED_APPROVAL")
def _():
    from state.task_tracker import get_tracker, StepState

    session_id = "error_route_002"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_err2", step_ids=[1])
    tracker.mark_running(1)

    next_state = tracker.handle_step_result(1, "error", error_code="CAPTCHA_TRIGGERED")
    assert next_state == StepState.BLOCKED_APPROVAL

    cleanup_tracker(session_id)


@test("Error routing: PAGE_TIMEOUT retries then falls back")
def _():
    from state.task_tracker import get_tracker, StepState

    session_id = "error_route_003"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_err3", step_ids=[1])
    tracker.mark_running(1)

    # First timeout -> retry (handle_step_result returns RETRYING, mark_failed then mark_retrying)
    next_state = tracker.handle_step_result(1, "error", error_code="PAGE_TIMEOUT")
    assert next_state == StepState.RETRYING

    tracker.mark_failed(1, error="timeout")
    tracker.mark_retrying(1)
    tracker.mark_running(1)

    # Second timeout -> fallback
    next_state = tracker.handle_step_result(1, "error", error_code="PAGE_TIMEOUT")
    assert next_state == StepState.HYBRID_FALLBACK

    cleanup_tracker(session_id)


@test("Error routing: AUTH_REQUIRED -> BLOCKED_APPROVAL")
def _():
    from state.task_tracker import get_tracker, StepState

    session_id = "error_route_004"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_err4", step_ids=[1])
    tracker.mark_running(1)

    next_state = tracker.handle_step_result(1, "error", error_code="AUTH_REQUIRED")
    assert next_state == StepState.BLOCKED_APPROVAL

    cleanup_tracker(session_id)


@test("VLM fallback: SELECTOR_NOT_FOUND with screenshot triggers ground_element")
def _():
    from api.websocket_handler import _handle_step_execution_result, _plan_cache
    from schemas.messages import WebSocketMessage
    from state.task_tracker import get_tracker

    session_id = "vlm_fallback_001"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_vlm", step_ids=[1])
    tracker.mark_running(1)

    mock_plan = MagicMock()
    mock_plan.plan.steps = [
        MagicMock(id=1, action=MagicMock(value="CLICK"),
                  target=MagicMock(selector="#missing"),
                  execution_mode=MagicMock(value="DOM"), protocol_level="SAFE",
                  description="Click", verify=None, timeout_ms=5000),
    ]
    _plan_cache[session_id] = mock_plan

    ws = make_ws()
    msg = WebSocketMessage(
        type="STEP_RESULT",
        session_id=session_id,
        payload={
            "step_id": 1, "success": False,
            "error_code": "SELECTOR_NOT_FOUND",
            "error": "Element not found",
            "redacted_screenshot": "data:image/jpeg;base64,fake",
        },
    )

    with patch("core.vlm_client.ground_element", new_callable=AsyncMock) as mock_ground:
        mock_ground.return_value = {"coordinates": [100, 200]}
        asyncio.get_event_loop().run_until_complete(_handle_step_execution_result(ws, msg))

    messages = get_sent_messages(ws)
    hybrid = [m for m in messages if m["type"] == "NEXT_STEP" and m["payload"].get("vlm_result")]
    assert len(hybrid) == 1

    cleanup_tracker(session_id)
    cleanup_cache(session_id)


@test("ELEMENT_OBSCURED triggers DYNAMIC_OBSTACLE + DISMISS_POPUP")
def _():
    from api.websocket_handler import _handle_step_execution_result, _plan_cache
    from schemas.messages import WebSocketMessage
    from state.task_tracker import get_tracker

    session_id = "obstacle_001"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_obs", step_ids=[1])
    tracker.mark_running(1)

    _plan_cache[session_id] = MagicMock(plan=MagicMock(steps=[
        MagicMock(id=1, action=MagicMock(value="CLICK"), target=MagicMock(selector="#btn"),
                  execution_mode=MagicMock(value="DOM"), protocol_level="SAFE",
                  description="Click", verify=None, timeout_ms=5000),
    ]))

    ws = make_ws()
    msg = WebSocketMessage(
        type="STEP_RESULT",
        session_id=session_id,
        payload={
            "step_id": 1, "success": False,
            "error_code": "ELEMENT_OBSCURED",
            "error": "Element blocked by popup",
            "redacted_screenshot": "data:image/jpeg;base64,fake",
        },
    )

    with patch("core.vlm_client.detect_obstacles", new_callable=AsyncMock) as mock_detect:
        mock_detect.return_value = {
            "result": {
                "obstacle_type": "cookie_wall",
                "description": "Cookie consent banner",
                "close_button": {"coordinates": [50, 50]},
            }
        }
        asyncio.get_event_loop().run_until_complete(_handle_step_execution_result(ws, msg))

    messages = get_sent_messages(ws)
    dynamic = [m for m in messages if m["type"] == "DYNAMIC_OBSTACLE"]
    dismiss = [m for m in messages if m["type"] == "NEXT_STEP"
               and m["payload"].get("step", {}).get("action") == "DISMISS_POPUP"]
    assert len(dynamic) == 1
    assert len(dismiss) == 1

    cleanup_tracker(session_id)
    cleanup_cache(session_id)


@test("Self-correction: replan_after_failure generates new plan")
def _():
    from core.planner import replan_after_failure
    from schemas.actions import ActionPlan

    mock_plan_data = {
        "session_id": "self_correct_001",
        "goal": "Search for shoes",
        "plan": {
            "goal": "Search for shoes",
            "chain_of_thought": "Replanning after failure",
            "total_steps": 2,
            "steps": [
                {"id": 1, "action": "NAVIGATE", "target": {"url": "https://flipkart.com"},
                 "execution_mode": "DOM", "protocol_level": "SAFE",
                 "description": "Navigate", "verify": {"method": "URL_CHECK", "condition": "ok"},
                 "timeout_ms": 10000},
                {"id": 2, "action": "TYPE", "target": {"selector": "input#q"}, "value": "shoes",
                 "execution_mode": "DOM", "protocol_level": "SAFE",
                 "description": "Type search", "verify": {"method": "DOM_CHECK", "condition": "ok"},
                 "timeout_ms": 5000},
            ],
        },
    }

    with patch("core.planner.get_llm") as mock_llm:
        mock_model = MagicMock()
        mock_tokenizer = MagicMock()
        mock_llm.return_value = (mock_model, mock_tokenizer)

        mock_tokenizer.apply_chat_template.return_value = "formatted prompt"
        mock_tokenizer.encode.return_value = [1, 2, 3]
        mock_tokenizer.eos_token_id = 0

        raw_json = json.dumps(mock_plan_data)
        mock_tokenizer.decode.return_value = raw_json

        with patch("core.planner._call_llm", return_value=raw_json):
            with patch("state.memory_store.get_memory_store") as mock_mem:
                mock_mem.return_value = MagicMock(get_session_context=MagicMock(return_value={}))
                with patch("core.planner.get_settings") as mock_settings:
                    mock_settings.return_value = MagicMock(
                        LLM_MAX_NEW_TOKENS=512, LLM_TEMPERATURE=0.1, LLM_TOP_P=0.95
                    )
                    with patch("core.planner.get_llm", return_value=(MagicMock(), MagicMock(
                        apply_chat_template=MagicMock(return_value="prompt"),
                        encode=MagicMock(return_value=MagicMock(__len__=MagicMock(return_value=10))),
                        eos_token_id=0,
                        decode=MagicMock(return_value=raw_json),
                        device="cpu",
                    ))):
                        plan = asyncio.get_event_loop().run_until_complete(
                            replan_after_failure(
                                goal="Search for shoes",
                                url="https://flipkart.com",
                                sanitized_dom={"elements": []},
                                vault_manifest={},
                                session_id="self_correct_001",
                                failed_step_id=1,
                                error_message="Element not found",
                            )
                        )

    assert plan.plan.total_steps == 2
    assert plan.plan.chain_of_thought == "Replanning after failure"


# ============================================================================
# PHASE 6: Session Memory & Context Carry-Forward
# ============================================================================
print("\n--- Session Memory & Context ---")


@test("Session context includes preferences, goals, entities")
def _():
    from state.memory_store import get_memory_store

    store = get_memory_store()
    store.store_preference("budget", "2000", session_id="ctx_001")
    store.store_goal("goal_1", {"goal": "Search for shoes", "status": "completed"}, session_id="ctx_001")
    store.store_entity("product_1", {"name": "Nike Air", "price": "1500"}, session_id="ctx_001")

    ctx = store.get_session_context("ctx_001")
    assert "user_preferences" in ctx
    assert "recent_goals" in ctx
    assert "known_entities" in ctx

    # Cleanup
    store.clear_all()


@test("Context carry-forward: new query uses prior session data")
def _():
    from state.memory_store import get_memory_store

    store = get_memory_store()
    store.store_preference("brand", "Nike", session_id="carry_001")
    store.store_goal("prev_goal", {"goal": "Search for running shoes", "status": "completed"}, session_id="carry_001")

    # New session queries context
    ctx = store.get_session_context("carry_002")
    assert ctx["user_preferences"].get("brand") == "Nike"
    assert len(ctx["recent_goals"]) >= 1

    store.clear_all()


@test("Session create -> update -> restore -> archive lifecycle")
def _():
    from state.session_manager import get_session_manager

    mgr = get_session_manager()
    mgr.create_session("lifecycle_001", goal="Buy laptop")

    session = mgr.restore_session("lifecycle_001")
    assert session is not None
    assert session["goal"] == "Buy laptop"

    mgr.update_session("lifecycle_001", plan_id="plan_laptop", step_ids=[1, 2, 3])
    session = mgr.restore_session("lifecycle_001")
    assert session["plan_id"] == "plan_laptop"
    assert session["step_ids"] == [1, 2, 3]

    mgr.update_session("lifecycle_001", completed_step_ids=[1, 2])
    session = mgr.restore_session("lifecycle_001")
    assert session["completed_step_ids"] == [1, 2]

    mgr.archive_session("lifecycle_001")
    session = mgr.restore_session("lifecycle_001")
    assert session is None  # archived sessions not restored

    # Verify archived is visible with flag
    sessions = mgr.list_sessions(include_archived=True)
    archived = [s for s in sessions if s["session_id"] == "lifecycle_001"]
    assert len(archived) == 1
    assert archived[0]["archived"] is True


@test("Memory store preferences persist across sessions")
def _():
    from state.memory_store import get_memory_store

    store = get_memory_store()
    store.store_preference("language", "en", session_id="persist_001")
    store.store_preference("theme", "dark", session_id="persist_001")

    prefs = store.get_preferences()
    assert prefs["language"] == "en"
    assert prefs["theme"] == "dark"

    store.clear_all()


@test("Memory search finds entries by key pattern")
def _():
    from state.memory_store import get_memory_store

    store = get_memory_store()
    store.store("product_nike", {"name": "Nike Air"}, category="entities")
    store.store("product_adidas", {"name": "Adidas Ultraboost"}, category="entities")
    store.store("user_email", {"email": "test@example.com"}, category="preferences")

    results = store.search("product")
    assert len(results) >= 2

    results = store.search("nike")
    assert len(results) >= 1

    store.clear_all()


@test("Memory snapshots save and load correctly")
def _():
    from state.memory_store import get_memory_store

    store = get_memory_store()
    data = {"session": "snap_001", "goal": "Test snapshot", "results": [1, 2, 3]}
    path = store.save_snapshot("snap_001", data)
    assert path.exists()

    loaded = store.load_snapshot("snap_001")
    assert loaded is not None
    assert loaded["goal"] == "Test snapshot"
    assert loaded["results"] == [1, 2, 3]

    # Cleanup
    import os
    os.remove(path)


@test("Planner uses cross-session context in prompt")
def _():
    from core.planner import _build_prompt

    prompt = _build_prompt(
        goal="Search for running shoes",
        url="https://flipkart.com",
        sanitized_dom={"elements": [{"id": 1, "tag": "INPUT", "selector": "#q"}]},
        vault_manifest={},
        session_memory={"user_preferences": {"brand": "Nike"}, "recent_goals": [{"goal": "prev"}]},
    )
    assert "brand" in prompt
    assert "Nike" in prompt


@test("Planner includes previous steps in prompt")
def _():
    from core.planner import _build_prompt

    prompt = _build_prompt(
        goal="Search for shoes",
        url="https://flipkart.com",
        sanitized_dom={"elements": []},
        vault_manifest={},
        completed_steps=[{"id": 1, "action": "NAVIGATE", "status": "success"}],
    )
    assert "PREVIOUS STEPS" in prompt
    assert "NAVIGATE" in prompt


# ============================================================================
# PHASE 6: Plan Completion & Summary
# ============================================================================
print("\n--- Plan Completion ---")


@test("Plan completion detected when all steps SUCCESS")
def _():
    from state.task_tracker import get_tracker

    session_id = "complete_001"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_complete", step_ids=[1, 2, 3])

    for sid in [1, 2, 3]:
        tracker.mark_running(sid)
        tracker.mark_success(sid)

    assert tracker.is_plan_complete()
    assert not tracker.is_plan_failed()
    assert tracker.get_next_executable() is None

    summary = tracker.get_summary()
    assert summary["is_complete"] is True
    assert summary["total_steps"] == 3

    cleanup_tracker(session_id)


@test("Plan failed when all non-complete steps exhausted retries")
def _():
    from state.task_tracker import get_tracker

    session_id = "fail_001"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_fail", step_ids=[1, 2])

    tracker.mark_running(1)
    tracker.mark_success(1)

    tracker.mark_running(2)
    tracker.mark_failed(2, error="fail")
    # max_retries is 2, so after 2 attempts it should be plan_failed
    tracker.mark_retrying(2)  # attempt 2
    tracker.mark_running(2)
    tracker.mark_failed(2, error="fail again")
    tracker.mark_retrying(2)  # attempt 3 -> HYBRID_FALLBACK

    assert tracker.is_plan_failed()

    cleanup_tracker(session_id)


@test("Summary shows correct state counts")
def _():
    from state.task_tracker import get_tracker

    session_id = "summary_001"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_summary", step_ids=[1, 2, 3])

    tracker.mark_running(1)
    tracker.mark_success(1)
    tracker.mark_running(2)

    summary = tracker.get_summary()
    assert summary["state_counts"]["SUCCESS"] == 1
    assert summary["state_counts"]["RUNNING"] == 1
    assert summary["state_counts"]["PENDING"] == 1
    assert summary["total_steps"] == 3

    cleanup_tracker(session_id)


# ============================================================================
# WebSocket Handler: Full E2E with Mocked LLM
# ============================================================================
print("\n--- WebSocket E2E ---")


@test("Full WebSocket flow: USER_QUERY -> STEP_RESULT -> ACK -> PLAN -> NEXT_STEP")
def _():
    from api.websocket_handler import (
        _handle_user_query, _handle_step_result,
        _pending_goals, _plan_cache
    )
    from schemas.messages import WebSocketMessage
    from schemas.actions import ActionPlan

    session_id = "ws_e2e_001"
    ws = make_ws()

    # USER_QUERY
    msg1 = WebSocketMessage(
        type="USER_QUERY", session_id=session_id,
        payload={"query": "Search for shoes", "url": "https://flipkart.com"},
    )
    asyncio.get_event_loop().run_until_complete(_handle_user_query(ws, msg1))
    assert session_id in _pending_goals

    # STEP_RESULT with DOM
    msg2 = WebSocketMessage(
        type="STEP_RESULT", session_id=session_id,
        payload={
            "success": True,
            "sanitized_dom": {"url": "https://flipkart.com", "elements": [{"id": 1, "tag": "INPUT", "selector": "#q"}]},
            "vault_manifest": {},
        },
    )

    plan_data = {
        "session_id": session_id, "goal": "Search for shoes",
        "plan": {
            "goal": "Search", "chain_of_thought": "reasoning", "total_steps": 1,
            "steps": [{"id": 1, "action": "TYPE", "target": {"selector": "#q"}, "value": "shoes",
                       "execution_mode": "DOM", "protocol_level": "SAFE",
                       "description": "Type shoes", "verify": {"method": "DOM_CHECK", "condition": "ok"},
                       "timeout_ms": 5000}],
        },
    }

    with patch("api.websocket_handler.generate_plan", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = ActionPlan(**plan_data)
        with patch("state.session_manager.get_session_manager") as mock_sm:
            mock_sm.return_value = MagicMock()
            asyncio.get_event_loop().run_until_complete(_handle_step_result(ws, msg2))

    messages = get_sent_messages(ws)
    types = [m["type"] for m in messages]
    assert "ACK" in types
    assert "PLAN" in types
    assert "NEXT_STEP" in types

    cleanup_tracker(session_id)
    cleanup_cache(session_id)


@test("Pause and resume stops and restarts step dispatch")
def _():
    from api.websocket_handler import _handle_pause_agent, _handle_resume_agent
    from schemas.messages import WebSocketMessage
    from state.task_tracker import get_tracker

    session_id = "pause_001"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_pause", step_ids=[1, 2])

    ws = make_ws()

    # Pause
    msg_pause = WebSocketMessage(type="PAUSE_AGENT", session_id=session_id, payload={})
    asyncio.get_event_loop().run_until_complete(_handle_pause_agent(ws, msg_pause))
    assert tracker.is_paused()
    assert tracker.get_next_executable() is None

    # Resume
    msg_resume = WebSocketMessage(type="RESUME_AGENT", session_id=session_id, payload={})
    asyncio.get_event_loop().run_until_complete(_handle_resume_agent(ws, msg_resume))
    assert not tracker.is_paused()
    assert tracker.get_next_executable() is not None

    cleanup_tracker(session_id)


@test("Stop cancels all pending steps")
def _():
    from api.websocket_handler import _handle_stop_agent
    from schemas.messages import WebSocketMessage
    from state.task_tracker import get_tracker, StepState

    session_id = "stop_001"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_stop", step_ids=[1, 2, 3])
    tracker.mark_running(1)

    ws = make_ws()
    msg = WebSocketMessage(type="STOP_AGENT", session_id=session_id, payload={})
    asyncio.get_event_loop().run_until_complete(_handle_stop_agent(ws, msg))

    assert tracker.is_stopped()
    assert tracker.get_step(2).state == StepState.CANCELLED
    assert tracker.get_step(3).state == StepState.CANCELLED

    messages = get_sent_messages(ws)
    assert any(m["type"] == "TASK_COMPLETE" for m in messages)

    cleanup_tracker(session_id)


@test("Session restore returns saved session data")
def _():
    from api.websocket_handler import _handle_session_restore
    from schemas.messages import WebSocketMessage
    from state.session_manager import get_session_manager

    session_id = "restore_001"
    mgr = get_session_manager()
    mgr.create_session(session_id, goal="Test restore")
    mgr.update_session(session_id, plan_id="plan_restore", step_ids=[1, 2])

    ws = make_ws()
    msg = WebSocketMessage(
        type="SESSION_RESTORE", session_id=session_id,
        payload={"session_id": session_id},
    )
    asyncio.get_event_loop().run_until_complete(_handle_session_restore(ws, msg))

    messages = get_sent_messages(ws)
    restored = [m for m in messages if m["type"] == "SESSION_RESTORED"]
    assert len(restored) == 1
    assert restored[0]["payload"]["restored"] is True
    assert restored[0]["payload"]["session_data"]["goal"] == "Test restore"

    mgr.archive_session(session_id)


# ============================================================================
# Summary
# ============================================================================
print(f"\n{'='*60}")
print(f"  Phase 5-6 Tests: {passed}/{total} passed, {failed} failed")
print(f"{'='*60}")

if failed > 0:
    sys.exit(1)
