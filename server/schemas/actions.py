from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enums — matching /schemas/action.schema.json
# ---------------------------------------------------------------------------

class ActionType(str, Enum):
    NAVIGATE = "NAVIGATE"
    CLICK = "CLICK"
    TYPE = "TYPE"
    TYPE_FROM_VAULT = "TYPE_FROM_VAULT"
    PRESS_KEY = "PRESS_KEY"
    HOVER = "HOVER"
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
    REPORT_RESULT = "REPORT_RESULT"


class ExecutionMode(str, Enum):
    DOM = "DOM"
    VISION = "VISION"
    HYBRID = "HYBRID"


# ---------------------------------------------------------------------------
# Nested models — matching /schemas/action.schema.json
# ---------------------------------------------------------------------------

class StepTarget(BaseModel):
    selector: Optional[str] = None
    url: Optional[str] = None
    coordinates: Optional[list[float]] = None
    text: Optional[str] = None
    tab_id: Optional[int] = None
    tab_purpose: Optional[str] = None


class VerifyCondition(BaseModel):
    method: str = Field(..., description="DOM_CHECK | URL_CHECK | SCREENSHOT")
    condition: str


class Fallback(BaseModel):
    action: str
    reason: str


class PlanStep(BaseModel):
    """Single step in an execution plan — matches action.schema.json ActionStep."""
    id: int = Field(..., ge=1, description="Sequential step index (1-based)")
    action: ActionType
    target: Optional[StepTarget] = None
    value: Optional[str] = None
    key: Optional[str] = None
    vault_key: Optional[str] = None
    execution_mode: ExecutionMode = ExecutionMode.DOM
    protocol_level: str = Field(default="SAFE", description="SAFE | CAUTION | CRITICAL | FORBIDDEN")
    description: str = ""
    verify: Optional[VerifyCondition] = None
    fallback: Optional[Fallback] = None
    timeout_ms: int = 5000
    duration_ms: Optional[int] = None


class Plan(BaseModel):
    goal: str
    chain_of_thought: str = ""
    total_steps: int = Field(..., ge=1)
    steps: list[PlanStep]


class ActionPlan(BaseModel):
    """Full action plan response from the LLM server."""
    session_id: str
    goal: str
    plan: Plan
