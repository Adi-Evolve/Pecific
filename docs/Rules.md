# AI Guardrails & Rules

## Collaboration & Module Ownership
- **Strict Boundaries:** Dev 1 owns ONLY `extension/manifest.json`, `extension/popup/*`, `extension/sidepanel/*`, and `extension/service-worker.js`. Do not modify other team members' files (e.g., `content/*`, `workers/*`, `server/*`).
- **Contracts First:** Never assume the shape of data between client and server. Always adhere to the JSON schemas defined in the `schemas/` directory.

## Coding Style & Guidelines
- **Extension UI:** Use Vanilla CSS (or Tailwind if configured later) for the popup and sidepanel. Keep styling lightweight and clean.
- **JavaScript/TypeScript:** Use modern ES6+ features. Ensure asynchronous operations (like Chrome API calls) are handled correctly with async/await.
- **Error Handling:** Gracefully handle errors and provide fallback UI states. For background scripts, log errors clearly and notify the user via UI if an operation fails.
- **Security:** Do not use `eval()` or dangerous DOM manipulation. Adhere to MV3 security constraints (no remote code execution).
- **Naming Conventions:** Use camelCase for variables/functions, PascalCase for classes.

## What NOT to do
- Do not introduce large, unnecessary libraries like React or Redux unless explicitly approved.
- Do not modify frozen schemas in `schemas/` without cross-team coordination.
- Do not store unredacted PII anywhere in the extension state or logs.
