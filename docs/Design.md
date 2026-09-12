# Design System

## Design Direction

The interface should feel like a calm control surface for a powerful but supervised agent: high information density, strong status hierarchy, and visible privacy boundaries. It should feel technical and trustworthy without looking like a generic dark dashboard.

## Color Palette

Use CSS variables so the extension has one visual vocabulary.

```css
:root {
  --ink: #17212b;
  --ink-muted: #5f6b76;
  --paper: #f6f8f5;
  --surface: #ffffff;
  --line: #d8dfda;
  --teal: #087f8c;
  --teal-soft: #d9f0ef;
  --amber: #b86b00;
  --amber-soft: #fff0d2;
  --red: #b23a48;
  --red-soft: #f9dfe2;
  --blue: #285da8;
  --focus: #1c8d8a;
}
```

- Use `--ink` for primary text and `--paper` for the page background.
- Use teal for active progress and trusted local processing.
- Use amber for caution and approval-required states.
- Use red only for blocked, failed, or dangerous actions.
- Use blue for links and secondary information.
- Maintain WCAG AA contrast for text and controls.

## Theme

The default is a light, high-contrast theme. A dark theme may be added only after the light theme is complete and must preserve the same semantic colors and contrast ratios. Avoid purple-dominant gradients and decorative visual noise.

## Typography

- Primary UI font: `Atkinson Hyperlegible`, with a system sans fallback.
- Monospace/status font: `IBM Plex Mono`, with a monospace fallback.
- Body size: 14px with 1.45 line height.
- Small metadata: 12px with clear contrast.
- Section headings: 16px, semibold.
- Task title: 20px maximum in compact extension surfaces.
- Do not use oversized marketing typography in popup or side-panel surfaces.

## Components

- **Task composer:** one clear multiline input, compact submit icon button, and recent task affordance.
- **Status strip:** current phase, agent tab, connection state, and elapsed time.
- **Step row:** numbered step, action description, state icon, and optional verification detail.
- **Approval panel:** high-contrast amber treatment, exact action summary, target, data category, and explicit approve/cancel buttons.
- **Privacy badge:** shows local scan status and whether the outgoing payload is sanitized; never displays raw detected values.
- **Error state:** concise explanation, recovery action, and safe diagnostic code.
- **Timeline:** compact chronological events with expandable sanitized details.
- **Buttons:** use familiar icons for compact actions and icon-plus-text for consequential commands. Tooltips must explain unfamiliar icons.
- **Cards:** use only for repeated steps, approval surfaces, and genuinely framed tools; do not nest cards.

## Spacing And Shape

- Base spacing unit: 4px.
- Common spacing: 8px, 12px, 16px, 24px.
- Control height: 36px minimum; icon-only controls: 32px square minimum.
- Border radius: 6px for controls and 8px maximum for panels.
- Borders should separate content without making every section look like a floating card.
- Keep stable dimensions for status rows, buttons, and step indicators so state changes do not shift the layout.

## Responsive Breakpoints

- Compact popup: up to 399px wide; single-column layout and abbreviated metadata.
- Standard side panel: 400px to 719px; two-region status and task layout where useful.
- Wide side panel: 720px and above; allow timeline details beside the active task.
- At every width, critical approval controls remain visible without horizontal scrolling.

## Motion And Feedback

- Use a short page-load reveal for the active task.
- Use a restrained progress transition when a step changes state.
- Use a clear, non-animated blocked state for safety failures.
- Respect `prefers-reduced-motion`.
- Never use motion to disguise a delayed or uncertain model response.

## Content Rules

- Prefer concrete labels: `Sanitized`, `Waiting for approval`, `Executing`, `Verified`, `Blocked`.
- State what the agent will do before asking for approval.
- Do not expose raw PII in status text, logs, screenshots, or error messages.
- Keep the privacy state visible throughout a task, not only on a settings screen.
