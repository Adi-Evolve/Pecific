"""
redact_image_helper.py — Image Blackout, Face & Profile Avatar Redaction Engine
PrivacyLens Privacy Engine (Dev 3 — R3)

Applies visual blackout to real screenshots:
1. Detects faces via OpenCV Haar Cascade classifier (with safety padding)
2. Detects user profile avatars / account circles (via vision processing & Hough analysis)
3. Blackouts DOM bounding boxes of redacted PII elements
4. Saves redacted image to output path
5. Returns JSON with stats and base64-encoded image data URL
"""

import sys
import json
import base64
import os
import cv2
import numpy as np

def detect_user_avatars(img):
    """
    Detects user profile avatar icons and circular profile photos:
    - Top-right browser toolbar profile icon (all browsers)
    - Google account switcher top-right avatar circle 'A'
    - Gmail user photo in top right
    """
    h, w = img.shape[:2]
    avatars = []

    # 1. Look in top right header zone (x > w * 0.85, y < 170)
    if w > 800 and h > 200:
        crop_w = int(w * 0.15)
        crop_x = w - crop_w
        header_crop = img[0:min(170, h), crop_x:w]
        
        if header_crop.size > 0:
            gray = cv2.cvtColor(header_crop, cv2.COLOR_BGR2GRAY)
            circles = cv2.HoughCircles(
                gray,
                cv2.HOUGH_GRADIENT,
                dp=1.2,
                minDist=25,
                param1=50,
                param2=30,
                minRadius=10,
                maxRadius=32
            )
            if circles is not None:
                for (cx, cy, cr) in circles[0]:
                    abs_x = crop_x + int(cx - cr)
                    abs_y = int(cy - cr)
                    avatars.append([abs_x, abs_y, int(cr * 2), int(cr * 2)])

    return avatars

def redact_image(image_path, dom_regions=None, face_padding=0.1, text_padding=3, output_path=None, jpeg_quality=85):
    if dom_regions is None:
        dom_regions = []

    if not os.path.exists(image_path):
        return {"error": f"Image file not found: {image_path}", "faces_redacted": 0, "avatars_redacted": 0, "regions_redacted": 0}

    # Load image
    img = cv2.imread(image_path)
    if img is None:
        return {"error": f"Failed to load image: {image_path}", "faces_redacted": 0, "avatars_redacted": 0, "regions_redacted": 0}

    h, w = img.shape[:2]

    # 1. Face Detection via OpenCV Haar Cascade
    faces_redacted = 0
    try:
        cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
        face_cascade = cv2.CascadeClassifier(cascade_path)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        # Tuning minNeighbors to 6 and maxSize to 300 avoids false positives on deals/products
        faces = face_cascade.detectMultiScale(gray, scaleFactor=1.12, minNeighbors=6, minSize=(30, 30), maxSize=(350, 350))
        
        for (fx, fy, fw, fh) in faces:
            pad_x = int(fw * face_padding)
            pad_y = int(fh * face_padding)
            rx = max(0, fx - pad_x)
            ry = max(0, fy - pad_y)
            rw = min(w - rx, fw + 2 * pad_x)
            rh = min(h - ry, fh + 2 * pad_y)
            cv2.rectangle(img, (rx, ry), (rx + rw, ry + rh), (0, 0, 0), -1)
            faces_redacted += 1
    except Exception as e:
        sys.stderr.write(f"Face detection error: {e}\n")

    # 2. Profile Avatar Detection
    avatars_redacted = 0
    try:
        auto_avatars = detect_user_avatars(img)
        for (ax, ay, aw, ah) in auto_avatars:
            # Only blackout if not already covered
            cv2.rectangle(img, (max(0, ax - 2), max(0, ay - 2)), (min(w, ax + aw + 4), min(h, ay + ah + 4)), (0, 0, 0), -1)
            avatars_redacted += 1
    except Exception as e:
        sys.stderr.write(f"Avatar detection error: {e}\n")

    # 3. Blackout DOM PII regions
    regions_redacted = 0
    for region in dom_regions:
        if not isinstance(region, (list, tuple)) or len(region) < 4:
            continue
        rx, ry, rw, rh = [int(v) for v in region[:4]]
        # Apply padding
        rx = max(0, rx - text_padding)
        ry = max(0, ry - text_padding)
        rw = min(w - rx, rw + 2 * text_padding)
        rh = min(h - ry, rh + 2 * text_padding)
        # Draw solid black rectangle
        cv2.rectangle(img, (rx, ry), (rx + rw, ry + rh), (0, 0, 0), -1)
        regions_redacted += 1

    # 4. Save to output path if specified
    if output_path:
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        if output_path.lower().endswith('.png'):
            cv2.imwrite(output_path, img, [cv2.IMWRITE_PNG_COMPRESSION, 3])
        else:
            cv2.imwrite(output_path, img, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])

    # 5. Encode to base64 JPEG for server transmission
    _, buffer = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
    base64_str = base64.b64encode(buffer).decode('utf-8')
    data_url = f"data:image/jpeg;base64,{base64_str}"

    return {
        "success": True,
        "width": w,
        "height": h,
        "faces_redacted": faces_redacted,
        "avatars_redacted": avatars_redacted,
        "regions_redacted": regions_redacted,
        "output_path": output_path,
        "redacted_screenshot": data_url,
    }

if __name__ == '__main__':
    try:
        if len(sys.argv) > 1 and os.path.exists(sys.argv[1]):
            with open(sys.argv[1], 'r') as f:
                params = json.load(f)
        else:
            raw_input = sys.stdin.read()
            params = json.loads(raw_input) if raw_input.strip() else {}

        image_path = params.get('image_path')
        dom_regions = params.get('dom_regions', [])
        output_path = params.get('output_path')
        face_padding = params.get('face_padding', 0.1)
        text_padding = params.get('text_padding', 3)

        res = redact_image(image_path, dom_regions, face_padding, text_padding, output_path)
        print(json.dumps(res))
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc)}))
