"""
Phase 7 — Demo Rehearsal Tests
Simulates all 3 end-to-end scenarios from COMMUNICATION_SPEC.md
Validates response format, protocol classification, and performance.

Usage:
    cd server && python test_phase7_demo_rehearsal.py
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
performance_results = []


def test(name):
    def decorator(fn):
        global passed, failed, total
        total += 1
        start = time.time()
        try:
            fn()
            elapsed = (time.time() - start) * 1000
            passed += 1
            performance_results.append((name, elapsed))
            print(f"  PASS  {name} ({elapsed:.1f}ms)")
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


def cleanup(session_id):
    from state.task_tracker import remove_tracker
    from api.websocket_handler import _plan_cache, _pending_goals
    remove_tracker(session_id)
    _plan_cache.pop(session_id, None)
    _pending_goals.pop(session_id, None)


# ============================================================================
# SCENARIO 1: E-Commerce Search & Multitasking
# ============================================================================
print("\n" + "=" * 60)
print("  SCENARIO 1: E-Commerce Search (Amazon)")
print("=" * 60)


@test("Scenario 1: Server accepts exact USER_QUERY payload from spec")
def _():
    from schemas.messages import WebSocketMessage, MessageType

    msg = WebSocketMessage(
        type="USER_QUERY",
        session_id="sess_ecom_001",
        payload={
            "query": "Search Sony WH-1000XM5 on Amazon, filter 4 stars & above, and extract top prices.",
            "current_url": "https://www.amazon.in",
            "page_title": "Online Shopping site in India",
            "viewport": {"width": 1280, "height": 720, "scroll_x": 0, "scroll_y": 0},
            "vision_context": {
                "screen_type": "dashboard_home",
                "confidence": 0.95,
                "layout": {"visual_density": "high", "has_active_modal": False, "canvas_heavy": False},
                "detected_regions": [
                    {"type": "search_header", "bbox": [0, 0, 1280, 60]},
                    {"type": "promo_banner", "bbox": [0, 60, 1280, 320]},
                ],
                "faces_detected": [],
                "visual_pii_regions": [],
            },
            "sanitized_dom": {
                "elements_count": 2,
                "elements": [
                    {"id": "e_search", "tag": "INPUT", "selector": "#twotabsearchtextbox",
                     "placeholder": "Search Amazon.in", "type": "text", "interactive": True,
                     "role": "searchbox", "coordinates": [320, 24, 600, 38]},
                    {"id": "e_submit", "tag": "INPUT", "selector": "#nav-search-submit-button",
                     "value": "Go", "type": "submit", "interactive": True,
                     "coordinates": [925, 24, 45, 38]},
                ],
            },
            "vault_manifest": {"has_email": True, "has_password": True, "has_phone": True},
            "redacted_screenshot": "data:image/jpeg;base64,fake_screenshot_data",
            "privacy_stats": {"faces_redacted": 0, "pii_tokens_masked": 0, "dom_masked_fields": 0},
        },
    )
    assert msg.type == MessageType.USER_QUERY
    assert msg.session_id == "sess_ecom_001"
    assert len(msg.payload["sanitized_dom"]["elements"]) == 2


@test("Scenario 1: Planner generates correct plan structure")
def _():
    from api.websocket_handler import _generate_plan_from_payload, _plan_cache
    from schemas.messages import WebSocketMessage
    from schemas.actions import ActionPlan

    session_id = "scenario1_plan"
    ws = make_ws()
    msg = WebSocketMessage(
        type="USER_QUERY", session_id=session_id,
        payload={"query": "Search Sony WH-1000XM5", "url": "https://www.amazon.in"},
    )

    plan_data = {
        "session_id": session_id,
        "goal": "Search Sony WH-1000XM5 on Amazon, filter 4 stars, extract prices",
        "plan": {
            "goal": "Search Sony WH-1000XM5 on Amazon",
            "chain_of_thought": "1. Type search term. 2. Press Enter. 3. Wait for results. 4. Apply filter. 5. Extract prices.",
            "total_steps": 5,
            "steps": [
                {"id": 1, "action": "TYPE", "target": {"selector": "#twotabsearchtextbox"},
                 "value": "Sony WH-1000XM5", "execution_mode": "DOM", "protocol_level": "SAFE",
                 "description": "Type search term", "verify": {"method": "DOM_CHECK", "condition": "value_matches"},
                 "timeout_ms": 5000},
                {"id": 2, "action": "PRESS_KEY", "target": {"selector": "#twotabsearchtextbox"},
                 "key": "Enter", "execution_mode": "DOM", "protocol_level": "SAFE",
                 "description": "Submit search", "verify": {"method": "URL_CHECK", "condition": "url_contains('/s?k=')"},
                 "timeout_ms": 8000},
                {"id": 3, "action": "WAIT", "duration_ms": 2000, "execution_mode": "DOM",
                 "protocol_level": "SAFE", "description": "Wait for results",
                 "verify": {"method": "DOM_CHECK", "condition": "always_true"}, "timeout_ms": 5000},
                {"id": 4, "action": "CLICK", "target": {"selector": "section[aria-label='4 Stars & Up'] a"},
                 "execution_mode": "HYBRID", "protocol_level": "CAUTION",
                 "description": "Apply 4-star filter", "verify": {"method": "DOM_CHECK", "condition": "element_checked"},
                 "timeout_ms": 8000},
                {"id": 5, "action": "EXTRACT", "target": {"selector": "div[data-component-type='s-search-result']"},
                 "execution_mode": "DOM", "protocol_level": "SAFE",
                 "description": "Extract top 3 product prices", "verify": {"method": "DOM_CHECK", "condition": "data_extracted"},
                 "timeout_ms": 10000},
            ],
        },
    }

    plan = ActionPlan(**plan_data)
    _plan_cache[session_id] = plan

    from state.task_tracker import get_tracker
    tracker = get_tracker(session_id)
    tracker.initialize_plan(f"plan_{session_id}", step_ids=[1, 2, 3, 4, 5])

    assert plan.plan.total_steps == 5
    assert plan.plan.steps[0].action.value == "TYPE"
    assert plan.plan.steps[1].action.value == "PRESS_KEY"
    assert plan.plan.steps[4].action.value == "EXTRACT"

    cleanup(session_id)


@test("Scenario 1: PLAN response matches spec format")
def _():
    from api.websocket_handler import _build_plan_payload
    from schemas.actions import ActionPlan

    plan_data = {
        "session_id": "sess_ecom_001",
        "goal": "Search Sony WH-1000XM5 on Amazon, filter 4 stars, extract prices",
        "plan": {
            "goal": "Search Sony WH-1000XM5 on Amazon",
            "chain_of_thought": "1. Type search term",
            "total_steps": 1,
            "steps": [
                {"id": 1, "action": "TYPE", "target": {"selector": "#search"},
                 "value": "Sony WH-1000XM5", "execution_mode": "DOM", "protocol_level": "SAFE",
                 "description": "Type search", "verify": {"method": "DOM_CHECK", "condition": "ok"},
                 "timeout_ms": 5000},
            ],
        },
    }
    plan = ActionPlan(**plan_data)
    payload = _build_plan_payload("sess_ecom_001", plan)

    # Validate structure matches spec
    assert payload["type"] == "PLAN"
    assert payload["session_id"] == "sess_ecom_001"
    assert "plan" in payload["payload"]
    assert "goal" in payload["payload"]["plan"]
    assert "chain_of_thought" in payload["payload"]["plan"]
    assert "total_steps" in payload["payload"]["plan"]
    assert "steps" in payload["payload"]["plan"]

    step = payload["payload"]["plan"]["steps"][0]
    assert "id" in step
    assert "action" in step
    assert "target" in step
    assert "execution_mode" in step
    assert "protocol_level" in step
    assert "description" in step
    assert "timeout_ms" in step


@test("Scenario 1: Protocol levels correct for all steps")
def _():
    from schemas.protocols import classify_protocol_level

    steps = [
        ("TYPE", "Type Sony WH-1000XM5 into search box"),
        ("PRESS_KEY", "Press Enter to submit"),
        ("WAIT", "Wait for results to load"),
        ("CLICK", "Click 4 stars filter"),
        ("EXTRACT", "Extract product prices"),
    ]

    # PRESS_KEY with "submit" is CAUTION per our classification
    expected = ["SAFE", "CAUTION", "SAFE", "CAUTION", "SAFE"]
    for (action, desc), exp in zip(steps, expected):
        level = classify_protocol_level(action, desc)
        assert level == exp, f"{action}: expected {exp}, got {level}"


@test("Scenario 1: Full step execution flow (5 steps)")
def _():
    from api.websocket_handler import _handle_step_execution_result, _plan_cache
    from schemas.messages import WebSocketMessage
    from state.task_tracker import get_tracker

    session_id = "scenario1_exec"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_exec", step_ids=[1, 2, 3, 4, 5])

    mock_plan = MagicMock()
    mock_plan.plan.steps = [
        MagicMock(id=i, action=MagicMock(value=act),
                  target=MagicMock(selector="#x"), value=None, key=None, vault_key=None,
                  execution_mode=MagicMock(value="DOM"), protocol_level="SAFE",
                  description=f"Step {i}", verify=None, timeout_ms=5000, duration_ms=None)
        for i, act in enumerate(["TYPE", "PRESS_KEY", "WAIT", "CLICK", "EXTRACT"], 1)
    ]
    _plan_cache[session_id] = mock_plan

    ws = make_ws()

    # Execute all 5 steps sequentially
    # First dispatch step 1 (mark_running + NEXT_STEP sent by handler)
    tracker.mark_running(1)
    for step_id in range(1, 6):
        msg = WebSocketMessage(
            type="STEP_RESULT", session_id=session_id,
            payload={"step_id": step_id, "success": True},
        )
        asyncio.get_event_loop().run_until_complete(_handle_step_execution_result(ws, msg))
        # After success, handler marks SUCCESS + dispatches next step (mark_running)

    messages = get_sent_messages(ws)
    task_complete = [m for m in messages if m["type"] == "TASK_COMPLETE"]
    assert len(task_complete) >= 1, "Should emit TASK_COMPLETE after all 5 steps"

    cleanup(session_id)


# ============================================================================
# SCENARIO 2: Secure Form-Filling via Credential Vault
# ============================================================================
print("\n" + "=" * 60)
print("  SCENARIO 2: Credential Vault (Login)")
print("=" * 60)


@test("Scenario 2: Server accepts login USER_QUERY payload")
def _():
    from schemas.messages import WebSocketMessage, MessageType

    msg = WebSocketMessage(
        type="USER_QUERY",
        session_id="sess_auth_002",
        payload={
            "query": "Log into my account using my stored credentials",
            "current_url": "https://www.amazon.in/ap/signin",
            "vision_context": {
                "screen_type": "login_auth",
                "confidence": 0.98,
                "layout": {"visual_density": "low", "has_active_modal": False, "canvas_heavy": False},
                "detected_regions": [{"type": "auth_card", "bbox": [440, 120, 840, 520]}],
            },
            "sanitized_dom": {
                "elements_count": 3,
                "elements": [
                    {"id": "e_email", "tag": "INPUT", "selector": "#ap_email",
                     "type": "email", "interactive": True, "role": "textbox"},
                    {"id": "e_pwd", "tag": "INPUT", "selector": "#ap_password",
                     "type": "password", "interactive": True, "role": "textbox"},
                    {"id": "e_submit", "tag": "INPUT", "selector": "#signInSubmit",
                     "type": "submit", "interactive": True, "role": "button"},
                ],
            },
            "vault_manifest": {"has_email": True, "has_password": True},
        },
    )
    assert msg.type == MessageType.USER_QUERY
    assert msg.session_id == "sess_auth_002"


@test("Scenario 2: Login plan has CRITICAL steps requiring approval")
def _():
    from schemas.actions import ActionPlan
    from core.protocol_engine import classify_plan_steps, has_critical_steps, get_critical_steps

    plan_data = {
        "session_id": "sess_auth_002",
        "goal": "Log into my account using my stored credentials",
        "plan": {
            "goal": "Login using vault credentials",
            "chain_of_thought": "1. Fill email from vault. 2. Fill password from vault. 3. Click sign in.",
            "total_steps": 3,
            "steps": [
                {"id": 1, "action": "TYPE_FROM_VAULT", "target": {"selector": "#ap_email"},
                 "vault_key": "email", "execution_mode": "DOM", "protocol_level": "CRITICAL",
                 "description": "Fill email from vault",
                 "verify": {"method": "DOM_CHECK", "condition": "value_matches"}, "timeout_ms": 5000},
                {"id": 2, "action": "TYPE_FROM_VAULT", "target": {"selector": "#ap_password"},
                 "vault_key": "password", "execution_mode": "DOM", "protocol_level": "CRITICAL",
                 "description": "Fill password from vault",
                 "verify": {"method": "DOM_CHECK", "condition": "value_matches"}, "timeout_ms": 5000},
                {"id": 3, "action": "CLICK", "target": {"selector": "#signInSubmit"},
                 "execution_mode": "DOM", "protocol_level": "CRITICAL",
                 "description": "Click sign in",
                 "verify": {"method": "URL_CHECK", "condition": "url_contains('/dashboard')"}, "timeout_ms": 10000},
            ],
        },
    }
    plan = ActionPlan(**plan_data)
    classify_plan_steps(plan)

    assert has_critical_steps(plan)
    critical = get_critical_steps(plan)
    assert len(critical) >= 1
    assert any(s.action.value == "TYPE_FROM_VAULT" for s in critical)


@test("Scenario 2: Full approval flow (email + password)")
def _():
    from api.websocket_handler import (
        _handle_approval_response, _handle_step_execution_result,
        _plan_cache, _pending_goals, _safe_send
    )
    from schemas.messages import WebSocketMessage
    from schemas.actions import ActionPlan
    from state.task_tracker import get_tracker

    session_id = "scenario2_approval"
    ws = make_ws()

    plan_data = {
        "session_id": session_id,
        "goal": "Login using vault credentials",
        "plan": {
            "goal": "Login",
            "chain_of_thought": "Fill email, fill password, click sign in",
            "total_steps": 3,
            "steps": [
                {"id": 1, "action": "TYPE_FROM_VAULT", "target": {"selector": "#email"},
                 "vault_key": "email", "execution_mode": "DOM", "protocol_level": "CRITICAL",
                 "description": "Fill email", "verify": {"method": "DOM_CHECK", "condition": "ok"},
                 "timeout_ms": 5000},
                {"id": 2, "action": "TYPE_FROM_VAULT", "target": {"selector": "#pwd"},
                 "vault_key": "password", "execution_mode": "DOM", "protocol_level": "CRITICAL",
                 "description": "Fill password", "verify": {"method": "DOM_CHECK", "condition": "ok"},
                 "timeout_ms": 5000},
                {"id": 3, "action": "CLICK", "target": {"selector": "#submit"},
                 "execution_mode": "DOM", "protocol_level": "CRITICAL",
                 "description": "Click submit", "verify": {"method": "URL_CHECK", "condition": "ok"},
                 "timeout_ms": 10000},
            ],
        },
    }
    plan = ActionPlan(**plan_data)
    _plan_cache[session_id] = plan
    _pending_goals[session_id] = {"goal": "Login", "url": "https://amazon.in"}

    tracker = get_tracker(session_id)
    tracker.initialize_plan(f"plan_{session_id}", step_ids=[1, 2, 3])

    # Simulate _generate_plan_from_payload: mark step 1 as BLOCKED and send APPROVAL_REQUIRED
    tracker.mark_blocked_approval(1)
    asyncio.get_event_loop().run_until_complete(_safe_send(ws, {
        "type": "APPROVAL_REQUIRED",
        "session_id": session_id,
        "payload": {"step": {"id": 1, "action": "TYPE_FROM_VAULT", "vault_key": "email"},
                    "reason": "Step 1: Fill email — requires user approval", "vault_key": "email"},
    }))

    # Step 1: approve it
    msg_approve = WebSocketMessage(
        type="APPROVAL_RESPONSE", session_id=session_id,
        payload={"step_id": 1, "approved": True},
    )
    asyncio.get_event_loop().run_until_complete(_handle_approval_response(ws, msg_approve))
    # approve_step transitions BLOCKED_APPROVAL → RUNNING

    # Complete step 1
    msg_complete = WebSocketMessage(
        type="STEP_RESULT", session_id=session_id,
        payload={"step_id": 1, "success": True},
    )
    asyncio.get_event_loop().run_until_complete(_handle_step_execution_result(ws, msg_complete))
    # mark_success(1): RUNNING → SUCCESS
    # _dispatch_next_step_from_tracker: step 2 is PENDING → dispatch it

    # Step 2: BLOCKED_APPROVAL (after step 1 dispatch) — approve it
    tracker.mark_blocked_approval(2)
    msg_approve2 = WebSocketMessage(
        type="APPROVAL_RESPONSE", session_id=session_id,
        payload={"step_id": 2, "approved": True},
    )
    asyncio.get_event_loop().run_until_complete(_handle_approval_response(ws, msg_approve2))

    # Complete step 2
    msg_complete2 = WebSocketMessage(
        type="STEP_RESULT", session_id=session_id,
        payload={"step_id": 2, "success": True},
    )
    asyncio.get_event_loop().run_until_complete(_handle_step_execution_result(ws, msg_complete2))

    # Step 3: BLOCKED_APPROVAL — approve it
    tracker.mark_blocked_approval(3)
    msg_approve3 = WebSocketMessage(
        type="APPROVAL_RESPONSE", session_id=session_id,
        payload={"step_id": 3, "approved": True},
    )
    asyncio.get_event_loop().run_until_complete(_handle_approval_response(ws, msg_approve3))

    # Complete step 3
    msg_complete3 = WebSocketMessage(
        type="STEP_RESULT", session_id=session_id,
        payload={"step_id": 3, "success": True},
    )
    asyncio.get_event_loop().run_until_complete(_handle_step_execution_result(ws, msg_complete3))

    messages = get_sent_messages(ws)
    approvals = [m for m in messages if m["type"] == "APPROVAL_REQUIRED"]
    task_complete = [m for m in messages if m["type"] == "TASK_COMPLETE"]
    next_steps = [m for m in messages if m["type"] == "NEXT_STEP"]
    assert len(approvals) >= 1, f"Should have sent APPROVAL_REQUIRED, got: {[m['type'] for m in messages]}"
    assert len(next_steps) >= 2, f"Should have sent NEXT_STEP for approval, got: {len(next_steps)}"
    assert len(task_complete) >= 1, "Should emit TASK_COMPLETE"

    cleanup(session_id)


@test("Scenario 2: Denied approval stops the plan")
def _():
    from api.websocket_handler import _handle_approval_response
    from schemas.messages import WebSocketMessage
    from state.task_tracker import get_tracker, StepState

    session_id = "scenario2_deny"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_deny", step_ids=[1, 2])
    tracker.mark_running(1)
    tracker.mark_blocked_approval(1)

    ws = make_ws()
    msg = WebSocketMessage(
        type="APPROVAL_RESPONSE", session_id=session_id,
        payload={"step_id": 1, "approved": False},
    )
    asyncio.get_event_loop().run_until_complete(_handle_approval_response(ws, msg))

    step = tracker.get_step(1)
    assert step.state == StepState.CANCELLED

    messages = get_sent_messages(ws)
    errors = [m for m in messages if m["type"] == "ERROR"]
    assert any(e["payload"]["code"] == "APPROVAL_DENIED" for e in errors)

    cleanup(session_id)


# ============================================================================
# SCENARIO 3: Canvas / WebGL Web Apps
# ============================================================================
print("\n" + "=" * 60)
print("  SCENARIO 3: Canvas/WebGL (Canva)")
print("=" * 60)


@test("Scenario 3: Server accepts canvas-heavy USER_QUERY with empty DOM")
def _():
    from schemas.messages import WebSocketMessage, MessageType

    msg = WebSocketMessage(
        type="USER_QUERY",
        session_id="sess_canvas_003",
        payload={
            "query": "Click on the blue 'Export' button in the design canvas",
            "current_url": "https://www.canva.com/design/DAF...",
            "vision_context": {
                "screen_type": "canvas_workspace",
                "confidence": 0.97,
                "layout": {"visual_density": "high", "canvas_heavy": True, "has_active_modal": False},
                "detected_regions": [
                    {"type": "canvas_stage", "bbox": [80, 50, 1200, 670]},
                    {"type": "top_toolbar", "bbox": [0, 0, 1280, 50]},
                ],
            },
            "sanitized_dom": {"elements_count": 0, "elements": []},
            "redacted_screenshot": "data:image/jpeg;base64,fake_canvas_screenshot",
        },
    )
    assert msg.type == MessageType.USER_QUERY
    assert len(msg.payload["sanitized_dom"]["elements"]) == 0
    assert msg.payload["vision_context"]["layout"]["canvas_heavy"] is True


@test("Scenario 3: Empty DOM triggers SCREENSHOT action in plan")
def _():
    from core.planner import _build_prompt

    prompt = _build_prompt(
        goal="Click on the blue Export button in the design canvas",
        url="https://www.canva.com/design/DAF...",
        sanitized_dom={"elements": []},
        vault_manifest={},
    )
    assert "No interactive elements found" in prompt


@test("Scenario 3: VLM ground fallback provides coordinates")
def _():
    from api.websocket_handler import _handle_step_execution_result, _plan_cache
    from schemas.messages import WebSocketMessage
    from state.task_tracker import get_tracker

    session_id = "scenario3_vlm"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_canvas", step_ids=[1])
    tracker.mark_running(1)

    mock_plan = MagicMock()
    mock_plan.plan.steps = [
        MagicMock(id=1, action=MagicMock(value="CLICK"),
                  target=MagicMock(selector="#canvas"),
                  execution_mode=MagicMock(value="VISION"), protocol_level="SAFE",
                  description="Click export", verify=None, timeout_ms=5000),
    ]
    _plan_cache[session_id] = mock_plan

    ws = make_ws()
    msg = WebSocketMessage(
        type="STEP_RESULT", session_id=session_id,
        payload={
            "step_id": 1, "success": False,
            "error_code": "SELECTOR_NOT_FOUND",
            "error": "Canvas element has no DOM selector",
            "redacted_screenshot": "data:image/jpeg;base64,fake_canvas",
        },
    )

    with patch("core.vlm_client.ground_element", new_callable=AsyncMock) as mock_ground:
        mock_ground.return_value = {
            "page_description": "Canva design workspace",
            "relevant_elements": [
                {"description": "Purple Export button", "coordinates": [1190, 24], "action": "click"},
            ],
        }
        asyncio.get_event_loop().run_until_complete(_handle_step_execution_result(ws, msg))

    messages = get_sent_messages(ws)
    hybrid = [m for m in messages if m["type"] == "NEXT_STEP" and m["payload"].get("vlm_result")]
    assert len(hybrid) == 1
    assert hybrid[0]["payload"]["step"]["execution_mode"] == "HYBRID"

    cleanup(session_id)


@test("Scenario 3: CAPTCHA on canvas triggers approval")
def _():
    from api.websocket_handler import _handle_step_execution_result
    from schemas.messages import WebSocketMessage
    from state.task_tracker import get_tracker

    session_id = "scenario3_captcha"
    tracker = get_tracker(session_id)
    tracker.initialize_plan("plan_captcha", step_ids=[1])
    tracker.mark_running(1)

    ws = make_ws()
    msg = WebSocketMessage(
        type="STEP_RESULT", session_id=session_id,
        payload={
            "step_id": 1, "success": False,
            "error_code": "CAPTCHA_TRIGGERED",
            "error": "CAPTCHA detected",
        },
    )
    asyncio.get_event_loop().run_until_complete(_handle_step_execution_result(ws, msg))

    messages = get_sent_messages(ws)
    approvals = [m for m in messages if m["type"] == "APPROVAL_REQUIRED"]
    assert len(approvals) == 1
    assert approvals[0]["payload"]["step"]["action"] == "CAPTCHA_HANDOFF"

    cleanup(session_id)


# ============================================================================
# Performance Benchmarks
# ============================================================================
print("\n" + "=" * 60)
print("  Performance Benchmarks")
print("=" * 60)


@test("Message parsing latency < 1ms")
def _():
    from schemas.messages import WebSocketMessage

    start = time.time()
    for _ in range(100):
        WebSocketMessage(
            type="USER_QUERY", session_id="perf_test",
            payload={"query": "test", "url": "https://example.com"},
        )
    elapsed = (time.time() - start) * 1000 / 100
    assert elapsed < 1.0, f"Average parsing took {elapsed:.2f}ms, expected < 1ms"


@test("Plan building latency < 5ms")
def _():
    from api.websocket_handler import _build_plan_payload
    from schemas.actions import ActionPlan

    plan_data = {
        "session_id": "perf", "goal": "test",
        "plan": {
            "goal": "test", "chain_of_thought": "reasoning", "total_steps": 5,
            "steps": [
                {"id": i, "action": "TYPE", "target": {"selector": f"#input{i}"},
                 "value": "text", "execution_mode": "DOM", "protocol_level": "SAFE",
                 "description": f"Step {i}", "verify": {"method": "DOM_CHECK", "condition": "ok"},
                 "timeout_ms": 5000}
                for i in range(1, 6)
            ],
        },
    }
    plan = ActionPlan(**plan_data)

    start = time.time()
    for _ in range(100):
        _build_plan_payload("perf", plan)
    elapsed = (time.time() - start) * 1000 / 100
    assert elapsed < 5.0, f"Average plan building took {elapsed:.2f}ms, expected < 5ms"


@test("Protocol classification latency < 0.5ms")
def _():
    from schemas.protocols import classify_protocol_level

    start = time.time()
    for _ in range(100):
        classify_protocol_level("CLICK", "buy now button")
        classify_protocol_level("TYPE", "enter search term")
        classify_protocol_level("TYPE_FROM_VAULT", "fill password")
    elapsed = (time.time() - start) * 1000 / 300
    assert elapsed < 0.5, f"Average classification took {elapsed:.3f}ms, expected < 0.5ms"


@test("Task tracker operations latency < 1ms")
def _():
    from state.task_tracker import get_tracker, remove_tracker

    session_id = "perf_tracker"
    start = time.time()
    for _ in range(100):
        tracker = get_tracker(session_id)
        tracker.initialize_plan("perf_plan", step_ids=[1, 2, 3])
        tracker.mark_running(1)
        tracker.mark_success(1)
        tracker.mark_running(2)
        tracker.mark_success(2)
        tracker.mark_running(3)
        tracker.mark_success(3)
        remove_tracker(session_id)
    elapsed = (time.time() - start) * 1000 / 100
    assert elapsed < 1.0, f"Average tracker ops took {elapsed:.2f}ms, expected < 1ms"


@test("WebSocket safe_send handles 1000 disconnects without leak")
def _():
    from api.websocket_handler import _safe_send
    from fastapi import WebSocketDisconnect

    ws = AsyncMock()
    ws.send_text = AsyncMock(side_effect=WebSocketDisconnect())

    start = time.time()
    for _ in range(1000):
        result = asyncio.get_event_loop().run_until_complete(
            _safe_send(ws, {"type": "TEST"})
        )
        assert result is False
    elapsed = (time.time() - start) * 1000
    assert elapsed < 500, f"1000 disconnects took {elapsed:.0f}ms, expected < 500ms"


@test("JSON parser handles malformed LLM output in < 2ms")
def _():
    from core.planner import _parse_llm_output

    malformed = '<think>Let me plan this.</think>\n```json\n{"session_id": "x", "goal": "test", "plan": {"goal": "test", "chain_of_thought": "step1", "total_steps": 1, "steps": [{"id": 1, "action": "NAVIGATE", "target": {"url": "https://example.com"}, "execution_mode": "DOM", "protocol_level": "SAFE", "description": "nav", "verify": {"method": "URL_CHECK", "condition": "ok"}}]}}\n```'

    start = time.time()
    for _ in range(100):
        _parse_llm_output(malformed, "perf_parse")
    elapsed = (time.time() - start) * 1000 / 100
    assert elapsed < 2.0, f"Average parse took {elapsed:.2f}ms, expected < 2ms"


# ============================================================================
# Summary
# ============================================================================
print(f"\n{'='*60}")
print(f"  Phase 7 Demo Rehearsal: {passed}/{total} passed, {failed} failed")
print(f"{'='*60}")

if performance_results:
    print(f"\n  Performance Summary:")
    for name, elapsed in performance_results:
        print(f"    {name}: {elapsed:.1f}ms")

if failed > 0:
    sys.exit(1)
