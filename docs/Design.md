# PrivacyLens (Pecific) — Design System & UI Specifications

This document defines the visual standards, color tokens, typography, and component patterns for the Pecific Browser Extension UI, interactive sidepanels, and developer verification tools.

---

## 1. Visual Philosophy & Overview
The design evokes a feeling of simple, premium, and unobtrusive utility. We use a clean, modern aesthetic with a **Light Theme base** to reduce visual clutter (drawing inspiration from minimalist interfaces like Claude and ChatGPT), alongside a **Dark Theme** for privacy-first developer inspection and high-contrast environments.

- **Styling:** Vanilla CSS. Modular, scoped, zero external CSS framework overhead.
- **Icons:** Lightweight SVG line icons (minimal footprint, high-contrast lines).

---

## 2. Color Palette & Design Tokens

### 2.1 Light Theme (Default Extension UI)
- **Background Main:** `#FFFFFF` (Pure white for main interactive surface)
- **Background Surface:** `#F9FAFB` (Subtle off-white for cards, headers, borders)
- **Primary Accent:** `#000000` (Pitch black for primary CTA to ensure highest contrast)
- **Secondary Accent:** `#374151` (Dark gray for hover states)
- **Success / Privacy Guard:** `#10B981` (Green for active task dots & sanitized tokens)
- **Text Primary:** `#111827` (Near black for high readability)
- **Text Secondary / Muted:** `#6B7280` (Medium gray for secondary info)
- **Borders:** `#E5E7EB` (Subtle light gray to delineate sections without heavy boxing)

### 2.2 Dark Theme (Developer Harness & Dark Mode Toggle)
```css
:root[data-theme="dark"] {
  --bg-primary: #0a0e17;       /* Deepest obsidian background */
  --bg-secondary: #111827;     /* Elevated container & panel background */
  --bg-card: #1a2234;          /* Interactive card & input background */
  --bg-card-hover: #222d42;    /* Card hover state */
  --border-color: rgba(255, 255, 255, 0.08); /* Subtle glass border */
  --border-focus: rgba(99, 102, 241, 0.5);   /* Active element glow border */

  /* Functional Accents */
  --primary: #6366f1;
  --primary-hover: #4f46e5;
  --accent: #06b6d4;
  --success: #10b981;
  --success-bg: rgba(16, 185, 129, 0.15);
  --success-border: rgba(16, 185, 129, 0.35);
  --warning: #f59e0b;
  --danger: #ef4444;

  /* Typography */
  --text-primary: #f9fafb;
  --text-secondary: #9ca3af;
  --text-muted: #6b7280;
}
```

---

## 3. Typography & Sizing Scale

- **Font Family (Body & UI):** Modern system font stack (`ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`).
- **Font Family (Code & Tokens):** JetBrains Mono, Fira Code, monospace.
- **Headings:** Bold (600/700), clean hierarchy.
- **Body Text:** `13px` - `14px` base size for comfortable readability in small extension windows.
- **Micro Labels & Chips:** `11px` - `12px`, semi-bold, uppercase tracking.

---

## 4. UI Components & Patterns

### 4.1 Buttons & Inputs
- **Primary Button:** Rounded corners (`8px`), solid dark color, no heavy gradients.
- **Secondary Button:** Hollow, subtle border (`#E5E7EB`), hover elevation.
- **Inputs:** Clean borders, subtle focus rings (box-shadows instead of bright harsh outlines).

### 4.2 Redacted Token Tag
Used in DOM inspectors and chat feeds to highlight sanitized sensitive values:
```css
.token-tag {
  background: rgba(16, 185, 129, 0.12);
  color: #059669;
  border: 1px solid rgba(16, 185, 129, 0.3);
  padding: 0.15rem 0.45rem;
  border-radius: 4px;
  font-family: monospace;
  font-size: 0.8rem;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}
```

### 4.3 Visual Blackout Rectangle Specification
Used on canvas and image processing outputs:
- **Color:** `#000000` (Solid black, 100% opacity, zero alpha channel bleed).
- **Text Padding:** `+4px` on all 4 borders (`top`, `bottom`, `left`, `right`) to guarantee full coverage of ascenders/descenders.
- **Faces & Avatars:** `+12%` radial/box padding to encompass profile borders and hairlines.

### 4.4 Execution Plan & Timeline
- Vertical timeline with simple connector lines and status dots.
- Active step indicated by a pulsing green status dot (`#10B981`).

---

## 5. Dimensions & Spacing
- **Extension Popup:** Max `400px` width, `480px` height.
- **Extension Sidepanel:** Standard browser sidepanel width (`320px` to `420px`).
- **Padding / Margins:** Generous whitespace (`16px` to `24px`) to ensure clean scannability.
