from __future__ import annotations

import logging
import time
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Step states — PENDING → RUNNING → SUCCESS/FAILED/BLOCKED_APPROVAL → RETRYING → HYBRID_FALLBACK
# ---------------------------------------------------------------------------

class StepState(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    BLOCKED_APPROVAL = "BLOCKED_APPROVAL"
    RETRYING = "RETRYING"
    HYBRID_FALLBACK = "HYBRID_FALLBACK"
    SKIPPED = "SKIPPED"
    CANCELLED = "CANCELLED"


# Valid state transitions
VALID_TRANSITIONS: dict[StepState, set[StepState]] = {
    StepState.PENDING: {StepState.RUNNING, StepState.CANCELLED, StepState.SKIPPED, StepState.BLOCKED_APPROVAL},
    StepState.RUNNING: {StepState.SUCCESS, StepState.FAILED, StepState.BLOCKED_APPROVAL},
    StepState.SUCCESS: set(),
    StepState.FAILED: {StepState.RETRYING, StepState.HYBRID_FALLBACK, StepState.CANCELLED},
    StepState.BLOCKED_APPROVAL: {StepState.RUNNING, StepState.CANCELLED},
    StepState.RETRYING: {StepState.RUNNING, StepState.FAILED, StepState.HYBRID_FALLBACK},
    StepState.HYBRID_FALLBACK: {StepState.RUNNING, StepState.SUCCESS, StepState.FAILED},
    StepState.SKIPPED: set(),
    StepState.CANCELLED: set(),
}


class StepRecord(BaseModel):
    """Track the lifecycle of a single plan step."""
    step_id: int
    state: StepState = StepState.PENDING
    attempts: int = 0
    max_retries: int = 2
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)
    last_error: Optional[str] = None
    last_error_code: Optional[str] = None
    vlm_fallback_used: bool = False
    approval_granted: bool = False


