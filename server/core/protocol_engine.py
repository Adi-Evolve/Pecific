from __future__ import annotations

import logging
from typing import Any

from schemas.actions import PlanStep, ActionPlan
from schemas.protocols import classify_protocol_level, CRITICAL, FORBIDDEN

logger = logging.getLogger(__name__)


def classify_plan_steps(plan: ActionPlan) -> list[dict[str, Any]]:
    """Classify every step in a plan and return classification results.

    Returns a list of dicts with step_id, action, protocol_level, and reason.
    Also modifies the plan in-place to ensure protocol_level matches classification.
    """
    results = []

    for step in plan.plan.steps:
        level = classify_protocol_level(
            action=step.action.value,
            description=step.description,
        )
        reason = _get_classification_reason(step.action.value, step.description, level)

        # Update the step in-place
        step.protocol_level = level

        results.append({
            "step_id": step.id,
            "action": step.action.value,
            "protocol_level": level,
            "reason": reason,
        })

        if level == CRITICAL:
            logger.warning(
                "Step %d (%s) classified as CRITICAL — approval required",
                step.id, step.action.value,
            )
        elif level == FORBIDDEN:
            logger.error(
                "Step %d (%s) classified as FORBIDDEN — must not execute",
                step.id, step.action.value,
            )

    return results


def has_critical_steps(plan: ActionPlan) -> bool:
    """Check if any step in the plan requires user approval."""
    return any(s.protocol_level == CRITICAL for s in plan.plan.steps)


def get_critical_steps(plan: ActionPlan) -> list[PlanStep]:
    """Return all steps that require user approval."""
    return [s for s in plan.plan.steps if s.protocol_level == CRITICAL]


def get_next_executable_step(
    plan: ActionPlan,
    completed_step_ids: set[int],
) -> PlanStep | None:
    """Return the next step that can be executed (not yet completed, not blocked)."""
    for step in plan.plan.steps:
        if step.id not in completed_step_ids:
            return step
    return None


def _get_classification_reason(action: str, description: str, level: str) -> str:
    """Generate a human-readable reason for the classification."""
    action_upper = action.upper()
    desc_lower = description.lower()

    if action_upper == "TYPE_FROM_VAULT":
        return "Vault data access requires explicit user permission"
    if action_upper == "CAPTCHA_HANDOFF":
        return "CAPTCHA must be solved by the user manually"
    if level == CRITICAL:
        for kw in ["purchase", "buy", "checkout", "payment", "login", "delete", "transfer"]:
            if kw in desc_lower:
                return f"Action involves {kw} — sensitive operation"
        return "Sensitive operation requiring user approval"
    if level == FORBIDDEN:
        return "This action is not permitted"
    if level == "CAUTION":
        return "Action modifies page state — user should be aware"
    return "Safe autonomous action"
