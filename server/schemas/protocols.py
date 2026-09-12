from __future__ import annotations

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Protocol levels
# ---------------------------------------------------------------------------

SAFE = "SAFE"
CAUTION = "CAUTION"
CRITICAL = "CRITICAL"
FORBIDDEN = "FORBIDDEN"

PROTOCOL_LEVELS = [SAFE, CAUTION, CRITICAL, FORBIDDEN]

# Actions that are always CRITICAL (require approval gate)
CRITICAL_ACTIONS = {
    "TYPE_FROM_VAULT",
    "CAPTCHA_HANDOFF",
}

# Actions that are always FORBIDDEN (never executed)
FORBIDDEN_ACTIONS: set[str] = set()  # filled at runtime if needed

# Keywords in description that elevate to CRITICAL
CRITICAL_KEYWORDS = {
    "purchase", "buy", "checkout", "payment", "pay",
    "login", "log in", "signin", "sign in",
    "delete", "remove", "cancel account",
    "transfer", "send money", "withdraw",
}

# Keywords that elevate to CAUTION
CAUTION_KEYWORDS = {
    "form", "fill", "submit", "filter", "select",
    "change", "update", "modify", "edit",
}


def classify_protocol_level(
    action: str,
    description: str = "",
) -> str:
    """Classify a step's protocol level based on action type and description."""

    action_upper = action.upper()
    desc_lower = description.lower()

    if action_upper in CRITICAL_ACTIONS:
        return CRITICAL

    if action_upper in FORBIDDEN_ACTIONS:
        return FORBIDDEN

    for kw in CRITICAL_KEYWORDS:
        if kw in desc_lower:
            return CRITICAL

    for kw in CAUTION_KEYWORDS:
        if kw in desc_lower:
            return CAUTION

    return SAFE


class ProtocolClassification(BaseModel):
    step_id: int
    action: str
    protocol_level: str
    reason: str = ""
