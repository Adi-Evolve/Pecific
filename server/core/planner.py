from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

from schemas.actions import ActionPlan, PlanStep
from models.llm_loader import get_llm
from core.vlm_client import ground_element, detect_obstacles, verify_state
from config import get_settings
from state.memory_store import get_memory_store
from state.session_manager import get_session_manager

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Prompt template — exactly 7 rules from DEV5_AI_INSTRUCTIONS.md §1.5
# Uses bracketed variables: {goal}, {url}, {sanitized_dom}, {vault_manifest},
# {completed_steps}, {session_memory}
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are a browser automation planner for Pecific. Given the user's goal and the current browser state, generate a structured execution plan.

RULES:
1. ALWAYS output valid JSON. NEVER output plain English or thinking tags. Every response must be a single JSON object. Do NOT use <think> tags.
2. Each step MUST have: id, action, execution_mode, protocol_level, verify condition. Do not omit any field.
3. For sensitive actions (purchase, login, delete, payment, account changes), set protocol_level = "CRITICAL".
4. The DOM snapshot uses [TOKEN] placeholders for redacted PII. Work with tokens, not real data. Never attempt to infer real values.
5. If vault_manifest shows a field is available (e.g. has_password=true), use TYPE_FROM_VAULT action and set vault_key to the field name. The extension fills the value locally — the value never appears in your output.
6. Include DISMISS_POPUP as a contingency for steps involving navigation or clicking.
7. If you cannot determine the next action from DOM alone, request a SCREENSHOT action so the VLM can analyze the page visually.

CHAIN-OF-THOUGHT:
Before outputting the JSON, think step by step:
- What is the user's goal?
- What elements are available in the DOM?
- What is the most efficient sequence of actions?
- Which actions are sensitive and need approval?
- What could go wrong and how to handle it?

OUTPUT FORMAT:
Return ONLY valid JSON matching this schema. No extra text, no markdown fences.

{{
  "session_id": "<session_id>",
  "goal": "<user goal>",
  "plan": {{
    "goal": "<restated goal>",
    "chain_of_thought": "<your step-by-step reasoning>",
    "total_steps": <number>,
    "steps": [
      {{
        "id": <number>,
        "action": "<TYPE|CLICK|PRESS_KEY|NAVIGATE|NEW_TAB|EXTRACT|DISMISS_POPUP|TYPE_FROM_VAULT|CAPTCHA_HANDOFF|REPORT_RESULT|SCROLL|SELECT|WAIT|SCREENSHOT|SWITCH_TAB|CLOSE_TAB|HOVER>",
        "target": {{"selector": "<css selector or element id>", "text": "<optional text hint>"}},
        "value": "<text to type, if applicable>",
        "key": "<key for PRESS_KEY, e.g. Enter>",
        "vault_key": "<credential key for TYPE_FROM_VAULT>",
        "execution_mode": "<DOM|VISION|HYBRID>",
        "protocol_level": "<SAFE|CAUTION|CRITICAL|FORBIDDEN>",
        "description": "<what this step does>",
        "verify": {{"method": "<DOM_CHECK|URL_CHECK|SCREENSHOT|VALUE_MATCH>", "condition": "<condition>"}},
        "timeout_ms": <number>
      }}
    ]
  }}
}}

EXAMPLES:

Goal: "Search for headphones on Amazon"
DOM: [1] <INPUT role=searchbox selector="#twotabsearchtextbox" placeholder="Search Amazon"> [2] <BUTTON selector="#nav-search-submit-button" text="Go">
VAULT: has_email=true, has_password=true

Output:
{{
  "session_id": "sess_example_001",
  "goal": "Search for headphones on Amazon",
  "plan": {{
    "goal": "Search Amazon for headphones",
    "chain_of_thought": "1. Type 'headphones' in the search box. 2. Click the search button. 3. Verify search results page loads.",
    "total_steps": 3,
    "steps": [
      {{"id": 1, "action": "TYPE", "target": {{"selector": "1"}}, "value": "headphones", "execution_mode": "DOM", "protocol_level": "SAFE", "description": "Type headphones in search box", "verify": {{"method": "DOM_CHECK", "condition": "input value contains headphones"}}, "timeout_ms": 5000}},
      {{"id": 2, "action": "CLICK", "target": {{"selector": "2"}}, "execution_mode": "DOM", "protocol_level": "SAFE", "description": "Click search button", "verify": {{"method": "URL_CHECK", "condition": "url contains s=headphones"}}, "timeout_ms": 8000}},
      {{"id": 3, "action": "REPORT_RESULT", "execution_mode": "DOM", "protocol_level": "SAFE", "description": "Report search results", "verify": {{"method": "DOM_CHECK", "condition": "always_true"}}, "timeout_ms": 5000}}
    ]
  }}
}}

