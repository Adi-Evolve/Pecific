from __future__ import annotations

import json
import logging
import sqlite3
import time
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, Field

from config import get_settings

logger = logging.getLogger(__name__)


class SessionData(BaseModel):
    """Serializable session state."""
    session_id: str
    goal: str = ""
    plan_id: Optional[str] = None
    step_ids: list[int] = Field(default_factory=list)
    completed_step_ids: list[int] = Field(default_factory=list)
    user_preferences: dict[str, Any] = Field(default_factory=dict)
    extracted_entities: dict[str, Any] = Field(default_factory=dict)
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)
    archived: bool = False


class SessionManager:
    """Manages session lifecycle: create, restore, archive.

    Sessions are persisted to SQLite for cross-session memory.
    """

    def __init__(self, db_path: str | None = None):
        settings = get_settings()
        self._db_path = db_path or settings.SESSION_DB_PATH
        self._init_db()

    def _init_db(self) -> None:
        """Create the sessions table if it doesn't exist."""
        Path(self._db_path).parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self._db_path)
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY,
                    goal TEXT DEFAULT '',
                    plan_id TEXT,
                    step_ids TEXT DEFAULT '[]',
                    completed_step_ids TEXT DEFAULT '[]',
                    user_preferences TEXT DEFAULT '{}',
                    extracted_entities TEXT DEFAULT '{}',
                    created_at REAL,
                    updated_at REAL,
                    archived INTEGER DEFAULT 0
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_sessions_archived
                ON sessions(archived)
            """)
            conn.commit()
            logger.info("Session database initialized at %s", self._db_path)
        finally:
            conn.close()

    def create_session(self, session_id: str, goal: str = "") -> SessionData:
        """Create a new session with empty memory."""
        now = time.time()
        session = SessionData(
            session_id=session_id,
            goal=goal,
            created_at=now,
            updated_at=now,
        )

        conn = sqlite3.connect(self._db_path)
        try:
            conn.execute(
                """INSERT OR REPLACE INTO sessions
                   (session_id, goal, plan_id, step_ids, completed_step_ids,
                    user_preferences, extracted_entities, created_at, updated_at, archived)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    session.session_id,
                    session.goal,
                    session.plan_id,
                    json.dumps(session.step_ids),
                    json.dumps(session.completed_step_ids),
                    json.dumps(session.user_preferences),
                    json.dumps(session.extracted_entities),
                    session.created_at,
                    session.updated_at,
                    0,
                ),
            )
            conn.commit()
            logger.info("Session created: %s (goal: %s)", session_id, goal[:50])
        finally:
            conn.close()

        return session

    def restore_session(self, session_id: str) -> Optional[dict[str, Any]]:
        """Load a session from SQLite by session_id.

        Returns the session data as a dict, or None if not found.
        """
        conn = sqlite3.connect(self._db_path)
        try:
            cursor = conn.execute(
                "SELECT * FROM sessions WHERE session_id = ? AND archived = 0",
                (session_id,),
            )
            row = cursor.fetchone()
            if row is None:
                logger.warning("Session %s not found", session_id)
                return None

            columns = [desc[0] for desc in cursor.description]
            data = dict(zip(columns, row))

            # Deserialize JSON fields
            for field in ("step_ids", "completed_step_ids", "user_preferences", "extracted_entities"):
                if field in data and isinstance(data[field], str):
                    data[field] = json.loads(data[field])

            logger.info("Session restored: %s", session_id)
            return data
        finally:
            conn.close()

    def update_session(
        self,
        session_id: str,
        goal: str | None = None,
        plan_id: str | None = None,
        step_ids: list[int] | None = None,
        completed_step_ids: list[int] | None = None,
        user_preferences: dict[str, Any] | None = None,
        extracted_entities: dict[str, Any] | None = None,
    ) -> bool:
        """Update session fields. Returns True if the session was found."""
        conn = sqlite3.connect(self._db_path)
        try:
            # Check if session exists
            cursor = conn.execute(
                "SELECT session_id FROM sessions WHERE session_id = ?",
                (session_id,),
            )
            if cursor.fetchone() is None:
                return False

            updates = ["updated_at = ?"]
            params: list[Any] = [time.time()]

            if goal is not None:
                updates.append("goal = ?")
                params.append(goal)
            if plan_id is not None:
                updates.append("plan_id = ?")
                params.append(plan_id)
            if step_ids is not None:
                updates.append("step_ids = ?")
                params.append(json.dumps(step_ids))
            if completed_step_ids is not None:
                updates.append("completed_step_ids = ?")
                params.append(json.dumps(completed_step_ids))
            if user_preferences is not None:
                updates.append("user_preferences = ?")
                params.append(json.dumps(user_preferences))
            if extracted_entities is not None:
                updates.append("extracted_entities = ?")
                params.append(json.dumps(extracted_entities))

            params.append(session_id)
            conn.execute(
                f"UPDATE sessions SET {', '.join(updates)} WHERE session_id = ?",
                params,
            )
            conn.commit()
            logger.info("Session updated: %s", session_id)
            return True
        finally:
            conn.close()

    def archive_session(self, session_id: str) -> bool:
        """Archive a completed session. Returns True if found."""
        conn = sqlite3.connect(self._db_path)
        try:
            cursor = conn.execute(
                "UPDATE sessions SET archived = 1, updated_at = ? WHERE session_id = ?",
                (time.time(), session_id),
            )
            conn.commit()
            found = cursor.rowcount > 0
            if found:
                logger.info("Session archived: %s", session_id)
            else:
                logger.warning("Session %s not found for archiving", session_id)
            return found
        finally:
            conn.close()

    def list_sessions(self, include_archived: bool = False) -> list[dict[str, Any]]:
        """List all sessions, optionally including archived ones."""
        conn = sqlite3.connect(self._db_path)
        try:
            if include_archived:
                cursor = conn.execute(
                    "SELECT session_id, goal, created_at, updated_at, archived FROM sessions ORDER BY created_at DESC"
                )
            else:
                cursor = conn.execute(
                    "SELECT session_id, goal, created_at, updated_at, archived FROM sessions WHERE archived = 0 ORDER BY created_at DESC"
                )
            rows = cursor.fetchall()
            return [
                {
                    "session_id": row[0],
                    "goal": row[1],
                    "created_at": row[2],
                    "updated_at": row[3],
                    "archived": bool(row[4]),
                }
                for row in rows
            ]
        finally:
            conn.close()

    def delete_session(self, session_id: str) -> bool:
        """Permanently delete a session. Returns True if found."""
        conn = sqlite3.connect(self._db_path)
        try:
            cursor = conn.execute(
                "DELETE FROM sessions WHERE session_id = ?",
                (session_id,),
            )
            conn.commit()
            found = cursor.rowcount > 0
            if found:
                logger.info("Session deleted: %s", session_id)
            return found
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# Singleton accessor
# ---------------------------------------------------------------------------

_session_manager: SessionManager | None = None


def get_session_manager(db_path: str | None = None) -> SessionManager:
    """Get or create the singleton SessionManager."""
    global _session_manager
    if _session_manager is None:
        _session_manager = SessionManager(db_path=db_path)
    return _session_manager
