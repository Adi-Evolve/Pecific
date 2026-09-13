"""
server/vision/visual_grounding.py — Visual Grounding Module
Role: Dev 6 (Server Vision & VLM Engineer)

Provides visual element localization and pixel coordinate extraction for VISION-mode actions
when DOM elements are inaccessible, ambiguous, or rendered inside HTML5 Canvas/WebGL.
"""

from typing import Optional, Dict, Any, Tuple
from server.models.vlm_loader import VLMClient, default_vlm_client


def ground_element(
    screenshot_b64: str,
    target_description: str,
    client: Optional[VLMClient] = None
) -> Tuple[Optional[int], Optional[int], Dict[str, Any]]:
    """
    Ground a visual target description on a webpage screenshot.
    Returns (x, y, full_details) where (x, y) are pixel coordinates for action.schema.json.
    """
    vlm = client or default_vlm_client
    result = vlm.ground(screenshot_b64=screenshot_b64, target=target_description)
    
    coords = result.get("coordinates")
    if coords and len(coords) == 2:
        return coords[0], coords[1], result
    return None, None, result
