# PrivacyLens (Pecific) — Project Memory Log

This running document records architectural decisions, completed work, active development items, and technical context to preserve continuity across all sessions.

---

## 1. Project Identity & Context
- **Hackathon:** Smart India Hackathon (SIH) 2024 / PS26171
- **Problem Statement:** On-device Visual Perception for Light-weight Browser Agents
- **Git Repo:** `https://github.com/Adi-Evolve/Pecific.git`
- **Active Branch:** `feat/dev3-privacy-engine`
- **Ownership Focus:** Dev 3 (R3 - Privacy Engineer), collaborating with Dev 1 (Extension Shell & Orchestration), Dev 2 (DOM Execution), Dev 4 (Vision & Client Vault), Dev 5 (Server & LLM Planner), and Dev 6 (Server VLM).

---

## 2. Current Status & Progress Summary
- **Phase 0 (Contracts):** Complete ✅. All 6 frozen schemas merged in `schemas/`.
- **Phase 1 & 2 (Extension Shell & Core Privacy):** Complete ✅.
  - Dev 1 completed MV3 `manifest.json`, `popup/`, `sidepanel/`, `service-worker.js`, Approval Dialog UI, and Pecific Light/Dark theme redesign.
  - Dev 3 completed 4-stage PII detection (`regex.js`), DOM structural invariance, server-facing `token_manifest`, and client-only in-memory vault.
- **Phase 3 (Client-Side Integration & 3-Line Privacy Helper):** Complete ✅.
  - Exposed clean `extension/workers/privacy-client.js` with 3-line helper module (`sanitizeDOMSnapshot`).
  - Integrated `extension/service-worker.js` to automatically capture active-tab snapshots, sanitize DOM, and strictly enforce fail-closed zero egress.
  - Hardened authorization on `RESOLVE_TOKEN` and `RESTORE_TEXT` requiring extension origin and session ID match.
  - Added Indian SPII detection (Voter ID, DL, EPFO UAN, Vehicle RC, Bank Account) with Bharat-series plate support and context disambiguation.
  - Achieved true diff-only incremental DOM scanning with cross-step token stability and element match caching.
- **Phase 6 (Redaction Telemetry Hook):** Complete ✅.
  - Interactive Privacy Vault Modal & Telemetry Dashboard in popup (`#modal-privacy-vault`) and live protection card in sidepanel.
  - Keyboard-accessible vault triggers (`role="button"`, `tabindex="0"`, Enter/Space handlers).
  - Truly dynamic leak count rendering reflecting real-time zero-egress verification proofs (zero hardcoded values).
- **Automated Tests:** 157/157 tests passing across 5 suites (100% pass rate).

---

## 3. Key Architectural Decisions Made

1. **DOM Invariance over Destruction:**
   - Instead of stripping nodes from the DOM, we retain 100% of element tags, IDs, CSS selectors, ARIA roles, and bounding box coordinates.
   - Text and form input `.value` attributes are replaced with typed tokens (`[EMAIL_1]`, `[PASSWORD_FIELD]`, `[CARD_1]`, `[OTP_1]`).
   - *Rationale:* The server agent needs precise CSS selectors and element coordinates to ground actions (e.g. `fill("input#username", "[EMAIL_1]")`) while remaining zero-knowledge about user secrets.

2. **Server Semantic Awareness via Manifest:**
   - Server payload contains element metadata (`is_redacted`, `redacted_types`, `redacted_tokens`) and a top-level `token_manifest` (`tokens_used`, `token_types`, `redacted_elements`).
   - *Rationale:* Server knows *what* category of data was blacked out (Email, Password, Card) without ever seeing the plaintext secret.

3. **Isolated Client Vault (In-Memory Only):**
   - The mapping of token-to-secret is stored strictly in the local browser extension's memory.
   - *Rationale:* Guarantees zero raw credential egress. Autofill is performed by resolving the token locally before dispatching DOM input events.

4. **Multi-Stage Hybrid Detection:**
   - Stage 1: Regex & checksums (Luhn for cards, Verhoeff for Aadhaar).
   - Stage 2: Contextual DOM attribute heuristics (input names, placeholders, labels).
   - Stage 3: Visual Face and Profile Avatar detection (Haar cascade + Hough circle analysis).
   - Stage 4: OCR fallback for non-DOM image pixels.

5. **Git & Fixture Policy:**
   - Exclude bulky screenshot PNGs and large test fixture dumps from remote commits. Keep testing artifacts strictly local to maintain repository hygiene.

---

## 4. Completed Work ✅

1. **Phase 0 Contract Schemas (`/schemas/`):**
   - All 6 schemas frozen: `dom_snapshot.schema.json`, `redacted_payload.schema.json`, `vision_context.schema.json`, `action.schema.json`, `vault_manifest.schema.json`, and `agent_message.schema.ts`.
2. **Privacy Engine Core (`extension/workers/`):**
   - `regex.js`: 11 PII categories with false-positive suppression. Input `.value` scanning, delivery address heuristics, personal account greetings, user names.
   - `redaction.js`: Longest-match-first replacement, page-wide token deduplication, SPII/PII/Contextual severity tiers, incremental DOM scanning (`redactIncrementalDOM`).
   - `privacy-worker.js`: Web worker orchestrating DOM scanning, metadata generation, and DOM-to-visual bounding box extraction.
3. **Automated Test Suite (109/109 Tests Passing — 100%):**
   - `regex.test.js`: 36/36 passing.
   - `redaction.test.js`: 13/13 passing.
   - `adversarial.test.js`: 15/15 passing.
   - `dom_redaction_server.test.js`: 45/45 passing.
4. **Visual Blackout & Avatar Detection (`scripts/`):**
   - `redact_image_helper.py`: OpenCV Haar cascade face detection with padding, Hough circle avatar analysis for top-right profile icons, solid black bounding boxes.
   - `vision_processor.py`: On-device screen classification and layout feature detection.
5. **Extension Shell & UI (Dev 1 Integration):**
   - `manifest.json`, `popup/`, `sidepanel/`, `service-worker.js`.
   - Pecific Light theme with Dark theme toggle and clean minimalist layout.
6. **Dev 4 | Phase 0: **
   - Defined the vision_context and vault_manifest contracts, added representative fixtures, and established the vision, vault, and tab-management integration boundaries.
7. **Dev 4 | Phases 1–2:**
   - Implemented the vision worker with BlazeFace and MobileViT screen classification, merged outputs into the vision_context format, and established the AES-256-GCM encrypted vault foundation using Web Crypto API.

---

## 5. Next Steps & Pending Roadmap 📋

1. **Phase 3 Client-Side Module Wiring:**
   - Wire `service-worker.js` to coordinate query $\to$ DOM snapshot (Dev 2) $\to$ vision analysis (Dev 4) $\to$ privacy worker (Dev 3) $\to$ sanitized payload.
2. **Phase 4 WebSocket Client Integration:**
   - Stream sanitized payload over WebSocket to FastAPI server (`/ws/browser-agent`).
3. **Phase 5 Action Rehydration & Execution:**
   - Resolve tokens locally from client vault before typing into fields, and trigger approval dialogs for high-risk actions.
