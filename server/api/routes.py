from __future__ import annotations

from fastapi import APIRouter

from config import get_settings

router = APIRouter()


@router.get("/health")
async def health():
    """Liveness probe — model readiness and VRAM status."""
    settings = get_settings()
    return {
        "status": "healthy",
        "version": settings.APP_VERSION,
        "llm_model": settings.LLM_MODEL_NAME,
        "llm_loaded": False,  # Phase 2: set to True after model loads
        "vlm_server": settings.VLM_SERVER_URL,
    }
