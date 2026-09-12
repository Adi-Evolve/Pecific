# PrivacyLens — Development Phases & Milestone Deliverables

This roadmap breaks the project into disciplined, ordered phases to ensure seamless multi-agent integration and complete requirements coverage for SIH PS26171.

---

## Phase 0: Contract Schemas & Interface Standardization (Complete ✅)
- **Objective:** Freeze all data exchange protocols so client and server components develop in parallel without integration drift.
- **Key Deliverables:**
  - `schemas/dom_snapshot.schema.json` (Content Script → Privacy Worker)
  - `schemas/redacted_payload.schema.json` (Privacy Worker → Server)
  - `schemas/vision_context.schema.json` (Vision Worker → Server)
  - `schemas/action.schema.json` (Server Planner → Browser Executor)
  - `schemas/vault_manifest.schema.json` (Client Vault Presence)
  - `schemas/agent_message.schema.ts` (WebSocket Message Protocol Catalog)

---

## Phase 1: Core Privacy Engine & Regex/NER Detection (Complete ✅)
- **Objective:** Build on-device PII detection and tokenization engine with zero false positives on clean e-commerce pages.
- **Key Deliverables:**
  - `extension/workers/regex.js`: Multi-type PII scanner (Email, Phone, Aadhaar, PAN, Credit Card with Luhn, UPI, DOB, IP, IFSC, Passport, Password).
  - `extension/workers/redaction.js`: Longest-match-first replacement, page-wide token deduplication, severity categorization.
  - Comprehensive unit test suite: 36 regex tests (`regex.test.js`), 13 redaction tests (`redaction.test.js`).

---

## Phase 2: Structural Invariance & Server DOM Protocol (Complete ✅)
- **Objective:** Guarantee that the sanitized DOM sent to the server maintains 100% structural fidelity while providing complete semantic awareness of blacked-out fields.
- **Key Deliverables:**
  - Element text and form `<input value="...">` token replacement.
  - Element metadata enrichment: `is_redacted`, `redacted_types`, `redacted_tokens`.
  - Top-level `token_manifest` with `tokens_used`, `token_types`, and `redacted_elements`.
  - Client-only in-memory vault isolation.
  - Server contract test suite: 45 tests (`dom_redaction_server.test.js`) verifying zero leakage and selector preservation.

---

## Phase 3: Real-World Screenshot Testing & Visual Perception (Current 🔄)
- **Objective:** Validate on-device perception against real-world complex websites (Eduplus login, Gmail OTP, Google account switcher, Amazon checkout and home).
- **Key Deliverables:**
  - Real screenshot test corpus in `fixtures/screenshots/`.
  - Pixel-perfect visual blackout of sensitive text fields and user credentials.
  - User profile image & avatar detection and blackout (Google profile 'A', Gmail avatar, browser user profile badges).
  - Biometric face blackout via OpenCV Haar cascade / BlazeFace.
  - Interactive HTML test harness (`fixtures/screenshot_test_harness.html`) for before/after visual and DOM inspection.

---

## Phase 4: Browser Extension Architecture & Action Executor (Next 🚀)
- **Objective:** Complete the Chromium MV3 browser extension with content script extraction, action execution, and sidepanel UI.
- **Key Deliverables:**
  - `extension/content/content.js`: Fast DOM snapshot extraction with viewport bounding boxes. Action executor dispatching native mouse/keyboard events.
  - `extension/background/background.js`: Service worker managing WebSocket session, coordinating privacy/vision workers, and storing local client vault.
  - `extension/ui/`: Sidepanel chat interface showing real-time agent thoughts, privacy audit badge counter, and action confirmations.

---

## Phase 5: Server Reasoning, LLM Planner & Action Loop
- **Objective:** Implement the FastAPI WebSocket server and Chain-of-Thought (CoT) LLM planner using sanitized DOM and screen context.
- **Key Deliverables:**
  - `server/app.py`: Real-time WebSocket server dispatching `USER_QUERY`, `STEP_RESULT`, `AGENT_ACTION`.
  - `server/planner.py`: LLM agent (Llama 3 / Mistral via Ollama) generating structured actions targeting CSS selectors.
  - `server/vlm.py`: Secondary visual grounding fallback using Qwen2.5-VL-7B when DOM selectors are dynamic or obscured.

---

## Phase 6: End-to-End Integration, Evaluation & Demo Scenarios
- **Objective:** Demonstrate end-to-end autonomous execution on the 3 SIH evaluation benchmarks.
- **Benchmark 1 (Recruitment Application):** Navigate Eduplus/Job portal, auto-fill profile using tokens, protect student email & password.
- **Benchmark 2 (E-Commerce Purchase):** Navigate Amazon/Flipkart, add item to cart, proceed to checkout, blackout shipping address & card number.
- **Benchmark 3 (OTP & Verification):** Detect verification code in Gmail/SMS screen, tokenize as `[OTP_1]`, resolve locally in browser to complete login.
