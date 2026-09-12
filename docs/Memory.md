# PrivacyLens — Project Memory Log

This running document records architectural decisions, completed work, active development items, and technical context to preserve continuity across all sessions.

---

## 1. Project Identity & Context
- **Hackathon:** Smart India Hackathon (SIH) 2024 / PS26171
- **Problem Statement:** On-device Visual Perception for Light-weight Browser Agents
- **Git Repo:** `https://github.com/Adi-Evolve/Pecific.git`
- **Active Branch:** `feat/dev3-privacy-engine`
- **Primary Role Focus:** Dev 3 (R3 - Privacy Engineer), owning privacy workers, PII scanners, redaction pipelines, contract schemas, and screenshot redaction testing.

---

## 2. Key Architectural Decisions Made

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
   - Stage 3: Visual Face and Profile Avatar detection (Haar cascade + circle/contour analysis).
   - Stage 4: OCR fallback for non-DOM image pixels.

5. **Git Policy:**
   - Local-only execution for testing results, generated screenshots, and payloads. No `git push` without user's explicit instruction.

---

## 3. What Has Been Completed ✅

1. **Phase 0 Contract Schemas (`/schemas/`):**
   - All 6 schemas frozen: `dom_snapshot.schema.json`, `redacted_payload.schema.json`, `vision_context.schema.json`, `action.schema.json`, `vault_manifest.schema.json`, and `agent_message.schema.ts`.
2. **Privacy Engine Core (`extension/workers/`):**
   - `regex.js`: 11 PII categories with false-positive suppression (Order IDs, SKUs, hex colors, prices). Input `.value` scanning, delivery address heuristics, personal account greetings (`Hello, <Name>`).
   - `redaction.js`: Longest-match-first replacement, page-wide token deduplication, SPII/PII/Contextual severity tiers, incremental DOM scanning (`redactIncrementalDOM`).
   - `privacy-worker.js`: Web worker orchestrating DOM scanning, metadata generation, and DOM-to-visual bounding box extraction.
3. **Automated Test Suite (109/109 Tests Passing — 100%):**
   - `regex.test.js`: 36/36 passing.
   - `redaction.test.js`: 13/13 passing.
   - `adversarial.test.js`: 15/15 passing.
   - `dom_redaction_server.test.js`: 45/45 passing.
4. **Real Screenshot Fixtures & Pipeline:**
   - Processed 5 real screenshots from user + 2 synthetic benchmarks:
     - `Screenshot 2026-09-12 175109.png` (Eduplus jobs login)
     - `Screenshot 2026-09-12 175018.png` (Google account switcher)
     - `Screenshot 2026-09-12 175123.png` (Gmail OTP verification)
     - `Screenshot 2026-09-12 175513.png` (Amazon India home)
     - `Screenshot 2026-09-12 175632.png` (Amazon checkout modal)
     - `checkout_payment.png` & `user_profile.png`
   - Generated server payloads and client vaults in `fixtures/screenshots/redacted/`.
5. **Interactive Test Harness:**
   - `fixtures/screenshot_test_harness.html` with preset scenarios, before/after slider, DOM structural diff, and server payload inspector.

---

## 4. Completed in Latest Iteration ✅

- **Visual Blackout Pixel Alignment (100% Fixed):**
  - Measured exact pixel coordinates across all 5 user screenshots using OpenCV edge/contour analysis.
  - `Screenshot 2026-09-12 175109.png` (Eduplus jobs login): Username input at `[1056, 391, 769, 57]` and Password input at `[1056, 509, 769, 57]` are 100% cleanly blacked out. Shifted black strips eliminated.
  - `Screenshot 2026-09-12 175632.png` (Amazon checkout modal): Card number input at `[621, 481, 244, 107]`, Nickname at `[621, 535, 244, 50]`, and full shipping address at `[36, 201, 764, 119]` (covering "Delivering to Adi Inamdar Flat no. 14... MAHARASHTRA, 411002") are 100% blacked out.
  - `Screenshot 2026-09-12 175123.png` (Gmail OTP verification): OTP code box at `[1001, 586, 214, 64]` covering `214489` centered and blacked out.
  - `Screenshot 2026-09-12 175513.png` (Amazon delivery): "Deliver to Adi Pune 411002" at `[176, 61, 164, 57]` and greeting at `[1516, 61, 174, 57]` blacked out.
