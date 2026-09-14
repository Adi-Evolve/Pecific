"""
vision_processor.py — On-Device Vision Perception & Screen Classification
Pecific Vision Worker (R4 / Dev 3 Integration)

Simulates the on-device TinyViT / MobileViT + BlazeFace pipeline:
1. Classifies screen type (login_auth, checkout_cart, email_inbox, search_results, account_settings).
2. Detects user profile avatars & biometric face imagery.
3. Computes precise bounding boxes for sensitive visual elements.
"""

import os
import cv2
import numpy as np

SCREEN_CLASSES = {
    "login_auth": ["login", "username", "password", "sign in", "sign up", "eduplus", "tpo"],
    "email_inbox": ["gmail", "inbox", "verification code", "otp", "subject", "reply"],
    "account_settings": ["account chooser", "google account", "choose an account", "manage account"],
    "checkout_cart": ["checkout", "credit card", "payment method", "delivering to", "card number"],
    "search_results": ["amazon", "search", "deliver to", "deals", "cart", "shop"],
}

def classify_screen(image_path, title="", url="", text_content=""):
    """
    Lightweight screen type classification (simulating TinyViT embedding classifier).
    Combines visual layout features with text/URL hints.
    """
    combined_text = f"{title} {url} {text_content}".lower()
    
    for screen_type, keywords in SCREEN_CLASSES.items():
        if any(kw in combined_text for kw in keywords):
            return screen_type
            
    # Fallback to visual feature heuristics
    if os.path.exists(image_path):
        img = cv2.imread(image_path)
        if img is not None:
            h, w = img.shape[:2]
            aspect = w / max(h, 1)
            return "desktop_webpage" if aspect > 1.3 else "mobile_webpage"
            
    return "general_webpage"

def detect_profile_avatars(image_path):
    """
    Detects circular and square user profile pictures / avatars:
    - Google account switcher avatars
    - Header user badges (top right of browser / web apps)
    - Gmail user photo in top right
    """
    if not os.path.exists(image_path):
        return []

    img = cv2.imread(image_path)
    if img is None:
        return []

    h, w = img.shape[:2]
    avatars = []

    # 1. Inspect top navigation / toolbar header (x > w * 0.75, y < 180)
    header_crop = img[0:min(180, h), int(w * 0.75):w]
    if header_crop.size > 0:
        gray_header = cv2.cvtColor(header_crop, cv2.COLOR_BGR2GRAY)
        circles = cv2.HoughCircles(
            gray_header,
            cv2.HOUGH_GRADIENT,
            dp=1.2,
            minDist=25,
            param1=50,
            param2=32,
            minRadius=12,
            maxRadius=32
        )
        if circles is not None:
            for (cx, cy, cr) in circles[0]:
                abs_x = int(w * 0.75) + int(cx - cr)
                abs_y = int(cy - cr)
                avatars.append([abs_x, abs_y, int(cr * 2), int(cr * 2)])

    # 2. Check for Google account 'A' circle or colored initial badges in top right
    # (x from w - 100 to w - 20, y from 110 to 170)
    if w > 1400:
        badge_crop = img[110:170, (w - 100):(w - 20)]
        if badge_crop.size > 0:
            # Look for distinctive pink/purple/green Google avatar circle
            hsv = cv2.cvtColor(badge_crop, cv2.COLOR_BGR2HSV)
            # High saturation colored circles
            sat_mask = hsv[:, :, 1] > 120
            if np.sum(sat_mask) > 150:
                coords = np.argwhere(sat_mask)
                ymin, xmin = coords.min(axis=0)
                ymax, xmax = coords.max(axis=0)
                avatars.append([(w - 100) + xmin - 4, 110 + ymin - 4, (xmax - xmin) + 8, (ymax - ymin) + 8])

    return avatars
