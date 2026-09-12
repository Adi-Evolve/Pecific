# PrivacyLens — Design System & UI Specifications

This document defines the visual standards, color tokens, typography, and component patterns for the PrivacyLens Browser Extension UI, interactive dashboards, and developer test harnesses.

---

## 1. Visual Philosophy & Theme
- **Theme:** Ultra-modern dark mode with subtle glassmorphic elevation, radiant neon accents, and crisp typography.
- **Aesthetic:** Professional cybersecurity tool feel — conveys trust, cryptographic precision, and high-performance engineering.
- **Visual Feedback:** Emerald greens for privacy safety/tokens, ruby reds for detected raw secrets/leaks, and vibrant indigos for primary actions.

---

## 2. Color Palette & Design Tokens

### 2.1 Backgrounds & Surfaces
```css
:root {
  --bg-primary: #0a0e17;       /* Deepest obsidian background */
  --bg-secondary: #111827;     /* Elevated container & panel background */
  --bg-card: #1a2234;          /* Interactive card & input background */
  --bg-card-hover: #222d42;    /* Card hover state */
  --border-color: rgba(255, 255, 255, 0.08); /* Subtle glass border */
  --border-focus: rgba(99, 102, 241, 0.5);   /* Active element glow border */
}
```

### 2.2 Brand & Functional Accents
```css
:root {
  /* Primary Brand (Electric Indigo) */
  --primary: #6366f1;
  --primary-hover: #4f46e5;
  --primary-glow: rgba(99, 102, 241, 0.25);

  /* Secondary Accent (Cyan) */
  --accent: #06b6d4;
  --accent-glow: rgba(6, 182, 212, 0.25);

  /* Success & Privacy Guard (Emerald) */
  --success: #10b981;
  --success-bg: rgba(16, 185, 129, 0.15);
  --success-border: rgba(16, 185, 129, 0.35);

  /* Warning & Audit (Amber) */
  --warning: #f59e0b;
  --warning-bg: rgba(245, 158, 11, 0.15);
  --warning-border: rgba(245, 158, 11, 0.35);

  /* Danger & PII Leak Alert (Crimson) */
  --danger: #ef4444;
  --danger-bg: rgba(239, 68, 68, 0.15);
  --danger-border: rgba(239, 68, 68, 0.35);
}
```

### 2.3 Typography & Text
```css
:root {
  --text-primary: #f9fafb;     /* High-contrast headings and primary labels */
  --text-secondary: #9ca3af;   /* Body text, descriptions, secondary info */
  --text-muted: #6b7280;       /* Timestamps, disabled labels, microcopy */
  
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
}
```

---

## 3. Typography Scale & Hierarchy

| Role | Font Family | Size | Weight | Line Height | Letter Spacing |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Page Header / Title** | Inter | `1.25rem` (20px) | 700 / Bold | 1.2 | `-0.02em` |
| **Section Title / H2** | Inter | `1.05rem` (17px) | 600 / SemiBold | 1.3 | `-0.01em` |
| **Card Header / H3** | Inter | `0.95rem` (15px) | 600 / SemiBold | 1.4 | `0` |
| **Body Text** | Inter | `0.875rem` (14px) | 400 / Regular | 1.5 | `0` |
| **Micro Labels / Chips** | Inter | `0.75rem` (12px) | 600 / SemiBold | 1.4 | `+0.04em` (Caps) |
| **Code / Tokens / Vault** | JetBrains Mono | `0.80rem` (13px) | 500 / Medium | 1.45 | `0` |

---

## 4. Key UI Component Standards

### 4.1 Redacted Token Tag
Used in DOM inspectors and chat feeds to highlight sanitized sensitive values:
```css
.token-tag {
  background: var(--success-bg);
  color: #34d399;
  border: 1px solid var(--success-border);
  padding: 0.15rem 0.45rem;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}
```

### 4.2 Privacy Audit Pill Badge
Used in the header to indicate zero-leakage status:
```css
.pill-badge {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.25rem 0.65rem;
  border-radius: 9999px;
  background: var(--success-bg);
  color: var(--success);
  border: 1px solid var(--success-border);
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.pill-badge::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
```

### 4.3 Visual Blackout Rectangle Specification
Used on canvas and image processing outputs:
- **Color:** `#000000` (Solid, 100% opacity, zero alpha channel bleed).
- **Padding:** 
  - Text fields: `+4px` on all 4 borders (`top`, `bottom`, `left`, `right`) to guarantee ascenders/descenders are completely covered.
  - Faces & Avatars: `+12%` radial/box padding to encompass hairlines and profile borders.

---

## 5. Responsive Breakpoints
- **Extension Sidepanel:** Fixed width `400px` (or user-dragged 350px–500px).
- **Desktop Dashboard / Harness:**
  - `Mobile / Compact:` `< 768px` (single column vertical stack)
  - `Tablet / Medium:` `768px – 1024px` (collapsed sidepanel, side-by-side images)
  - `Wide Desktop:` `> 1024px` (two-column split screen: 50% / 50% before/after)