Goal: "Log in with my stored credentials"
DOM: [1] <INPUT selector="#ap_email" type=email placeholder="Email"> [2] <INPUT selector="#ap_password" type=password> [3] <BUTTON selector="#signInSubmit" text="Sign in">
VAULT: has_email=true, has_password=true

Output:
{{
  "session_id": "sess_example_002",
  "goal": "Log in with stored credentials",
  "plan": {{
    "goal": "Login using vault credentials",
    "chain_of_thought": "1. Fill email from vault (TYPE_FROM_VAULT). 2. Fill password from vault (TYPE_FROM_VAULT). 3. Click sign in. Both vault actions are CRITICAL — require approval.",
    "total_steps": 3,
    "steps": [
      {{"id": 1, "action": "TYPE_FROM_VAULT", "target": {{"selector": "1"}}, "vault_key": "email", "execution_mode": "DOM", "protocol_level": "CRITICAL", "description": "Fill email from vault", "verify": {{"method": "DOM_CHECK", "condition": "value_matches"}}, "timeout_ms": 5000}},
      {{"id": 2, "action": "TYPE_FROM_VAULT", "target": {{"selector": "2"}}, "vault_key": "password", "execution_mode": "DOM", "protocol_level": "CRITICAL", "description": "Fill password from vault", "verify": {{"method": "DOM_CHECK", "condition": "value_matches"}}, "timeout_ms": 5000}},
      {{"id": 3, "action": "CLICK", "target": {{"selector": "3"}}, "execution_mode": "DOM", "protocol_level": "CRITICAL", "description": "Click sign in button", "verify": {{"method": "URL_CHECK", "condition": "url_contains('/dashboard')"}}, "timeout_ms": 10000}}
    ]
  }}
}}"""


VLM_CONTEXT_PROMPT = """The VLM server has analyzed the current screenshot and returned this information:
{vlm_result}

Use this visual context to update your plan. If the VLM found obstacles, add DISMISS_POPUP steps before the affected steps. If it found element coordinates, use those for CLICK actions with execution_mode "VISION" or "HYBRID"."""

REPLAN_PROMPT = """The previous plan failed at step {failed_step_id}.
Error: {error_message}
{vlm_context}

