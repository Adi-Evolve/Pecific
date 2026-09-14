from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from api.routes import router as api_router
from api.websocket_handler import router as ws_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle manager."""
    settings = get_settings()
    logger.info("Starting %s v%s", settings.APP_NAME, settings.APP_VERSION)
    logger.info("LLM model: %s (4bit=%s, flash_attn=%s)",
                settings.LLM_MODEL_NAME, settings.LLM_LOAD_IN_4BIT, settings.LLM_FLASH_ATTENTION)
    logger.info("VLM server: %s", settings.VLM_SERVER_URL)

    # Load LLM on startup
    try:
        from models.llm_loader import load_llm
        load_llm(
            model_name=settings.LLM_MODEL_NAME,
            device=settings.LLM_DEVICE,
            load_in_4bit=settings.LLM_LOAD_IN_4BIT,
        )
        logger.info("LLM loaded successfully")
    except Exception as e:
        logger.warning("Could not load LLM (will fail on plan generation): %s", e)

    yield

    # Unload LLM on shutdown
    try:
        from models.llm_loader import unload_llm
        unload_llm()
    except Exception:
        pass
    logger.info("Shutting down server")


app = FastAPI(
    title="Pecific LLM Server",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api")
app.include_router(ws_router)


@app.get("/")
async def root():
    return {"service": "Pecific LLM Server", "status": "running"}
