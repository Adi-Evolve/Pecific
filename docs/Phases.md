# Pecific — Development Phases & Milestone Deliverables

This document tracks the phased implementation across the project lifecycle, unifying the overarching architecture with Dev 1 (Extension Shell) and Dev 3 (Privacy Engine) deliverables.

---

## Phase 0: Kickoff, Contract Schemas & Interface Standardization (Complete ✅)
- **Objective:** Agree on schemas, message protocols, and folder ownership so client and server develop in parallel without blocking.
- **Deliverables:**
  - `schemas/dom_snapshot.schema.json` (Dev 2 → Dev 3)
  - `schemas/redacted_payload.schema.json` (Dev 3 → Dev 5)
  - `schemas/vision_context.schema.json` (Dev 4 → Dev 5)
  - `schemas/action.schema.json` (Dev 5 → Dev 2)
  - `schemas/vault_manifest.schema.json` (Dev 3/4 Client Vault presence)
  - `schemas/agent_message.schema.ts` (WebSocket Protocol Catalog)

---

## Phase 1: Foundation & Core Privacy Engine (Complete ✅)
- **Dev 1 (Shell):**
  - MV3 `manifest.json` with permissions (`activeTab`, `scripting`, `sidePanel`, etc.).
  - `popup/` and `sidepanel/` HTML shells.
  - `service-worker.js` message router skeleton.
- **Dev 3 (Privacy):**
  - `extension/workers/regex.js`: 11-category PII scanner (Email, Phone, Aadhaar, PAN, Luhn Credit Cards, UPI, DOB, IP, IFSC, Passwords).
  - `extension/workers/redaction.js`: Longest-match-first replacement, page-wide token deduplication, severity categorization.
  - 36 regex tests (`regex.test.js`) + 13 redaction tests (`redaction.test.js`).

---

## Phase 2: Core Engine Build & DOM Structural Invariance (Complete ✅)
- **Dev 1 (Shell):**
  - Wire popup to service worker message passing.
  - Create Approval Dialog UI component (visual only).
  - Notification permissions setup.
  - **Pecific UI Redesign:** Clean minimalist light theme base with dark mode toggle.
- **Dev 3 (Privacy):**
  - Input value masking (`<input value="...">`) and text node sanitization.
  - Server-facing `token_manifest` (`tokens_used`, `token_types`, `redacted_elements`).
  - Isolated client-only in-memory vault.
  - 45 server contract tests (`dom_redaction_server.test.js`) + 15 adversarial tests (`adversarial.test.js`) — 109/109 tests passing.

---

## Phase 3: Client-Side Integration & Visual Redaction (In Progress 🔄)
- **Objective:** Wire service worker to coordinate modules: query $\to$ DOM snapshot (Dev 2) $\to$ vision analysis (Dev 4) $\to$ privacy worker (Dev 3) $\to$ sanitized payload.
- **Dev 3 / Privacy Deliverables (Completed ✅):**
  - Integrated Dev 1 extension shell with Dev 3 privacy engine via `extension/workers/privacy-client.js`.
  - Exposed 3-line asynchronous helper module (`sanitizeDOMSnapshot`) for Dev 1.
  - Live zero-egress verification engine proving 0 raw secrets leave the user's browser.
  - Indian SPII expansion for SIH PS26171.
  - Real screenshot testing across complex websites.
  - Pixel-perfect visual blackout of sensitive text, account greetings, and PIN codes.
- **Dev 1 / Orchestration Deliverables (In Progress 🔄):**
  - Replace service-worker DOM extraction stub with `chrome.tabs.sendMessage` to Dev 2's `content-script.js`.
  - Initialize Dev 4's `vision-worker.js` to process screenshots for face bounding boxes.
  - Pass the extracted DOM and vision bounding boxes to Dev 3's `sanitizeDOMSnapshot`.

---

## Phase 4: Client $\leftrightarrow$ Server Integration (Completed ✅)
- **Objective:** Full round-trip integration over WebSocket.
- **Dev 1 Deliverables (Completed ✅):** Connected extension background script (`service-worker.js`) to FastAPI WebSocket server, added `wasm-unsafe-eval` CSP to manifest, streamed sanitized DOM payload, and set up routing for structured plan responses (`NEXT_STEP`, `PLAN`, etc.).

---

## Phase 5: Full Agentic Loop & Approval Dialog (Completed ✅)
- **Objective:** End-to-end autonomous action with human-in-the-loop controls.
- **Dev 1 Deliverables (Completed ✅):** Wire the interactive approval dialog (UI) to real `APPROVAL_REQUIRED` WebSocket events. When approved, allow execution of native DOM actions (click, fill) by locally resolving vault tokens via Dev 2's action executor.

---

## Phase 6: Advanced Features & UX Polish (Completed ✅)
- **Deliverables:**
  - Redaction Telemetry Hook & Privacy Vault Modal in extension popup and sidepanel (Completed ✅).
  - Screenshot timeline UI, undo/rollback controls, progress bar + ETA, keyboard shortcuts (Completed ✅).

---

## Phase 7: Hardening & Demo Evaluation Benchmarks
- **Objective:** Demonstrate end-to-end autonomous execution on the 3 SIH evaluation benchmarks.
- **Benchmark 1 (Recruitment Application):** Navigate Eduplus/Job portal, auto-fill profile using tokens, protect student email & password.
- **Benchmark 2 (E-Commerce Purchase):** Navigate Amazon/Flipkart, add item to cart, proceed to checkout, blackout shipping address & card number.
- **Benchmark 3 (OTP & Verification):** Detect verification code in Gmail/SMS screen, tokenize as `[OTP_1]`, resolve locally in browser to complete login.
