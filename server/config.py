from __future__ import annotations

import os
from pathlib import Path
from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Server configuration — loaded from environment variables with sensible defaults."""

    # App
    APP_NAME: str = "Pecific LLM Server"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False

    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    WORKERS: int = 1

    # LLM Model
    LLM_MODEL_NAME: str = "Qwen/Qwen3-8B"
    LLM_LOAD_IN_4BIT: bool = True
    LLM_DEVICE: str = "cuda"  # "cuda" for GPU, "cpu" for testing
    LLM_MAX_NEW_TOKENS: int = 2048
    LLM_TEMPERATURE: float = 0.1
    LLM_TOP_P: float = 0.95
    LLM_FLASH_ATTENTION: bool = False  # MUST be False on T4 (no Ampere+)

    # VLM Server (Dev 6's server)
    VLM_SERVER_URL: str = "https://vlm-server.ngrok-free.app"

    # Session persistence
    SESSION_DB_PATH: str = str(Path(__file__).parent / "data" / "sessions.db")
    MEMORY_DIR: str = str(Path(__file__).parent / "data" / "memory")

    # WebSocket
    WS_HEARTBEAT_INTERVAL: int = 30  # seconds

    model_config = {
        "env_prefix": "PECIFIC_",
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


@lru_cache
def get_settings() -> Settings:
    return Settings()
