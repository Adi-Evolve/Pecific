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

# ---------------------------------------------------------------------------
# Action classification — every action type with its default protocol level
# Organized from simplest (SAFE) to most complex (FORBIDDEN)
# ---------------------------------------------------------------------------

# ALWAYS SAFE — read-only, no side effects
SAFE_ACTIONS = {
    "SCREENSHOT",       # Capture current state for VLM analysis
    "EXTRACT",          # Read data from page (no modification)
    "REPORT_RESULT",    # Compile and return results to user
    "WAIT",             # Wait for condition/timeout (no side effect)
    "SWITCH_TAB",       # Switch focus between tabs (no data change)
}

# SAFE with context — navigation and basic interaction
SAFE_INTERACTIVE_ACTIONS = {
    "NAVIGATE",         # Open URL in current/agent tab
    "SCROLL",           # Scroll page or element
    "HOVER",            # Mouse hover over element (no click)
}

# CAUTION — modifies page state but not destructive
CAUTION_ACTIONS = {
    "CLICK",            # Click element — may trigger navigation, form submit
    "TYPE",             # Type text into input — changes form state
    "SELECT",           # Select dropdown option — changes form state
    "PRESS_KEY",        # Keyboard press — may trigger form submit or navigation
    "NEW_TAB",          # Open new tab — changes browser state
    "CLOSE_TAB",        # Close tab — may lose unsaved state
    "DISMISS_POPUP",    # Close modal/overlay — changes page state
}

# CRITICAL — requires explicit user approval (sensitive data or irreversible)
CRITICAL_ACTIONS = {
    "TYPE_FROM_VAULT",  # Fill credential from vault — involves passwords/PII
    "CAPTCHA_HANDOFF",  # Hand off CAPTCHA to user — security boundary
}

# FORBIDDEN — never executed by the agent
FORBIDDEN_ACTIONS: set[str] = set()  # Runtime-configurable if needed

# ---------------------------------------------------------------------------
# Keyword-based classification — augments action-level defaults
# ---------------------------------------------------------------------------

# Keywords in description that elevate to CRITICAL (regardless of action type)
CRITICAL_KEYWORDS = {
    # Financial
    "purchase", "buy", "checkout", "payment", "pay", "order", "cart",
    "credit card", "debit card", "upi", "net banking", "wallet",
    "refund", "transfer", "send money", "withdraw", "deposit",
    # Authentication
    "login", "log in", "signin", "sign in", "authenticate", "otp",
    "verify identity", "two-factor", "2fa",
    # Destructive
    "delete", "remove", "cancel account", "deactivate", "unsubscribe",
    "wipe", "erase", "purge",
    # Sensitive data
    "password", "secret", "private", "confidential", "ssn", "aadhaar",
    "pan card", "bank account",
}

# Keywords that elevate to CAUTION
CAUTION_KEYWORDS = {
    # Form interactions
    "form", "fill", "submit", "filter", "select", "choose",
    # State changes
    "change", "update", "modify", "edit", "rename", "move",
    "enable", "disable", "toggle", "switch",
    # Navigation
    "redirect", "navigate", "forward", "back",
}

# Keywords that keep action SAFE (override caution keywords)
SAFE_KEYWORDS = {
    "read", "view", "check", "verify", "inspect", "browse",
    "scroll", "hover", "highlight", "focus",
}


def classify_protocol_level(
    action: str,
    description: str = "",
) -> str:
    """Classify a step's protocol level based on action type and description.

    Classification priority:
    1. FORBIDDEN (if action is in FORBIDDEN_ACTIONS)
    2. CRITICAL (if action is in CRITICAL_ACTIONS OR description has critical keywords)
    3. CAUTION (if description has caution keywords)
    4. SAFE (default for all other actions)
    """
    action_upper = action.upper()
    desc_lower = description.lower()

    # 1. Check FORBIDDEN
    if action_upper in FORBIDDEN_ACTIONS:
        return FORBIDDEN

    # 2. Check CRITICAL — action-level
    if action_upper in CRITICAL_ACTIONS:
        return CRITICAL

    # 2. Check CRITICAL — keyword-level
    for kw in CRITICAL_KEYWORDS:
        if kw in desc_lower:
            return CRITICAL

    # 3. Check CAUTION — keyword-level
    for kw in CAUTION_KEYWORDS:
        if kw in desc_lower:
            # But check if SAFE keywords override
            for safe_kw in SAFE_KEYWORDS:
                if safe_kw in desc_lower:
                    return SAFE
            return CAUTION

    # 4. Default to SAFE
    return SAFE


class ProtocolClassification(BaseModel):
    step_id: int
    action: str
    protocol_level: str
    reason: str = ""
