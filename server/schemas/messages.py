from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class MessageType(str, Enum):
    """All valid WebSocket message types."""

    # Client → Server
    USER_QUERY = "USER_QUERY"
    STEP_RESULT = "STEP_RESULT"
    APPROVAL_RESPONSE = "APPROVAL_RESPONSE"
    SESSION_RESTORE = "SESSION_RESTORE"
    PAUSE_AGENT = "PAUSE_AGENT"
    RESUME_AGENT = "RESUME_AGENT"
    STOP_AGENT = "STOP_AGENT"

    # Server → Client
    PLAN = "PLAN"
    NEXT_STEP = "NEXT_STEP"
    APPROVAL_REQUIRED = "APPROVAL_REQUIRED"
    DYNAMIC_OBSTACLE = "DYNAMIC_OBSTACLE"
    SESSION_RESTORED = "SESSION_RESTORED"
    TASK_COMPLETE = "TASK_COMPLETE"
    ERROR = "ERROR"


# ---------------------------------------------------------------------------
# Envelope
# ---------------------------------------------------------------------------

class WebSocketMessage(BaseModel):
    """Standard WebSocket message envelope (co-owned with Dev 1)."""

    type: MessageType
    session_id: str = Field(..., pattern=r"^sess_[0-9]+_[a-zA-Z0-9]+$")
    client_timestamp: Optional[float] = None
    payload: dict[str, Any] = Field(default_factory=dict)
