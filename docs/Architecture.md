# System Architecture

## App Flow (Pipeline)
The system executes a repeating step-by-step pipeline for autonomous action:
1. **Capture DOM**
2. **Capture Screenshot**
3. **Run Vision Model**
4. **Run OCR**
5. **Run NER**
6. **Run Regex**
7. **Face Detection**
8. **Sanitize Everything** (Redaction Engine)
9. **Send Everything to Server** (via WebSocket)
10. **LLM** (Planning)
11. **VLM** (Visual verification)
12. **Get Action** (Server responds with structured action)
13. **Execute** (Browser agent executes action)
14. **Repeat**

## Folder / File Structure
The project is a monorepo separated by module ownership:
- `extension/` (Client)
  - `manifest.json`, `popup/*`, `sidepanel/*`, `service-worker.js` (Dev 1 - Orchestrator)
  - `content/*` (Dev 2 - DOM & Executor)
  - `workers/privacy-worker.js`, `regex.js`, `ner.js`, `ocr.js`, `redaction.js` (Dev 3 - Privacy)
  - `workers/vision-worker.js`, `vault/*`, `tab-manager/*` (Dev 4 - Vision/Vault)
- `server/` (Backend)
  - `main.py`, `config.py`, `api/*`, `core/*`, `state/*`, `models/llm_loader.py` (Dev 5 - LLM/Server)
  - `vision/*`, `models/vlm_loader.py` (Dev 6 - VLM)
- `schemas/` (Contracts)
- `fixtures/` (Test data)

## Tech Stack
- **Extension:** Chrome Manifest V3, HTML/CSS/JS, ONNX Runtime Web, Transformers.js, Tesseract.js.
- **Backend:** Python 3.11+, FastAPI, WebSockets.
- **Models:** Qwen3-14B (LLM), Qwen2.5-VL-7B (VLM).

## APIs and Data Flow
- **Contracts-First:** Communication relies on fixed JSON schemas in `schemas/`. No cross-person blocking.
- **Extension $\to$ Server:** `USER_QUERY`, `STEP_RESULT`, `APPROVAL_RESPONSE`, `SESSION_RESTORE`, `PAUSE_AGENT`, `RESUME_AGENT`, `STOP_AGENT`.
- **Server $\to$ Extension:** `PLAN`, `NEXT_STEP`, `APPROVAL_REQUIRED`, `DYNAMIC_OBSTACLE`, `SESSION_RESTORED`, `TASK_COMPLETE`, `ERROR`.
