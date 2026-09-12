# PrivacyLens (Pecific) — Development Phases & Milestone Deliverables

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
- **Dev 3 / Privacy Deliverables:**
  - Real screenshot testing across complex websites (Google Classroom, Eduplus Login, Gmail OTP, Amazon Deals, AWS Profile).
  - Pixel-perfect visual blackout of sensitive text, account greetings, and PIN codes.
  - Profile avatar detection (Hough circle analysis) and face detection (Haar cascade).
  - On-device vision processor helper (`scripts/vision_processor.py`).

---

## Phase 4: Client $\leftrightarrow$ Server Integration
- **Objective:** Full round-trip integration over WebSocket.
- **Deliverables:** Connect extension background script to FastAPI WebSocket server, stream sanitized DOM payload, and receive structured plan responses.

---

## Phase 5: Full Agentic Loop & Approval Dialog
- **Objective:** End-to-end autonomous action with human-in-the-loop controls.
- **Deliverables:** Wire the interactive approval dialog to real checkout/login events; execute native DOM actions (click, fill) resolving vault tokens locally.

---

## Phase 6: Advanced Features & UX Polish
- **Deliverables:** Screenshot timeline UI, undo/rollback controls, progress bar + ETA, keyboard shortcuts.

---

## Phase 7: Hardening & Demo Evaluation Benchmarks
- **Objective:** Demonstrate end-to-end autonomous execution on the 3 SIH evaluation benchmarks.
- **Benchmark 1 (Recruitment Application):** Navigate Eduplus/Job portal, auto-fill profile using tokens, protect student email & password.
- **Benchmark 2 (E-Commerce Purchase):** Navigate Amazon/Flipkart, add item to cart, proceed to checkout, blackout shipping address & card number.
- **Benchmark 3 (OTP & Verification):** Detect verification code in Gmail/SMS screen, tokenize as `[OTP_1]`, resolve locally in browser to complete login.