- **User Profile Image & Avatar Redaction Added:**
  - Added profile avatar detection heuristic (`detect_user_avatars`) and `AVATAR` token classification (`[AVATAR_1]`) in both DOM scanner (`extension/workers/regex.js`, `extension/workers/redaction.js`) and visual helper (`scripts/redact_image_helper.py`).
  - Successfully blacks out user profile icons in Google Account switcher (`[1850, 120, 55, 55]`), Gmail navbar photo (`[1848, 10, 58, 58]`), and browser profile toolbar badges (`[1750, 58, 42, 42]`).
- **3 New Real Screenshots Tested & Redacted (10 Total Scenarios):**
  - Added and processed:
    1. `Screenshot 2026-09-12 184808.png` (Google Classroom):
       - 15 DOM elements mapped.
       - 7 tokens masked across 13 fields (`[AVATAR_1]`, `[NAME_1]` to `[NAME_6]`).
       - Successfully blacked out all 8 class instructor names, 3 teacher face photos, top-right Google account avatar 'A', and browser profile badge. Zero spillover into class titles ("BoGD 26-27", "TY_A2_Batch_BG", etc.).
    2. `Screenshot 2026-09-12 184852.png` (Amazon Deals):
       - 6 DOM elements mapped.
       - 3 tokens masked across 3 fields (`[AVATAR_1]`, `[ADDRESS_1]`, `[NAME_1]`).
       - Successfully blacked out "Deliver to Adi Pune 411002" at `[180, 126, 150, 45]` (covering pin icon, name, and 6-digit postal pincode), "Hello, Adi Account & Lists" greeting at `[1350, 126, 160, 42]`, and browser profile avatar.
       - Non-PII deal items (Tecno POP X 5G ₹17,999, ASUS Vivobook 15 ₹68,990) and search box remain completely untouched.
    3. `Screenshot 2026-09-12 185303.png` (AWS Skill Builder Profile):
       - 6 DOM elements mapped.
       - 4 tokens masked across 4 fields (`[AVATAR_1]`, `[NAME_1]`, `[NAME_2]`, `[EMAIL_1]`).
       - First name "Adi", Last name "Inamdar", and institutional email "adi.inamdar24@vit.edu" are cleanly blacked out. Email type ("Personal") and organization name ("Vishwakarma Institute of Technology") remain intact.
- **CodeRabbit / Linter Issues Resolved:**
  - `fixtures/screenshot_test_harness.html`:
    - Added standard `background-clip: text;` property on line 95 to accompany `-webkit-background-clip: text;` (clearing IDE/CodeRabbit compatibility warning).
    - Fixed duplicated identifier syntax error `let currentScenariolet currentScenario` -> `let currentScenario`.
    - Integrated all 10 scenarios into `SCENARIOS` catalog in `fixtures/screenshot_test_harness.html`.
- **Automated Tests:**
  - 109/109 tests passing (100% pass rate).
- **Git Policy Maintained:**
  - All fixtures, scripts, and redacted outputs kept strictly local. Zero remote pushes performed.

---

## 5. Next Steps & Pending Roadmap 📋

1. **Phase 2 WebSocket Client Protocol:**
   - Integrate WebSocket connection in extension background script to stream sanitized DOM payloads to FastAPI backend (`/ws/browser-agent`).
2. **Phase 3 Local Action Rehydration:**
   - Handle server action execution messages (e.g. `{"action": "type", "selector": "input#username", "value": "[EMAIL_1]"}`) and resolve tokens locally from client vault before executing native events.
3. **Branch & Git Strategy:**
   - Keep all screenshot fixtures and test outputs local. Await user instruction before staging and committing specific files to git.


