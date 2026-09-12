# Dev 5 — Server / LLM Planning Module: Architecture

## App Flow (Server-Internal)

```
WebSocket message arrives
  → validated against agent_message.schema.ts (Pydantic models)
  → routed by `type` field
  → Planning Module loads session context from Session Manager
  → builds prompt from template (see DESIGN.md §1.5)
  → calls Qwen3-14B via llm_loader.py
  → parses/validates LLM output against action.schema.json
  → Protocol Engine classifies each step (SAFE/CAUTION/CRITICAL/FORBIDDEN)
  → if any step is CRITICAL: hold and emit APPROVAL_REQUIRED
  → otherwise: emit PLAN
  → on STEP_RESULT back from extension: update Task Tracker state
  → repeat until TASK_COMPLETE or ERROR
```

## Folder Structure

```
server/
├── main.py                    # FastAPI app entrypoint
├── config.py                  # env vars, model paths, ngrok URLs
├── api/
│   ├── websocket.py           # WS handler, message routing by `type`
│   └── health.py              # /health route
├── core/
│   ├── planner.py             # prompt building + LLM call + plan parsing
│   ├── protocol_engine.py     # SAFE/CAUTION/CRITICAL/FORBIDDEN classification
│   └── vlm_client.py          # REST client calling Dev 6's VLM endpoints
├── state/
│   ├── session_manager.py     # session lifecycle (create/restore/archive)
│   ├── task_tracker.py        # step state machine (see §1.6)
│   └── memory_store.py        # cross-session memory (SQLite/JSON)
├── models/
│   └── llm_loader.py          # Qwen3-14B loader (4-bit AWQ/bitsandbytes)
└── schemas/                   # co-owned with Dev 1
    ├── actions.py
    ├── messages.py
    └── protocols.py
```

## Tech Stack

| Component | Technology |
|---|---|
| Framework | Python 3.11+, FastAPI, Uvicorn |
| Transport | WebSocket (primary) with REST fallback |
| LLM | Qwen3-14B via 4-bit quantization (AWQ or bitsandbytes) |
| GPU Constraint | T4 — Flash Attention 2 must be disabled |
| Schema Validation | Pydantic v2 for all message payloads |
| Outbound HTTP | `httpx` (async-friendly, for VLM calls) |
| Persistence | SQLite (sessions), JSON files (memory snapshots) |

## Data Flow (Payload Path)

1. Extension sends `USER_QUERY` over WebSocket with sanitized DOM, vault manifest, redacted screenshot, and goal text.
2. Server validates envelope against `agent_message.schema.ts` via Pydantic.
3. `planner.py` builds prompt with goal, URL, sanitized DOM, vault manifest, completed steps, session memory.
4. Qwen3-14B generates structured plan JSON.
5. Output validated against `action.schema.json`; on failure: retry once with corrective prompt, then emit `ERROR`.
6. `protocol_engine.py` classifies each step's risk level.
7. If any step is CRITICAL: emit `APPROVAL_REQUIRED` and hold.
8. Otherwise: emit `PLAN` to extension; extension executes and returns `STEP_RESULT`.
9. On failure codes: route through error recovery (VLM grounding, popup dismissal, CAPTCHA handoff).
10. When all steps complete: emit `TASK_COMPLETE` with summary and extracted data.

## APIs Exposed

| Endpoint | Method | Description |
|---|---|---|
| `/ws` | WebSocket | Primary channel to extension |
| `/health` | GET | Liveness probe, model readiness, VRAM status |

## APIs Called (VLM Server via `vlm_client.py`)

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | Probe VRAM and model readiness |
| `/detect-obstacles` | POST | Identify popups, cookie walls, CAPTCHAs |
| `/ground` | POST | Find pixel coordinates for UI elements |
| `/verify` | POST | Verify visual condition post-execution |
| `/analyze` | POST | General multi-modal image + text reasoning |

VLM request body for all POST calls:
```json
{
  "screenshot": "data:image/jpeg;base64,...",
  "prompt": "...",
  "max_tokens": 1024
}
```

## Key Dependencies

- `fastapi`, `uvicorn`, `websockets`
- `transformers`, `bitsandbytes` or `autoawq`
- `pydantic` (schema validation)
- `httpx` (async HTTP for VLM calls)
- `sqlite3` (stdlib)
- `jinja2` (prompt templating)
