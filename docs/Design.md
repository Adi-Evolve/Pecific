# Design System (Minimalist Pecific)

## Overview
The design evokes a feeling of simple, premium, and unobtrusive utility. We use a clean, modern aesthetic with a Light Mode base to reduce visual clutter, drawing inspiration from minimalist interfaces like Claude and ChatGPT.

## Tech
- **Styling:** Vanilla CSS. Keep it modular and scoped.
- **Icons:** SVG icons for minimal footprint (e.g., Lucide or Heroicons), rendered simply in high-contrast lines.

## Color Palette (Light Theme)
- **Background Main:** `#FFFFFF` (Pure white for main areas)
- **Background Surface:** `#F9FAFB` (Subtle off-white for cards, headers, borders)
- **Primary Accent:** `#000000` (Pitch black for primary CTA to ensure highest contrast)
- **Secondary Accent:** `#374151` (Dark gray for hover states)
- **Success/Safe:** `#10B981` (Green for active task dots)
- **Text Primary:** `#111827` (Near black for readability)
- **Text Secondary/Muted:** `#6B7280` (Medium gray for secondary info)
- **Borders:** `#E5E7EB` (Subtle light gray to delineate sections without boxing them in heavily)

## Typography
- **Font Family:** Modern system stack (`ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`).
- **Headings:** Bold (600), clean hierarchy.
- **Body:** 13px - 14px base size for clean readability in small extension windows.

## UI Components
- **Buttons:** 
  - Primary: Rounded corners (8px), solid dark color, no gradients.
  - Secondary: Hollow, subtle borders, match background surface on hover.
- **Inputs:** Clean borders, subtle focus rings (shadows instead of bright outlines).
- **Execution Plan:** Avoid heavy backgrounds. Use a vertical timeline with simple connector lines and status dots (e.g., a pulsing green dot for the active step).

## Spacing & Layout
- **Popup Dimensions:** Max 400px width, 480px height.
- **Sidepanel Dimensions:** Standard browser sidepanel width (usually ~320px).
- **Padding/Margin:** Use generous whitespace (16px - 24px) to let elements breathe.
