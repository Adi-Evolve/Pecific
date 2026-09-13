from __future__ import annotations

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
# Prompt template (from DEV5_AI_INSTRUCTIONS.md §1.5)
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are a browser automation planner. Given the user's goal and the current browser state, generate a structured execution plan.

RULES:
1. ALWAYS output valid JSON. NEVER output plain English.
2. Each step MUST have: id, action, execution_mode, protocol_level, verify condition.
3. For sensitive actions (purchase, login, delete), set protocol_level = "CRITICAL".
4. The DOM snapshot uses [TOKEN] placeholders for redacted PII. Work with tokens, not real data.
5. If vault_manifest shows a field is available, use TYPE_FROM_VAULT action.
6. Include DISMISS_POPUP as a contingency for steps involving navigation.
7. If you cannot determine the next action from DOM alone, request a SCREENSHOT for VLM analysis.

OUTPUT FORMAT:
Return ONLY valid JSON matching this schema:
{
  "session_id": "<session_id>",
  "goal": "<user goal>",
  "plan": {
    "goal": "<restated goal>",
    "chain_of_thought": "<step-by-step reasoning>",
    "total_steps": <number>,
    "steps": [
      {
        "id": <number>,
        "action": "<TYPE|CLICK|PRESS_KEY|NAVIGATE|NEW_TAB|EXTRACT|DISMISS_POPUP|TYPE_FROM_VAULT|CAPTCHA_HANDOFF|REPORT_RESULT|SCROLL|SELECT|WAIT|SCREENSHOT|SWITCH_TAB|CLOSE_TAB>",
        "target": {"selector": "<css selector>", "element_id": "<optional>"},
        "value": "<text to type, if applicable>",
        "execution_mode": "<DOM|VISION|HYBRID>",
        "protocol_level": "<SAFE|CAUTION|CRITICAL|FORBIDDEN>",
        "description": "<what this step does>",
        "verify": {"method": "<DOM_CHECK|URL_CHECK|SCREENSHOT|VALUE_MATCH>", "condition": "<condition>"},
        "timeout_ms": <number>
      }
    ]
  }
}"""


VLM_CONTEXT_PROMPT = """The VLM server has analyzed the current screenshot and returned this information:
{vlm_result}

Use this visual context to update your plan. If the VLM found obstacles, add DISMISS_POPUP steps. If it found element coordinates, use those for CLICK actions with execution_mode "VISION" or "HYBRID"."""

REPLAN_PROMPT = """The previous plan failed at step {failed_step_id}.
Error: {error_message}
{vlm_context}

