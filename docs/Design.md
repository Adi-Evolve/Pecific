# Design System

## Overview
The design should evoke a feeling of premium privacy and security. We will use a clean, modern aesthetic with a dark mode base to reduce eye strain and feel developer-centric.

## Tech
- **Styling:** Vanilla CSS (or Tailwind CSS if configured). Keep it modular and scoped.
- **Icons:** SVG icons for minimal footprint (e.g., Lucide or Heroicons).

## Color Palette (Dark Theme)
- **Background:** `#111827` (Deep Gray/Blue)
- **Surface/Card:** `#1F2937`
- **Primary Accent:** `#3B82F6` (Trust Blue)
- **Success/Safe:** `#10B981` (Green)
- **Warning/Approval:** `#F59E0B` (Amber)
- **Text Primary:** `#F9FAFB`
- **Text Secondary:** `#9CA3AF`

## Typography
- **Font Family:** Inter or system sans-serif (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`).
- **Headings:** Bold, clear hierarchy.
- **Body:** 14px base size for readability in small extension windows.

## UI Components
- **Buttons:** Rounded corners (4px - 6px), clear hover states. Primary actions should be prominent (Accent Color).
- **Inputs:** Clean borders, subtle focus rings.
- **Approval Dialog:** Must feel prominent and secure. Use Warning colors for critical approvals.

## Spacing & Layout
- **Popup Dimensions:** Max 400px width, 600px height.
- **Sidepanel Dimensions:** Standard browser sidepanel width (usually ~320px).
- **Padding/Margin:** Use an 8px grid system (8, 16, 24, 32).
