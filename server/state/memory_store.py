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


class MemoryEntry(BaseModel):
    """A single memory entry stored across sessions."""
    key: str
    value: Any
    category: str = "general"  # preferences, goals, entities, history
    source_session_id: str = ""
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)


class MemoryStore:
    """Cross-session memory store using SQLite for structured data
    and JSON files for memory snapshots.

    Stores user preferences, completed goals, and extracted entities
    that persist across sessions.
    """

    def __init__(self, db_path: str | None = None, memory_dir: str | None = None):
        settings = get_settings()
        self._db_path = db_path or settings.SESSION_DB_PATH
        self._memory_dir = memory_dir or settings.MEMORY_DIR
        Path(self._memory_dir).mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self) -> None:
        """Create the memory table if it doesn't exist."""
        conn = sqlite3.connect(self._db_path)
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS memory (
                    key TEXT PRIMARY KEY,
                    value TEXT,
                    category TEXT DEFAULT 'general',
                    source_session_id TEXT DEFAULT '',
                    created_at REAL,
                    updated_at REAL
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_memory_category
                ON memory(category)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_memory_source
                ON memory(source_session_id)
            """)
            conn.commit()
            logger.info("Memory store initialized at %s", self._db_path)
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # CRUD operations
    # ------------------------------------------------------------------

    def store(
        self,
        key: str,
        value: Any,
        category: str = "general",
        source_session_id: str = "",
    ) -> None:
        """Store or update a memory entry."""
        now = time.time()
        conn = sqlite3.connect(self._db_path)
        try:
            conn.execute(
                """INSERT OR REPLACE INTO memory
                   (key, value, category, source_session_id, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (key, json.dumps(value), category, source_session_id, now, now),
            )
            conn.commit()
            logger.debug("Memory stored: %s (category=%s)", key, category)
        finally:
            conn.close()

    def retrieve(self, key: str) -> Optional[Any]:
        """Retrieve a memory entry by key."""
        conn = sqlite3.connect(self._db_path)
        try:
            cursor = conn.execute(
                "SELECT value FROM memory WHERE key = ?",
                (key,),
            )
            row = cursor.fetchone()
            if row is None:
                return None
            return json.loads(row[0])
        finally:
            conn.close()

    def delete(self, key: str) -> bool:
        """Delete a memory entry. Returns True if found."""
        conn = sqlite3.connect(self._db_path)
        try:
            cursor = conn.execute("DELETE FROM memory WHERE key = ?", (key,))
            conn.commit()
            return cursor.rowcount > 0
        finally:
            conn.close()

    def list_by_category(self, category: str) -> list[MemoryEntry]:
        """List all memory entries in a category."""
        conn = sqlite3.connect(self._db_path)
        try:
            cursor = conn.execute(
                "SELECT key, value, category, source_session_id, created_at, updated_at "
                "FROM memory WHERE category = ? ORDER BY updated_at DESC",
                (category,),
            )
            rows = cursor.fetchall()
            return [
                MemoryEntry(
                    key=row[0],
                    value=json.loads(row[1]),
                    category=row[2],
                    source_session_id=row[3],
                    created_at=row[4],
                    updated_at=row[5],
                )
                for row in rows
            ]
        finally:
            conn.close()

    def search(self, query: str) -> list[MemoryEntry]:
        """Search memory entries by key pattern (case-insensitive LIKE)."""
        conn = sqlite3.connect(self._db_path)
        try:
            cursor = conn.execute(
                "SELECT key, value, category, source_session_id, created_at, updated_at "
                "FROM memory WHERE key LIKE ? ORDER BY updated_at DESC",
                (f"%{query}%",),
            )
            rows = cursor.fetchall()
            return [
                MemoryEntry(
                    key=row[0],
                    value=json.loads(row[1]),
                    category=row[2],
                    source_session_id=row[3],
                    created_at=row[4],
                    updated_at=row[5],
                )
                for row in rows
            ]
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Convenience methods for common memory types
    # ------------------------------------------------------------------

    def store_preference(self, key: str, value: Any, session_id: str = "") -> None:
        """Store a user preference (e.g., budget, brand, language)."""
        self.store(key, value, category="preferences", source_session_id=session_id)

    def get_preferences(self) -> dict[str, Any]:
        """Get all user preferences as a flat dict."""
        entries = self.list_by_category("preferences")
        return {e.key: e.value for e in entries}

    def store_goal(self, goal_id: str, goal_data: dict[str, Any], session_id: str = "") -> None:
        """Store a completed goal with its result data."""
        self.store(goal_id, goal_data, category="goals", source_session_id=session_id)

    def get_completed_goals(self) -> list[dict[str, Any]]:
        """Get all completed goals."""
        entries = self.list_by_category("goals")
        return [{"id": e.key, **e.value} for e in entries]

    def store_entity(self, entity_key: str, entity_data: Any, session_id: str = "") -> None:
        """Store an extracted entity (e.g., product names, prices, URLs)."""
        self.store(entity_key, entity_data, category="entities", source_session_id=session_id)

    def get_entities(self) -> dict[str, Any]:
        """Get all stored entities as a flat dict."""
        entries = self.list_by_category("entities")
        return {e.key: e.value for e in entries}

    def store_history(self, action_key: str, action_data: dict[str, Any], session_id: str = "") -> None:
        """Store a historical action/event for context."""
        self.store(action_key, action_data, category="history", source_session_id=session_id)

    def get_history(self, limit: int = 50) -> list[dict[str, Any]]:
        """Get recent history entries."""
        entries = self.list_by_category("history")
        return [{"id": e.key, **e.value} for e in entries[:limit]]

    # ------------------------------------------------------------------
    # Context assembly for planner
    # ------------------------------------------------------------------

    def get_session_context(self, session_id: str) -> dict[str, Any]:
        """Assemble cross-session context for the planner.

        Returns preferences, recent goals, and relevant entities
        that can be used for context carry-forward in new queries.
        """
        preferences = self.get_preferences()
        recent_goals = self.get_completed_goals()[-5:]  # last 5 goals
        entities = self.get_entities()

        return {
            "user_preferences": preferences,
            "recent_goals": recent_goals,
            "known_entities": entities,
        }

    # ------------------------------------------------------------------
    # Snapshots (JSON files)
    # ------------------------------------------------------------------

    def save_snapshot(self, session_id: str, data: dict[str, Any]) -> Path:
        """Save a memory snapshot to a JSON file."""
        snapshot_path = Path(self._memory_dir) / f"{session_id}_snapshot.json"
        with open(snapshot_path, "w") as f:
            json.dump(data, f, indent=2, default=str)
        logger.info("Memory snapshot saved: %s", snapshot_path)
        return snapshot_path

    def load_snapshot(self, session_id: str) -> Optional[dict[str, Any]]:
        """Load a memory snapshot from a JSON file."""
        snapshot_path = Path(self._memory_dir) / f"{session_id}_snapshot.json"
        if not snapshot_path.exists():
            return None
        with open(snapshot_path) as f:
            data = json.load(f)
        logger.info("Memory snapshot loaded: %s", snapshot_path)
        return data

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------

    def clear_category(self, category: str) -> int:
        """Delete all entries in a category. Returns count deleted."""
        conn = sqlite3.connect(self._db_path)
        try:
            cursor = conn.execute(
                "DELETE FROM memory WHERE category = ?",
                (category,),
            )
            conn.commit()
            count = cursor.rowcount
            logger.info("Cleared %d entries from category %s", count, category)
            return count
        finally:
            conn.close()

    def clear_all(self) -> int:
        """Delete all memory entries. Returns count deleted."""
        conn = sqlite3.connect(self._db_path)
        try:
            cursor = conn.execute("DELETE FROM memory")
            conn.commit()
            count = cursor.rowcount
            logger.warning("Cleared ALL memory entries (%d total)", count)
            return count
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# Singleton accessor
# ---------------------------------------------------------------------------

_memory_store: MemoryStore | None = None


def get_memory_store(db_path: str | None = None, memory_dir: str | None = None) -> MemoryStore:
    """Get or create the singleton MemoryStore."""
    global _memory_store
    if _memory_store is None:
        _memory_store = MemoryStore(db_path=db_path, memory_dir=memory_dir)
    return _memory_store
