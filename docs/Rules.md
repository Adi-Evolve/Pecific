# Pecific — AI Guardrails & Engineering Rules

## 1. Collaboration & Module Ownership
To avoid merge conflicts and cross-person blocking across the 6-person team:
- **Dev 1 (Extension Shell & Orchestrator):** Owns `extension/manifest.json`, `extension/popup/*`, `extension/sidepanel/*`, and `extension/service-worker.js`.
- **Dev 2 (DOM & Execution):** Owns `extension/content/*`.
- **Dev 3 (Privacy Engine):** Owns `extension/workers/privacy-worker.js`, `regex.js`, `ner.js`, `ocr.js`, `redaction.js`, and `extension/workers/__tests__/*`.
- **Dev 4 (Vision & Vault Client):** Owns `extension/workers/vision-worker.js` and client vault storage.
- **Dev 5 (Server & LLM Planner):** Owns `server/app.py`, `server/planner.py`, and core backend orchestration.
- **Dev 6 (Server VLM & Grounding):** Owns `server/vision/*` and VLM grounding.
- **Strict Boundary Rule:** Do NOT modify files owned by other team members without adhering to the interface contracts in `COMMUNICATION_SPEC.md`.
- **Contracts First:** Never assume the shape of data between client and server. Always adhere to the JSON schemas defined in the `schemas/` directory. Never edit frozen schemas without cross-role alignment.

---

## 2. Privacy & Security Rules (Zero-Tolerance)
1. **Absolute Privacy First:** Under NO circumstances may raw credentials, personal passwords, unmasked credit cards, or biometric/facial imagery leave the client browser.
2. **Structural Invariance:** DOM sanitation must NEVER break or alter DOM structure, hierarchy, tag names, unique IDs, CSS selectors, or bounding box coordinates.
3. **No Unapproved Git Pushes:** NEVER run `git push` or publish testing results/raw fixtures to remote repositories unless the user explicitly commands it.
4. **Token Convention:** All redacted values must follow the standardized token convention: `[TYPE_INDEX]` (e.g., `[EMAIL_1]`, `[CARD_1]`, `[OTP_1]`, `[PASSWORD_FIELD]`).
5. **Luhn Validation:** Every detected 16-digit sequence claiming to be a credit card MUST pass the Luhn algorithm before tokenization to avoid corrupting arbitrary product numbers.
6. **Input Value Masking:** Always sanitize both element visible text AND input `.value` attributes (`input.value = "[EMAIL_1]"`).
7. **Password Masking:** Any `<input type="password">` must have its value and text masked as `[PASSWORD_FIELD]`.
8. **No Remote Code Execution:** Adhere strictly to Chrome MV3 security constraints (no `eval()`, no external script injection).

---

## 3. Technology & Library Guidelines
- **Client Frontend:** Vanilla JavaScript (ES2022+), Modern Vanilla CSS (Pecific Design System), Web Workers API.
- **Client Vision/Inference:** ONNX Runtime Web (`ort.js`), WebGPU, Canvas 2D / OffscreenCanvas API.
- **Python Tooling:** Python 3.10+, OpenCV (`cv2`), NumPy, FastAPI, WebSockets.
- **Schemas:** JSON Schema Draft-07, TypeScript type definitions.

### Anti-Patterns to AVOID:
- ❌ **Do NOT use React, Vue, or Angular for the extension UI:** Keep the extension bundle ultra-lightweight and fast without virtual DOM overhead.
- ❌ **Do NOT use heavy Redux or MobX state managers:** Use simple reactive state stores or pub-sub within the extension service worker.
- ❌ **Do NOT use Tailwind CSS unless explicitly requested:** Use Vanilla CSS with design tokens defined in `Design.md`.
- ❌ **Do NOT introduce external tracking, telemetry, or analytics SDKs:** All audit logs remain strictly local to user storage.
- ❌ **Do NOT perform full-page OCR on every frame:** OCR is strictly a secondary fallback for canvas elements or non-DOM imagery.

---

## 4. Coding Style & Guidelines
- **Naming Conventions:** Use camelCase for variables/functions, PascalCase for classes/interfaces, and UPPER_SNAKE_CASE for constants.
- **Async Safety:** Ensure asynchronous operations (like Chrome API calls) are handled correctly with async/await. All worker message dispatches must be wrapped in `try-catch` blocks and return structured error objects `{ success: false, error: message }`.
- **Fail-Safe Privacy:** If an element match is ambiguous or classification fails, default to redacting/masking rather than leaking.
- **Graceful Fallbacks:** If WebGPU is unavailable on a client machine, the vision worker must fall back to CPU WASM without throwing fatal runtime errors.
- **Testing & Fixtures:** Keep test runs, generated screenshots, and payload logs local. Do not commit heavy screenshots or fixture dumps to the remote repository.