Generate a corrected plan from this point forward. Include the successful previous steps and the corrected remaining steps. Do not repeat failed steps without fixing the approach."""


def _format_dom_elements(sanitized_dom: dict[str, Any]) -> str:
    """Format DOM elements into a readable prompt string."""
    elements = sanitized_dom.get("elements", [])
    if not elements:
        return "No interactive elements found."

    lines = []
    for el in elements:
        el_id = el.get("id", "?")
        tag = el.get("tag", "?")
        role = el.get("role", "")
        text = el.get("text", "")
        placeholder = el.get("placeholder", "")
        selector = el.get("selector", "")
        el_type = el.get("type", "")
        rect = el.get("rect", [])

        parts = [f"[{el_id}] <{tag}>"]
        if role:
            parts.append(f"role={role}")
        if text:
            parts.append(f'text="{text[:40]}"')
        if placeholder:
            parts.append(f'placeholder="{placeholder[:30]}"')
        if selector:
            parts.append(f"sel={selector}")
        if el_type:
            parts.append(f"type={el_type}")
        if rect:
            parts.append(f"rect={rect}")
        lines.append(" ".join(parts))

    return "\n".join(lines)


def _build_prompt(
    goal: str,
    url: str,
    sanitized_dom: dict[str, Any],
    vault_manifest: dict[str, Any],
    completed_steps: list[dict] | None = None,
    session_memory: dict[str, Any] | None = None,
    vlm_context: str | None = None,
) -> str:
    """Build the user prompt using bracketed template variables."""
    dom_text = _format_dom_elements(sanitized_dom)
    element_count = len(sanitized_dom.get("elements", []))

    vault_fields = vault_manifest.get("fields", vault_manifest)
    vault_text = ", ".join(f"{k}={v}" for k, v in vault_fields.items() if isinstance(v, bool))

    parts = [
        f"USER GOAL: {goal}",
        f"CURRENT URL: {url}",
        f"DOM SNAPSHOT ({element_count} interactive elements):\n{dom_text}",
        f"VAULT MANIFEST: {vault_text or 'none'}",
    ]

    if completed_steps:
        parts.append(f"PREVIOUS STEPS: {json.dumps(completed_steps)}")
    if session_memory:
        parts.append(f"SESSION HISTORY: {json.dumps(session_memory)}")
    if vlm_context:
        parts.append(f"VLM VISUAL CONTEXT:\n{vlm_context}")

    return "\n\n".join(parts)


def _repair_json(text: str) -> str:
    """Attempt to fix common LLM JSON malformations."""
    # Remove trailing commas before } or ]
    text = re.sub(r",\s*([}\]])", r"\1", text)
    # Remove // comments (LLM sometimes adds them)
    text = re.sub(r"//.*$", "", text, flags=re.MULTILINE)
    # Fix missing commas between array/object elements: "} {" -> "}, {"
    text = re.sub(r"\}\s*\{", "}, {", text)
    # Fix missing commas between array elements: "] [" -> "], ["
    text = re.sub(r"\]\s*\[", "], [", text)
    # Remove control characters inside strings (newlines, tabs, etc.)
    text = re.sub(r"[\x00-\x1f\x7f]", " ", text)
    # Collapse multiple spaces
    text = re.sub(r"  +", " ", text)
    # Remove any trailing text after the last }
    brace_end = text.rfind("}")
    if brace_end != -1:
        text = text[:brace_end + 1]
    return text


def _parse_llm_output(raw: str, session_id: str) -> dict[str, Any]:
    """Extract JSON from LLM output, handling thinking tags, markdown fences, and extra text."""
    text = raw.strip()

    # Strip Qwen3 thinking tags</think>...</think>content
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    # Also handle cases where tags appear without closing
    text = re.sub(r"<think>.*", "", text, flags=re.DOTALL)
    text = text.strip()

    fence_match = re.search(r"```(?:json)?\s*\n?(.*?)\n?\s*```", text, re.DOTALL)
    if fence_match:
        text = fence_match.group(1).strip()

    brace_start = text.find("{")
    brace_end = text.rfind("}")
    if brace_start != -1 and brace_end != -1 and brace_end > brace_start:
        text = text[brace_start:brace_end + 1]

    # Try direct parse first
    try:
        data = json.loads(text)
        data["session_id"] = session_id
        return data
    except json.JSONDecodeError:
        pass

    # Attempt repair
    repaired = _repair_json(text)
    try:
        data = json.loads(repaired)
        data["session_id"] = session_id
        return data
    except json.JSONDecodeError as e:
        logger.error("JSON repair failed: %s\nRepaired text (first 500): %s", e, repaired[:500])
        raise


def _has_screenshot_steps(plan: ActionPlan) -> bool:
    return any(s.action.value == "SCREENSHOT" for s in plan.plan.steps)


async def _get_vlm_context_for_screenshot(
    screenshot_b64: str,
    goal: str,
) -> str:
    try:
        obstacles = await detect_obstacles(screenshot_b64)
        obstacle_text = json.dumps(obstacles, indent=2)

        grounding = await ground_element(
            screenshot_b64,
            f"Find UI elements relevant to this task: {goal}",
        )
        grounding_text = json.dumps(grounding, indent=2)

        return f"OBSTACLES:\n{obstacle_text}\n\nELEMENTS:\n{grounding_text}"
    except Exception as e:
        logger.warning("VLM call failed: %s", e)
        return f"VLM unavailable: {e}"


async def generate_plan(
    goal: str,
    url: str,
    sanitized_dom: dict[str, Any],
    vault_manifest: dict[str, Any],
    session_id: str,
    completed_steps: list[dict] | None = None,
    session_memory: dict[str, Any] | None = None,
    redacted_screenshot: str | None = None,
) -> ActionPlan:
    settings = get_settings()
    model, tokenizer = get_llm()

    memory = get_memory_store()
    cross_session_context = memory.get_session_context(session_id)

    if session_memory:
        cross_session_context.update(session_memory)

    vlm_context = None
    if redacted_screenshot:
        vlm_context = await _get_vlm_context_for_screenshot(redacted_screenshot, goal)

    user_prompt = _build_prompt(
        goal=goal,
        url=url,
        sanitized_dom=sanitized_dom,
        vault_manifest=vault_manifest,
        completed_steps=completed_steps,
        session_memory=cross_session_context,
        vlm_context=vlm_context,
    )

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    # Log the exact prompt being sent to the LLM
    print(f"\n{'='*60}", flush=True)
    print(f"[LLM] SYSTEM PROMPT:\n{SYSTEM_PROMPT}", flush=True)
    print(f"[LLM] USER PROMPT:\n{user_prompt}", flush=True)
    print(f"[LLM] Sending to model...", flush=True)
    print(f"{'='*60}\n", flush=True)

    raw_output = await asyncio.to_thread(_call_llm, model, tokenizer, messages, settings)

    # Log the exact raw output from the LLM
    print(f"\n{'='*60}", flush=True)
    print(f"[LLM] RAW OUTPUT:\n{raw_output}", flush=True)
    print(f"{'='*60}\n", flush=True)

    try:
        data = _parse_llm_output(raw_output, session_id)
        plan = ActionPlan(**data)
        print(f"[LLM] PARSED SUCCESSFULLY: {plan.plan.total_steps} steps", flush=True)
    except Exception as e:
        print(f"[LLM] PARSE FAILED: {e}", flush=True)
        logger.warning("First parse failed: %s — retrying with corrective prompt", e)
        plan = await _retry_with_corrective_prompt(messages, raw_output, session_id, settings)
        print(f"[LLM] RETRY SUCCEEDED: {plan.plan.total_steps} steps", flush=True)

    if _has_screenshot_steps(plan) and redacted_screenshot:
        logger.info("Plan has SCREENSHOT steps — calling VLM for re-planning")
        try:
            vlm_result = await _get_vlm_context_for_screenshot(redacted_screenshot, goal)
            vlm_msg = VLM_CONTEXT_PROMPT.format(vlm_result=vlm_result)
            replan_messages = messages + [
                {"role": "assistant", "content": raw_output},
                {"role": "user", "content": vlm_msg},
            ]
            raw_replan = await asyncio.to_thread(_call_llm, model, tokenizer, replan_messages, settings)
            data = _parse_llm_output(raw_replan, session_id)
            plan = ActionPlan(**data)
            logger.info("Re-planned with VLM context: %d steps", plan.plan.total_steps)
        except Exception as e:
            logger.warning("VLM re-planning failed, using original plan: %s", e)

    return plan


async def replan_after_failure(
    goal: str,
    url: str,
    sanitized_dom: dict[str, Any],
    vault_manifest: dict[str, Any],
    session_id: str,
    failed_step_id: int,
    error_message: str,
    completed_steps: list[dict] | None = None,
    session_memory: dict[str, Any] | None = None,
    redacted_screenshot: str | None = None,
) -> ActionPlan:
    settings = get_settings()
    model, tokenizer = get_llm()

    vlm_context = ""
    if redacted_screenshot:
        vlm_context = await _get_vlm_context_for_screenshot(redacted_screenshot, goal)

    user_prompt = _build_prompt(
        goal=goal,
        url=url,
        sanitized_dom=sanitized_dom,
        vault_manifest=vault_manifest,
        completed_steps=completed_steps,
        session_memory=session_memory,
        vlm_context=vlm_context,
    )

    replan_msg = REPLAN_PROMPT.format(
        failed_step_id=failed_step_id,
        error_message=error_message,
        vlm_context=vlm_context,
    )

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
        {"role": "user", "content": replan_msg},
    ]

    raw_output = await asyncio.to_thread(_call_llm, model, tokenizer, messages, settings)
    data = _parse_llm_output(raw_output, session_id)
    return ActionPlan(**data)


async def _retry_with_corrective_prompt(
    messages: list[dict],
    raw_output: str,
    session_id: str,
    settings,
) -> ActionPlan:
    model, tokenizer = get_llm()
    corrective_messages = messages + [
        {"role": "assistant", "content": raw_output},
        {
            "role": "user",
            "content": (
                "Your last output was invalid JSON. "
                "Output ONLY valid JSON matching the schema from the system prompt. "
                "No extra text, no markdown fences, just the raw JSON object."
            ),
        },
    ]

    raw_output_2 = await asyncio.to_thread(_call_llm, model, tokenizer, corrective_messages, settings)
    logger.info("LLM retry output (first 200 chars): %s", raw_output_2[:200])

    data = _parse_llm_output(raw_output_2, session_id)
    return ActionPlan(**data)


def _call_llm(model, tokenizer, messages: list[dict], settings) -> str:
    import torch
    logger.info("Starting LLM inference...")
    text = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
    )
    logger.info("Prompt tokenized: %d tokens", len(tokenizer.encode(text)))
    inputs = tokenizer(text, return_tensors="pt").to(model.device)

    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=settings.LLM_MAX_NEW_TOKENS,
            temperature=settings.LLM_TEMPERATURE,
            top_p=settings.LLM_TOP_P,
            do_sample=True,
            pad_token_id=tokenizer.eos_token_id,
        )

    logger.info("LLM inference complete, decoding...")
    generated = outputs[0][inputs["input_ids"].shape[1]:]
    result = tokenizer.decode(generated, skip_special_tokens=True)
    logger.info("Generated %d tokens", len(generated))
    return result