class TaskTracker:
    """Tracks step execution lifecycle for a single session.

    State machine:
        PENDING → RUNNING → SUCCESS
                          → FAILED → RETRYING → RUNNING
                                    → HYBRID_FALLBACK → SUCCESS/FAILED
                          → BLOCKED_APPROVAL → RUNNING (on approval)
    """

    def __init__(self, session_id: str):
        self.session_id = session_id
        self._steps: dict[int, StepRecord] = {}
        self._plan_id: Optional[str] = None
        self._is_paused: bool = False
        self._is_stopped: bool = False
        logger.info("TaskTracker created for session %s", session_id)

    # ------------------------------------------------------------------
    # Plan lifecycle
    # ------------------------------------------------------------------

    def initialize_plan(self, plan_id: str, step_ids: list[int]) -> None:
        """Register a new plan with its step IDs."""
        self._plan_id = plan_id
        self._steps = {}
        for sid in step_ids:
            self._steps[sid] = StepRecord(step_id=sid)
        self._is_paused = False
        self._is_stopped = False
        logger.info(
            "Plan %s initialized with %d steps for session %s",
            plan_id, len(step_ids), self.session_id,
        )

    def get_plan_id(self) -> Optional[str]:
        return self._plan_id

    # ------------------------------------------------------------------
    # State transitions
    # ------------------------------------------------------------------

    def transition(self, step_id: int, new_state: StepState) -> None:
        """Transition a step to a new state. Raises ValueError on invalid transition."""
        record = self._get_record(step_id)
        old_state = record.state

        if new_state not in VALID_TRANSITIONS.get(old_state, set()):
            raise ValueError(
                f"Invalid transition: step {step_id} cannot go from "
                f"{old_state.value} to {new_state.value}"
            )

        record.state = new_state
        record.updated_at = time.time()

        if new_state == StepState.RUNNING:
            record.attempts += 1
        elif new_state == StepState.BLOCKED_APPROVAL:
            record.approval_granted = False

        logger.info(
            "Step %d: %s → %s (attempt %d)",
            step_id, old_state.value, new_state.value, record.attempts,
        )

    def mark_running(self, step_id: int) -> None:
        self.transition(step_id, StepState.RUNNING)

    def mark_success(self, step_id: int) -> None:
        self.transition(step_id, StepState.SUCCESS)

    def mark_failed(self, step_id: int, error: str = "", error_code: str = "") -> None:
        record = self._get_record(step_id)
        record.last_error = error
        record.last_error_code = error_code
        self.transition(step_id, StepState.FAILED)

    def mark_blocked_approval(self, step_id: int) -> None:
        self.transition(step_id, StepState.BLOCKED_APPROVAL)

    def mark_retrying(self, step_id: int) -> None:
        record = self._get_record(step_id)
        if record.attempts >= record.max_retries:
            logger.warning(
                "Step %d exceeded max retries (%d) — moving to HYBRID_FALLBACK",
                step_id, record.max_retries,
            )
            self.transition(step_id, StepState.HYBRID_FALLBACK)
            record.vlm_fallback_used = True
        else:
            self.transition(step_id, StepState.RETRYING)

    def mark_hybrid_fallback(self, step_id: int) -> None:
        record = self._get_record(step_id)
        record.vlm_fallback_used = True
        self.transition(step_id, StepState.HYBRID_FALLBACK)

    def approve_step(self, step_id: int) -> None:
        """Approve a blocked step — transitions BLOCKED_APPROVAL → RUNNING."""
        record = self._get_record(step_id)
        if record.state != StepState.BLOCKED_APPROVAL:
            raise ValueError(
                f"Step {step_id} is not blocked for approval (current: {record.state.value})"
            )
        record.approval_granted = True
        self.transition(step_id, StepState.RUNNING)

    def deny_step(self, step_id: int) -> None:
        """Deny a blocked step — mark as cancelled."""
        record = self._get_record(step_id)
        record.approval_granted = False
        self.transition(step_id, StepState.CANCELLED)

    def skip_step(self, step_id: int) -> None:
        self.transition(step_id, StepState.SKIPPED)

    # ------------------------------------------------------------------
    # Error handling
    # ------------------------------------------------------------------

    def set_error(self, step_id: int, error: str, error_code: str = "") -> None:
        """Set error details on a failed step."""
        record = self._get_record(step_id)
        record.last_error = error
        record.last_error_code = error_code
        record.updated_at = time.time()

    def handle_step_result(
        self,
        step_id: int,
        status: str,
        error_code: str = "",
        error_message: str = "",
    ) -> StepState:
        """Process a step result from the extension and return the next state.

        Returns the state the step should transition to.
        """
        record = self._get_record(step_id)

        if status == "success":
            return StepState.SUCCESS

        if status == "error":
            record.last_error = error_message
            record.last_error_code = error_code

            # Route by error code per COMMUNICATION_SPEC.md §6.2
            if error_code == "SELECTOR_NOT_FOUND":
                return StepState.HYBRID_FALLBACK
            elif error_code == "ELEMENT_OBSCURED":
                return StepState.RETRYING
            elif error_code == "CAPTCHA_TRIGGERED":
                return StepState.BLOCKED_APPROVAL
            elif error_code == "PAGE_TIMEOUT":
                if record.attempts < record.max_retries:
                    return StepState.RETRYING
                else:
                    return StepState.HYBRID_FALLBACK
            elif error_code == "AUTH_REQUIRED":
                return StepState.BLOCKED_APPROVAL
            else:
                # Generic error — retry if attempts remain
                if record.attempts < record.max_retries:
                    return StepState.RETRYING
                else:
                    return StepState.HYBRID_FALLBACK

        return record.state

    # ------------------------------------------------------------------
    # Pause / Resume / Stop
    # ------------------------------------------------------------------

    def pause(self) -> None:
        """Pause the agent — no new steps will be dispatched."""
        self._is_paused = True
        logger.info("TaskTracker paused for session %s", self.session_id)

    def resume(self) -> None:
        """Resume the agent — steps can be dispatched again."""
        self._is_paused = False
        logger.info("TaskTracker resumed for session %s", self.session_id)

    def stop(self) -> None:
        """Stop the agent — cancel all pending steps."""
        self._is_stopped = True
        self._is_paused = False
        for step_id, record in self._steps.items():
            if record.state in (StepState.PENDING, StepState.RETRYING):
                record.state = StepState.CANCELLED
                record.updated_at = time.time()
        logger.info("TaskTracker stopped for session %s", self.session_id)

    def is_paused(self) -> bool:
        return self._is_paused

    def is_stopped(self) -> bool:
        return self._is_stopped

    def is_blocked(self) -> bool:
        """Check if any step is waiting for approval."""
        return any(r.state == StepState.BLOCKED_APPROVAL for r in self._steps.values())

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------

    def get_step(self, step_id: int) -> StepRecord:
        return self._get_record(step_id)

    def get_all_steps(self) -> list[StepRecord]:
        return list(self._steps.values())

    def get_next_executable(self) -> Optional[StepRecord]:
        """Get the next step that can be dispatched (PENDING, not paused/stopped)."""
        if self._is_paused or self._is_stopped:
            return None
        for record in sorted(self._steps.values(), key=lambda r: r.step_id):
            if record.state == StepState.PENDING:
                return record
        return None

    def get_completed_step_ids(self) -> set[int]:
        """Return IDs of all completed (SUCCESS/SKIPPED) steps."""
        return {
            sid for sid, r in self._steps.items()
            if r.state in (StepState.SUCCESS, StepState.SKIPPED)
        }

    def get_failed_steps(self) -> list[StepRecord]:
        return [r for r in self._steps.values() if r.state == StepState.FAILED]

    def get_approval_blocked_steps(self) -> list[StepRecord]:
        return [r for r in self._steps.values() if r.state == StepState.BLOCKED_APPROVAL]

    def is_plan_complete(self) -> bool:
        """Check if all steps are in a terminal state."""
        terminal = {StepState.SUCCESS, StepState.SKIPPED, StepState.CANCELLED}
        return all(r.state in terminal for r in self._steps.values())

    def is_plan_failed(self) -> bool:
        """Check if the plan has irrecoverably failed."""
        terminal = {StepState.SUCCESS, StepState.SKIPPED, StepState.CANCELLED}
        non_terminal = [r for r in self._steps.values() if r.state not in terminal]
        return len(non_terminal) > 0 and all(
            r.state in (StepState.FAILED, StepState.HYBRID_FALLBACK) and r.attempts >= r.max_retries
            for r in non_terminal
        )

    def get_summary(self) -> dict[str, Any]:
        """Return a summary of the task tracker state."""
        state_counts = {}
        for record in self._steps.values():
            state = record.state.value
            state_counts[state] = state_counts.get(state, 0) + 1

        return {
            "session_id": self.session_id,
            "plan_id": self._plan_id,
            "total_steps": len(self._steps),
            "state_counts": state_counts,
            "is_paused": self._is_paused,
            "is_stopped": self._is_stopped,
            "is_complete": self.is_plan_complete(),
            "is_failed": self.is_plan_failed(),
        }

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _get_record(self, step_id: int) -> StepRecord:
        if step_id not in self._steps:
            raise KeyError(f"No step with id {step_id} in plan for session {self.session_id}")
        return self._steps[step_id]


# ---------------------------------------------------------------------------
# Global tracker registry — one TaskTracker per session
# ---------------------------------------------------------------------------

_trackers: dict[str, TaskTracker] = {}


def get_tracker(session_id: str) -> TaskTracker:
    """Get or create a TaskTracker for a session."""
    if session_id not in _trackers:
        _trackers[session_id] = TaskTracker(session_id)
    return _trackers[session_id]


def remove_tracker(session_id: str) -> None:
    """Remove a tracker when session ends."""
    _trackers.pop(session_id, None)