Generate a corrected plan from this point forward. Include the successful previous steps and the corrected remaining steps."""


def _build_prompt(
    goal: str,
    url: str,
    sanitized_dom: dict[str, Any],
    vault_manifest: dict[str, Any],
    completed_steps: list[dict] | None = None,
    session_memory: dict[str, Any] | None = None,
    vlm_context: str | None = None,
) -> str:
    """Build the user prompt from request context."""
    parts = [
        f"USER GOAL: {goal}",
        f"CURRENT URL: {url}",
        f"DOM SNAPSHOT: {json.dumps(sanitized_dom, indent=None)}",
        f"VAULT MANIFEST: {json.dumps(vault_manifest)}",
        f"PREVIOUS STEPS: {json.dumps(completed_steps or [])}",
        f"SESSION HISTORY: {json.dumps(session_memory or {})}",
    ]
    if vlm_context:
        parts.append(f"VLM VISUAL CONTEXT:\n{vlm_context}")
    return "\n\n".join(parts)


def _parse_llm_output(raw: str, session_id: str) -> dict[str, Any]:
    """Extract JSON from LLM output, handling markdown fences and extra text."""
    text = raw.strip()

    # Try to extract from markdown code fences
    fence_match = re.search(r"```(?:json)?\s*\n?(.*?)\n?\s*```", text, re.DOTALL)
    if fence_match:
        text = fence_match.group(1).strip()

    # Try to find JSON object in the text
    brace_start = text.find("{")
    brace_end = text.rfind("}")
    if brace_start != -1 and brace_end != -1 and brace_end > brace_start:
        text = text[brace_start:brace_end + 1]

    data = json.loads(text)

    # Always set session_id from the request context
    data["session_id"] = session_id

    return data


def _has_screenshot_steps(plan: ActionPlan) -> bool:
    """Check if the plan contains SCREENSHOT action steps."""
    return any(s.action.value == "SCREENSHOT" for s in plan.plan.steps)


async def _get_vlm_context_for_screenshot(
    screenshot_b64: str,
    goal: str,
) -> str:
    """Call VLM to analyze a screenshot and return context for re-planning."""
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
    """Generate a structured execution plan from a user goal.

    1. Fetch cross-session context from memory store
    2. Build prompt from context
    3. Call Qwen3-14B
    4. Parse and validate output against ActionPlan schema
    5. If plan contains SCREENSHOT steps, call VLM and re-plan
    6. On failure: retry once with corrective prompt
    """
    settings = get_settings()
    model, tokenizer = get_llm()

    # Fetch cross-session context for carry-forward
    memory = get_memory_store()
    cross_session_context = memory.get_session_context(session_id)

    # Merge with explicit session_memory if provided
    if session_memory:
        cross_session_context.update(session_memory)

    # Build VLM context if screenshot is available
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

    # --- First attempt ---
    raw_output = _call_llm(model, tokenizer, messages, settings)
    logger.info("LLM raw output (first 200 chars): %s", raw_output[:200])

    try:
        data = _parse_llm_output(raw_output, session_id)
        plan = ActionPlan(**data)
    except Exception as e:
        logger.warning("First parse failed: %s — retrying with corrective prompt", e)
        plan = await _retry_with_corrective_prompt(messages, raw_output, session_id, settings)

    # --- VLM re-planning if plan has SCREENSHOT steps ---
    if _has_screenshot_steps(plan) and redacted_screenshot:
        logger.info("Plan has SCREENSHOT steps — calling VLM for re-planning")
        try:
            vlm_result = await _get_vlm_context_for_screenshot(redacted_screenshot, goal)
            vlm_msg = VLM_CONTEXT_PROMPT.format(vlm_result=vlm_result)
            replan_messages = messages + [
                {"role": "assistant", "content": raw_output},
                {"role": "user", "content": vlm_msg},
            ]
            raw_replan = _call_llm(model, tokenizer, replan_messages, settings)
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
    """Re-plan after a step fails. Calls VLM if screenshot is available."""
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

    raw_output = _call_llm(model, tokenizer, messages, settings)
    data = _parse_llm_output(raw_output, session_id)
    return ActionPlan(**data)


async def _retry_with_corrective_prompt(
    messages: list[dict],
    raw_output: str,
    session_id: str,
    settings,
) -> ActionPlan:
    """Retry LLM with a corrective prompt after invalid JSON output."""
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

    raw_output_2 = _call_llm(model, tokenizer=None, messages=corrective_messages, settings=settings)
    logger.info("LLM retry output (first 200 chars): %s", raw_output_2[:200])

    data = _parse_llm_output(raw_output_2, session_id)
    return ActionPlan(**data)


def _call_llm(model, tokenizer, messages: list[dict], settings) -> str:
    """Run inference on the LLM and return the generated text."""
    text = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
    )
    inputs = tokenizer(text, return_tensors="pt").to(model.device)

    with __import__("torch").no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=settings.LLM_MAX_NEW_TOKENS,
            temperature=settings.LLM_TEMPERATURE,
            top_p=settings.LLM_TOP_P,
            do_sample=True,
            pad_token_id=tokenizer.eos_token_id,
        )

    # Decode only the new tokens
    generated = outputs[0][inputs["input_ids"].shape[1]:]
    return tokenizer.decode(generated, skip_special_tokens=True)
