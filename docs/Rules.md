# PrivacyLens — AI Guardrails & Engineering Rules

## 1. Core Principles & Philosophy
1. **Absolute Privacy First:** Under NO circumstances may raw credentials, personal passwords, unmasked credit cards, or biometric/facial imagery leave the client browser.
2. **Structural Invariance:** DOM sanitation must NEVER break or alter DOM structure, hierarchy, tag names, unique IDs, CSS selectors, or bounding box coordinates.
3. **No Unapproved Git Pushes:** NEVER run `git push` or publish testing results/raw fixtures to remote repositories unless the user explicitly commands it.
4. **Deterministic & Lightweight:** Prefer lightweight, browser-native APIs and Web Workers over heavy external libraries.

---

## 2. Technology & Library Guidelines

### Libraries to Use:
- **Client Frontend:** Vanilla JavaScript (ES2022+), Modern Vanilla CSS (CSS variables, flexbox/grid, glassmorphism), Web Workers API.
- **Client Vision/Inference:** ONNX Runtime Web (`ort.js`), WebGPU, Canvas 2D / OffscreenCanvas API.
- **Python Tooling:** Python 3.10+, OpenCV (`cv2`), NumPy, FastAPI, WebSockets.
- **Schemas:** JSON Schema Draft-07, TypeScript type definitions.

### Libraries & Anti-Patterns to AVOID:
- ❌ **Do NOT use React, Vue, or Angular for the extension UI:** Keep the extension bundle ultra-lightweight and fast without virtual DOM overhead.
- ❌ **Do NOT use heavy Redux or MobX state managers:** Use simple reactive state stores or pub-sub within the extension service worker.
- ❌ **Do NOT use Tailwind CSS unless explicitly requested:** Use Vanilla CSS with design tokens defined in `Design.md`.
- ❌ **Do NOT introduce external tracking, telemetry, or analytics SDKs:** All audit logs remain strictly local to user storage.
- ❌ **Do NOT perform full-page OCR on every frame:** OCR is strictly a secondary fallback for canvas elements or non-DOM imagery.

---

## 3. Coding & Architectural Standards

### 3.1 Privacy Engine Standards
- **Token Format:** All redacted values must follow the standardized token convention: `[TYPE_INDEX]` (e.g., `[EMAIL_1]`, `[CARD_1]`, `[OTP_1]`, `[PASSWORD_FIELD]`).
- **Luhn Validation:** Every detected 16-digit sequence claiming to be a credit card MUST pass the Luhn algorithm before tokenization to avoid corrupting arbitrary numbers.
- **Input Value Masking:** Always sanitize both element visible text AND input `.value` attributes (`input.value = "[EMAIL_1]"`).
- **Password Masking:** Any `<input type="password">` must have its value and text masked as `[PASSWORD_FIELD]`.

### 3.2 Error Handling & Resilience
- **Fail-Safe Privacy:** If an element match is ambiguous or classification fails, default to redacting/masking rather than leaking.
- **Graceful Fallbacks:** If WebGPU is unavailable on a client machine, the vision worker must fall back to CPU WASM without throwing fatal runtime errors.
- **Async Safety:** All worker message dispatches must be wrapped in `try-catch` blocks and reject with structured error objects `{ success: false, error: message }`.

### 3.3 Git & Branching Rules
- **Testing & Intermediate Results:** Keep test runs, generated screenshots, and payload logs local to the working tree.
- **Branch Strategy:** Work on role-specific feature branches (`feat/dev3-privacy-engine`, etc.).
- **Push Policy:** DO NOT push to remote origin without user authorization.

---

## 4. Prohibited Actions (What the AI Should NOT Do)
- 🚫 Never commit `.env` files, API keys, or raw personal credentials.
- 🚫 Never modify frozen schemas in `/schemas/` without cross-role alignment.
- 🚫 Never touch files owned by other roles without following the interface contract in `COMMUNICATION_SPEC.md`.
- 🚫 Never use random, non-deterministic bounding boxes for redaction — all coordinates must map directly to DOM elements or visual detector bounds.
