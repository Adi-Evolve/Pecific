"""
server/models/vlm_loader.py — VLM Client Interface for Qwen2.5-VL-7B Colab/Remote Service
Role: Dev 6 (Server Vision & VLM Engineer) | Consumed by: Dev 5 (Planner) & Dev 2 (Execution Verification)

Interfaces with the remote Qwen2.5-VL-7B FastAPI service running on Colab (via ngrok)
or a local GPU instance. Adheres strictly to frozen schemas:
- action.schema.json (target.coordinates [x, y])
- vision_context.schema.json (screen_type, layout, detected_regions)
"""

import os
import requests
from typing import Optional, Dict, Any, List


class VLMClient:
    """Client for communicating with the Dev 6 Qwen2.5-VL-7B Vision & Grounding Server."""

    def __init__(self, base_url: Optional[str] = None, timeout: int = 45):
        self.base_url = (base_url or os.environ.get("VLM_SERVER_URL") or "http://localhost:8000").rstrip("/")
        self.timeout = timeout

    def health(self) -> Dict[str, Any]:
        """Check status of remote VLM service."""
        try:
            res = requests.get(f"{self.base_url}/health", timeout=5)
            res.raise_for_status()
            return res.json()
        except Exception as e:
            return {"status": "offline", "error": str(e), "url": self.base_url}

    def ground(self, screenshot_b64: str, target: str, prompt: Optional[str] = None) -> Dict[str, Any]:
        """
        Visual Grounding: Returns [x, y] pixel coordinates and [x, y, w, h] bounding box
        for a given visual target element (e.g. 'Add to Cart button').
        Conforms directly to action.schema.json (target.coordinates).
        """
        payload = {
            "screenshot": screenshot_b64,
            "target": target,
            "prompt": prompt,
            "max_tokens": 256
        }
        res = requests.post(f"{self.base_url}/ground", json=payload, timeout=self.timeout)
        res.raise_for_status()
        return res.json()

    def get_vision_context(self, screenshot_b64: str, url: str = "", title: str = "") -> Dict[str, Any]:
        """
        Screen classification and spatial layout analysis.
        Conforms to schemas/vision_context.schema.json.
        """
        payload = {
            "screenshot": screenshot_b64,
            "url": url,
            "title": title,
            "max_tokens": 512
        }
        res = requests.post(f"{self.base_url}/vision_context", json=payload, timeout=self.timeout)
        res.raise_for_status()
        return res.json()

    def detect_obstacle(self, screenshot_b64: str) -> Dict[str, Any]:
        """
        Dynamic obstacle detection (popups, cookie banners, CAPTCHA challenges, login walls).
        """
        payload = {
            "screenshot": screenshot_b64,
            "max_tokens": 256
        }
        res = requests.post(f"{self.base_url}/detect_obstacle", json=payload, timeout=self.timeout)
        res.raise_for_status()
        return res.json()

    def verify_action(
        self,
        post_screenshot_b64: str,
        action_description: str,
        expected_outcome: str,
        pre_screenshot_b64: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Visual verification of action execution success comparing screenshots.
        """
        payload = {
            "post_screenshot": post_screenshot_b64,
            "action_description": action_description,
            "expected_outcome": expected_outcome,
            "pre_screenshot": pre_screenshot_b64,
            "max_tokens": 256
        }
        res = requests.post(f"{self.base_url}/verify_action", json=payload, timeout=self.timeout)
        res.raise_for_status()
        return res.json()


# Global default client instance
default_vlm_client = VLMClient()
