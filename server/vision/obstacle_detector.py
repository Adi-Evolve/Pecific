"""
server/vision/obstacle_detector.py — Dynamic Obstacle Detection Module
Role: Dev 6 (Server Vision & VLM Engineer)

Detects and classifies visual obstacles that block automated browser navigation:
- Cookie consent banners / GDPR dialogs
- CAPTCHA / bot verification challenges
- Promotional modal overlays / newsletter popups
- Mandatory login / authentication walls
"""

from typing import Optional, Dict, Any
from server.models.vlm_loader import VLMClient, default_vlm_client


def detect_obstacles(
    screenshot_b64: str,
    client: Optional[VLMClient] = None
) -> Dict[str, Any]:
    """
    Analyzes a screenshot for active obstacles and suggests resolution actions.
    """
    vlm = client or default_vlm_client
    return vlm.detect_obstacle(screenshot_b64=screenshot_b64)
