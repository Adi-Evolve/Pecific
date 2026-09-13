from __future__ import annotations

from fastapi import APIRouter

from config import get_settings
from models.llm_loader import _llm_model

router = APIRouter()


@router.get("/health")
async def health():
    """Liveness probe — model readiness and VRAM status."""
    settings = get_settings()
    return {
        "status": "healthy",
        "version": settings.APP_VERSION,
        "llm_model": settings.LLM_MODEL_NAME,
        "llm_loaded": _llm_model is not None,
        "vlm_server": settings.VLM_SERVER_URL,
    }
