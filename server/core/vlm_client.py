from __future__ import annotations

import logging
from typing import Any

import httpx

from config import get_settings

logger = logging.getLogger(__name__)

# VLM endpoint paths — matching Dev 6's VLM server
VLM_ENDPOINTS = {
    "health": "/health",
    "detect_obstacles": "/detect-obstacles",
    "ground": "/ground",
    "verify": "/verify",
    "analyze": "/analyze",
}


async def _post(endpoint: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Send a POST request to the VLM server."""
    settings = get_settings()
    url = f"{settings.VLM_SERVER_URL}{endpoint}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as e:
            logger.error("VLM server returned %d: %s", e.response.status_code, e.response.text[:200])
            raise
        except httpx.ConnectError:
            logger.error("Cannot connect to VLM server at %s", url)
            raise


async def _get(endpoint: str) -> dict[str, Any]:
    """Send a GET request to the VLM server."""
    settings = get_settings()
    url = f"{settings.VLM_SERVER_URL}{endpoint}"

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.error("VLM health check failed: %s", e)
            raise


async def check_health() -> dict[str, Any]:
    """Check VLM server health."""
    return await _get(VLM_ENDPOINTS["health"])


async def detect_obstacles(screenshot_b64: str, prompt: str = "") -> dict[str, Any]:
    """Detect popups, cookie walls, CAPTCHAs, login walls in a screenshot."""
    if not prompt:
        prompt = (
            "Identify any modal popup, cookie wall, newsletter overlay, "
            "login wall, or CAPTCHA blocking the webpage content. "
            "Classify the obstacle type and provide the close button coordinates if visible."
        )
    return await _post(VLM_ENDPOINTS["detect_obstacles"], {
        "screenshot": screenshot_b64,
        "prompt": prompt,
        "max_tokens": 1024,
    })


async def ground_element(screenshot_b64: str, task: str) -> dict[str, Any]:
    """Find precise pixel coordinates for a UI element using visual grounding."""
    return await _post(VLM_ENDPOINTS["ground"], {
        "screenshot": screenshot_b64,
        "prompt": task,
        "max_tokens": 1024,
    })


async def verify_state(screenshot_b64: str, expected_state: str) -> dict[str, Any]:
    """Verify whether a visual condition is met after action execution."""
    return await _post(VLM_ENDPOINTS["verify"], {
        "screenshot": screenshot_b64,
        "prompt": f"Verify this condition: {expected_state}",
        "max_tokens": 1024,
    })


async def analyze_image(screenshot_b64: str, prompt: str) -> dict[str, Any]:
    """General multi-modal image + text reasoning."""
    return await _post(VLM_ENDPOINTS["analyze"], {
        "screenshot": screenshot_b64,
        "prompt": prompt,
        "max_tokens": 1024,
    })
