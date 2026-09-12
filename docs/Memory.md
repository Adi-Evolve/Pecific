# Project Memory Log

This file is the compact working memory for future implementation sessions. Update it when a meaningful feature, decision, or blocker changes.

## Current Baseline

- Repository: iSIH privacy-preserving vision browser agent.
- Product shape: browser extension plus Python backend.
- Initial browser architecture: Chrome Manifest V3 with a service worker, content scripts, workers, popup, side panel, vault, and tab manager.
- Backend architecture: FastAPI routes/WebSocket handling, planning and protocol modules, model loaders, session/task state, and visual verification.
- Shared contracts currently present under `schemas/`: DOM snapshot, vision context, redacted payload, agent messages, actions, and vault manifest.
- Client fixtures exist under `extension/fixtures/` for vault manifests and vision contexts.
- ONNX Runtime Web assets are present under `extension/lib/ort/`.
- The top-level build plan defines seven phases from contracts through demo hardening.

## Completed Or Established

- Product README exists and describes the privacy boundary, target models, major features, and repository layout.
- Detailed architecture/build-plan material exists in the top-level `build plan` file.
- A six-person ownership plan exists in `iSIH_Build_Plan_6Person.md`.
- Documentation set created: `PRD.md`, `Architecture.md`, `Rules.md`, `Phases.md`, `Design.md`, and this file.
- Extension manifest currently identifies an MV3 development build and loads `content/content-script-stub.js`.

## In Progress

- Aligning implementation with the documented shared contracts.
- Building the extension and server foundations toward the Phase 1 exit checks.
- Establishing reproducible server dependencies and local test commands.

## Recent Changes

- Added the initial product, architecture, guardrails, phase, design, and memory documents.
- Recorded that server dependency installation is not yet reproducible because `server/requirements.txt` is currently empty.

## Unresolved Decisions

- Final demonstration task.
- Chrome-only versus Chrome plus Firefox support.
- One combined model service versus separate LLM and VLM deployments.
- Exact production persistence choice; development guidance currently allows SQLite or JSON-backed state.
- Final model asset and dependency pinning.
- Whether voice input/output belongs in a later scope.

## Working Agreements

- Treat `schemas/` as the integration boundary.
- Keep PII detection and redaction on the client and fail closed on privacy errors.
- Require approval before critical actions.
- Use fixtures and deterministic fakes before model-dependent integration.
- Update this file after meaningful implementation work, decisions, or discovered blockers.

## Known Risks

- Client-side model size and browser capability may affect latency and fallback behavior.
- Colab/ngrok availability may make the demo server unreliable.
- PII recall and redaction precision are high-weight evaluation criteria and need adversarial tests.
- Current extension and server code may still be skeletal; completion claims require executable validation.
