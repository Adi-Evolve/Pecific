"""
server/vision/verification.py — Visual Action Verification Module
Role: Dev 6 (Server Vision & VLM Engineer)

Verifies that an executed browser action actually succeeded by evaluating post-action visual cues.
"""

from typing import Optional, Dict, Any
from server.models.vlm_loader import VLMClient, default_vlm_client


def verify_visual_action(
    post_screenshot_b64: str,
    action_description: str,
    expected_outcome: str,
    pre_screenshot_b64: Optional[str] = None,
    client: Optional[VLMClient] = None
) -> Dict[str, Any]:
    """
    Evaluates whether the action produced the expected visual transition.
    """
    vlm = client or default_vlm_client
    return vlm.verify_action(
        post_screenshot_b64=post_screenshot_b64,
        action_description=action_description,
        expected_outcome=expected_outcome,
        pre_screenshot_b64=pre_screenshot_b64
    )
