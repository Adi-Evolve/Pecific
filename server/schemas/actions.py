from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class ActionType(str, Enum):
    NAVIGATE = "NAVIGATE"
    CLICK = "CLICK"
    TYPE = "TYPE"
    TYPE_FROM_VAULT = "TYPE_FROM_VAULT"
    SCROLL = "SCROLL"
    SELECT = "SELECT"
    WAIT = "WAIT"
    SCREENSHOT = "SCREENSHOT"
    EXTRACT = "EXTRACT"
    NEW_TAB = "NEW_TAB"
    SWITCH_TAB = "SWITCH_TAB"
    CLOSE_TAB = "CLOSE_TAB"
    DISMISS_POPUP = "DISMISS_POPUP"
    CAPTCHA_HANDOFF = "CAPTCHA_HANDOFF"
    PRESS_KEY = "PRESS_KEY"
    REPORT_RESULT = "REPORT_RESULT"


class ExecutionMode(str, Enum):
    DOM = "DOM"
    VISION = "VISION"
    HYBRID = "HYBRID"


# ---------------------------------------------------------------------------
# Nested models
# ---------------------------------------------------------------------------

class StepTarget(BaseModel):
    selector: Optional[str] = None
    element_id: Optional[str] = None
    coordinates: Optional[list[float]] = None
    url: Optional[str] = None
    tab_purpose: Optional[str] = None


class VerifyCondition(BaseModel):
    method: str = Field(..., description="DOM_CHECK | URL_CHECK | SCREENSHOT | VALUE_MATCH")
    condition: str


class Fallback(BaseModel):
    action: Optional[str] = None
    reason: Optional[str] = None


class PlanStep(BaseModel):
    id: int = Field(..., ge=1)
    action: ActionType
    target: Optional[StepTarget] = None
    value: Optional[str] = None
    vault_key: Optional[str] = None
    key: Optional[str] = None
    extraction_type: Optional[str] = None
    selectors: Optional[dict[str, Any]] = None
    execution_mode: ExecutionMode = ExecutionMode.DOM
    protocol_level: str = Field(..., description="SAFE | CAUTION | CRITICAL | FORBIDDEN")
    description: str
    verify: VerifyCondition
    fallback: Optional[Fallback] = None
    timeout_ms: int = 5000


class Plan(BaseModel):
    goal: str
    chain_of_thought: str
    total_steps: int = Field(..., ge=1)
    steps: list[PlanStep]


class ActionPlan(BaseModel):
    """Full action plan response from the LLM server."""

    session_id: str
    goal: str
    plan: Plan
