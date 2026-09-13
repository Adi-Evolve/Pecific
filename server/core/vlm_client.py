from __future__ import annotations

import logging
from typing import Any

import httpx

from config import get_settings

logger = logging.getLogger(__name__)

# VLM endpoint paths — matching Dev 6's VLM server (DEV_6.ipynb)
VLM_ENDPOINTS = {
    "health": "/health",
    "detect_obstacle": "/detect_obstacle",  # Dev 6 uses underscore, no trailing 's'
    "ground": "/ground",
    "verify_action": "/verify_action",      # Dev 6 exposes /verify_action, not /verify
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
    return await _post(VLM_ENDPOINTS["detect_obstacle"], {
        "screenshot": screenshot_b64,
        "max_tokens": 1024,
    })


async def ground_element(screenshot_b64: str, task: str) -> dict[str, Any]:
    """Find precise pixel coordinates for a UI element using visual grounding."""
    return await _post(VLM_ENDPOINTS["ground"], {
        "screenshot": screenshot_b64,
        "target": task,  # Dev 6's GroundRequest requires 'target', not 'prompt'
        "max_tokens": 1024,
    })


async def verify_state(
    screenshot_b64: str,
    expected_state: str,
    action_description: str = "",
) -> dict[str, Any]:
    """Verify whether a visual condition is met after action execution.

    Matches Dev 6's VerifyActionRequest schema:
    - post_screenshot: screenshot taken after the action
    - action_description: what action was just executed (e.g. 'Clicked Add to Cart')
    - expected_outcome: what visual change should be visible (expected_state)
    """
    return await _post(VLM_ENDPOINTS["verify_action"], {
        "post_screenshot": screenshot_b64,
        "action_description": action_description,
        "expected_outcome": expected_state,
        "max_tokens": 1024,
    })


async def analyze_image(screenshot_b64: str, prompt: str) -> dict[str, Any]:
    """General multi-modal image + text reasoning."""
    return await _post(VLM_ENDPOINTS["analyze"], {
        "screenshot": screenshot_b64,
        "prompt": prompt,
        "max_tokens": 1024,
    })
