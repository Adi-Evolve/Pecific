# Dev 5 — Progress Report: Phases 0–3 Complete

**Branch:** `feat/dev5-server-llm` (NOT `main`)
**Date:** 2026-09-12
**Status:** Phases 0–3 complete, Phase 4 onward pending

---

## Table of Contents

1. [What Is Dev 5?](#1-what-is-dev-5)
2. [Reference Documents](#2-reference-documents)
3. [Phase 0 — Contracts & Fixtures (DONE)](#3-phase-0--contracts--fixtures)
4. [Phase 1 — FastAPI Skeleton (DONE)](#4-phase-1--fastapi-skeleton)
5. [Phase 2 — Core Engine Build (DONE)](#5-phase-2--core-engine-build)
6. [Phase 3 — VLM Integration (DONE)](#6-phase-3--vlm-integration)
7. [Phase 4 — Client-Server Integration (TODO)](#7-phase-4--client-server-integration)
8. [Phase 5 — Full Protocol Hookup (TODO)](#8-phase-5--full-protocol-hookup)
9. [Phase 6 — Session Memory & Advanced (TODO)](#9-phase-6--session-memory--advanced)
10. [Phase 7 — Demo Rehearsal (TODO)](#10-phase-7--demo-rehearsal)
11. [File Inventory](#11-file-inventory)
12. [How to Run](#12-how-to-run)

---

## 1. What Is Dev 5?

Dev 5 is the **Server / LLM Planning Lead** on a 6-person hackathon team building PrivacyLens — a privacy-preserving browser AI agent.

**What Dev 5 owns:**
| Folder/File | Purpose |
|---|---|
| `server/main.py` | FastAPI app entrypoint |
| `server/config.py` | Environment variables, model paths, ngrok URLs |
| `server/api/*` | WebSocket handler, health route |
| `server/core/*` | Planning module, protocol engine, VLM client |
| `server/state/*` | Session manager, task tracker, memory store |
| `server/models/llm_loader.py` | Qwen3-14B loader (4-bit quantized) |
| `server/schemas/*` | Pydantic models (co-owned with Dev 1 for WebSocket envelope) |

**What Dev 5 does NOT touch:**
- `extension/` (Dev 1–4)
- `server/vision/*` (Dev 6's VLM code)
- `server/models/vlm_loader.py` (Dev 6)

**Critical constraint:** Work ONLY on `feat/dev5-server-llm` branch. Never commit to `main`.

---

## 2. Reference Documents

These are the ground-truth documents that govern the project. Read them if anything is unclear:

| Document | Location | Purpose |
|---|---|---|
| `DEV5_AI_INSTRUCTIONS.md` | Root | **YOUR instructions** — what to build, in what order |
| `COMMUNICATION_SPEC.md` | Root | Message formats, state machines, 5 worked JSON scenarios |
| `build_plan` | Root | Full system architecture, model selection, 7-layer breakdown |
| `iSIH_Build_Plan_6Person.md` | Root | Team roles, schema ownership, phase task list |
| `server/PRD.md` | `server/` | Server-specific product requirements |
| `server/ARCHITECTURE.md` | `server/` | Server folder structure, tech stack, data flow |
| `server/RULES.md` | `server/` | Coding style, error handling, hard "must never" rules |
| `server/PHASES.md` | `server/` | Phase-by-phase task breakdown |
| `server/MEMORY.md` | `server/` | Session log (updated after every work session) |

---

## 3. Phase 0 — Contracts & Fixtures

**Status:** DONE
**What was done:**

### 3.1 JSON Schemas (Team Contracts) — `/schemas/`

These are the frozen contracts that ALL 6 team members build against:

| Schema | File | Owner | What It Defines |
|---|---|---|---|
| `agent_message.schema.ts` | `/schemas/agent_message.schema.ts` | Dev 1 + Dev 5 (co-owned) | WebSocket envelope: `type`, `session_id`, `payload`. 14 message types. |
| `action.schema.json` | `/schemas/action.schema.json` | Dev 5 (owns) | Plan output: steps with `id`, `action`, `target`, `execution_mode`, `protocol_level`, `verify`, `timeout_ms`. 16 action types. |
| `dom_snapshot.schema.json` | `/schemas/dom_snapshot.schema.json` | Dev 2 (owns) | Sanitized DOM: `elements[]` with `[TOKEN]` placeholders for PII. |
| `vault_manifest.schema.json` | `/schemas/vault_manifest.schema.json` | Dev 4 (owns) | Boolean flags only: `has_email`, `has_password`, etc. NEVER values. |
| `redacted_payload.schema.json` | `/schemas/redacted_payload.schema.json` | Dev 3 (owns) | Combined sanitized payload with `privacy_stats`. |
| `vision_context.schema.json` | `/schemas/vision_context.schema.json` | Dev 4 (owns) | BlazeFace + MobileViT output: face bounding boxes, screen classification. |

### 3.2 Pydantic Models (Python Implementations) — `server/schemas/`

| File | What It Contains |
|---|---|
| `messages.py` | `WebSocketMessage` model, `MessageType` enum (14 types) |
| `actions.py` | `ActionPlan`, `PlanStep`, `ActionType` (16 actions), `ExecutionMode` (3 modes) |
| `protocols.py` | `classify_protocol_level()` function, protocol constants (SAFE/CAUTION/CRITICAL/FORBIDDEN) |

### 3.3 Fixture Files — `/fixtures/`

Realistic test data for building and testing without a live extension:

| File | Content |
|---|---|
| `dom_snapshot.json` | Amazon search page DOM (3 elements: search box, submit button, sign-in link) |
| `vault_manifest.json` | Email, password, phone available (has_address=false, has_card=false) |
| `agent_message_user_query.json` | Full USER_QUERY envelope with sanitized DOM, vault manifest, redacted screenshot, privacy stats |
| `action_schema.json` | 7-step plan: search Amazon → filter 4 stars → extract → open Flipkart → search → extract → compare |
| `session_memory.json` | Sample session with user preferences (budget ₹30000, brand Sony, pincode 560001) |
| `vision_context.json` | Search results screen, 1 face detected, 1 PII text region |

### 3.4 Verification

All Pydantic models validated against all fixtures. 7/7 tests pass.

---

## 4. Phase 1 — FastAPI Skeleton

**Status:** DONE
**What was done:**

| File | Content |
|---|---|
| `config.py` | Pydantic Settings: LLM model name, 4-bit config, Flash Attention disabled, VLM server URL, port, session DB path |
| `main.py` | FastAPI app with lifespan manager (startup/shutdown hooks), CORS middleware, route includes |
| `api/routes.py` | `/api/health` GET endpoint: returns model status, VRAM info, VLM server URL |
| `api/websocket_handler.py` | `/ws` WebSocket endpoint: accepts connections, validates envelope against Pydantic model, echoes back valid messages |
| `requirements.txt` | All Python dependencies: fastapi, uvicorn, transformers, bitsandbytes, httpx, etc. |
| `__init__.py` files | Package markers for api/, core/, state/, schemas/ |

### Verification

7/7 tests pass: imports, config, routes, envelope validation, health endpoint, root endpoint, invalid envelope rejection.

---

## 5. Phase 2 — Core Engine Build

**Status:** DONE
**What was done:**

### 5.1 LLM Loader — `models/llm_loader.py`

- Loads Qwen3-14B with 4-bit quantization via bitsandbytes
- Flash Attention 2 disabled (T4 GPU limitation)
- Auto GPU detection (`device_map="auto"`)
- Caches model in memory (loads once, returns cached instance)
- `unload_llm()` frees VRAM on shutdown

### 5.2 Planner — `core/planner.py`

- **Prompt template** with all 7 rules from DEV5_AI_INSTRUCTIONS.md §1.5
- **`_build_prompt()`** — fills in goal, URL, sanitized DOM, vault manifest, previous steps, session memory
- **`_parse_llm_output()`** — handles raw JSON, markdown-fenced JSON, JSON embedded in text
- **`generate_plan()`** — full pipeline: build prompt → call LLM → parse → validate → retry on failure
- **`replan_after_failure()`** — re-plans when a step fails, incorporates VLM context
- **Retry logic**: on invalid JSON, sends corrective prompt once; if still fails, emits ERROR
- **VLM integration**: if screenshot provided, calls VLM `/detect-obstacles` and `/ground`, feeds context back into prompt

### 5.3 Protocol Engine — `core/protocol_engine.py`

- **`classify_plan_steps()`** — classifies every step in a plan
- **Classification rules**:
  - `SAFE`: navigation, scroll, extract, type search terms
  - `CAUTION`: form fills, filter changes, ambiguous actions
  - `CRITICAL`: login, payment, purchase, delete, TYPE_FROM_VAULT, CAPTCHA_HANDOFF
  - `FORBIDDEN`: never executed
- **`has_critical_steps()`** — checks if any step requires approval
- **`get_critical_steps()`** — returns all CRITICAL steps
- **`get_next_executable_step()`** — returns next step not yet completed

### 5.4 VLM Client — `core/vlm_client.py`

- Async HTTP client for Dev 6's VLM server
- `detect_obstacles()` — POST `/detect-obstacles`
- `ground_element()` — POST `/ground`
- `verify_state()` — POST `/verify`
- `analyze_image()` — POST `/analyze`
- `check_health()` — GET `/health`

### 5.5 WebSocket Handler Updated — `api/websocket_handler.py`

- **`USER_QUERY`** → builds prompt → calls planner → classifies steps → sends PLAN or APPROVAL_REQUIRED
- **`STEP_RESULT`** → error recovery routing:
  - `SELECTOR_NOT_FOUND` → VLM `/ground` fallback
  - `ELEMENT_OBSCURED` → VLM `/detect-obstacles` → DISMISS_POPUP
  - `CAPTCHA_TRIGGERED` → CAPTCHA_HANDOFF
  - `PAGE_TIMEOUT` → WAIT + retry
- **`APPROVAL_RESPONSE`** → resumes or denies
- **`SESSION_RESTORE`** → placeholder for Phase 6
- **`PAUSE_AGENT` / `RESUME_AGENT` / `STOP_AGENT`** → handled

### 5.6 Main Updated — `main.py`

- LLM loads at startup via `load_llm()`
- LLM unloads at shutdown via `unload_llm()`

### Verification

8/8 tests pass: prompt building, LLM output parsing, schema validation, protocol classification, WebSocket routing, config, health endpoint, end-to-end fixture validation.

---

## 6. Phase 3 — VLM Integration

**Status:** DONE
**What was done:**

- `core/planner.py` updated with VLM auto-fetch when screenshot provided
- `api/websocket_handler.py` updated with full error recovery routing (5 error codes)
- `colab_setup.py` created then replaced by `setup.py`
- All Phase 3 tests pass (VLM imports, screenshot detection, mocked VLM context, error recovery routing, full import chain)

---

## 7. Phase 4 — Client-Server Integration

**Status:** TODO
**Depends on:** Dev 1 (extension must be working)
**What needs to happen:**

1. **Pair with Dev 1** — connect WebSocket for real
2. **Send a live sanitized payload** from the extension to the server
3. **Confirm a real plan comes back** and the envelope matches schema
4. **Debug any schema mismatches** or protocol issues

**Verification:** One full round trip (query → sanitized payload → plan) works end to end.

**This is the one unavoidable two-person sync point** — you cannot do this alone. Dev 1 must have their extension running.

---

## 8. Phase 5 — Full Protocol Hookup

**Status:** TODO
**Depends on:** Phase 4
**What needs to happen:**

1. **`APPROVAL_REQUIRED`** — emit for every CRITICAL step before dispatch
2. **`APPROVAL_RESPONSE`** — resume plan execution after user approves
3. **`PAUSE_AGENT` / `RESUME_AGENT` / `STOP_AGENT`** — full agent control flow
4. **Task tracker** (`state/task_tracker.py`) — track step lifecycle:
   ```
   PENDING → RUNNING → SUCCESS/FAILED/BLOCKED_APPROVAL → RETRYING → HYBRID_FALLBACK
   ```

**Verification:** CRITICAL actions correctly emit `APPROVAL_REQUIRED` and resume on `APPROVAL_RESPONSE`.

---

## 9. Phase 6 — Session Memory & Advanced

**Status:** TODO
**Depends on:** Phase 5
**What needs to happen:**

1. **`state/session_manager.py`** — session lifecycle:
   - `create_session()` — new session with empty memory
   - `restore_session()` — load from SQLite by session_id
   - `archive_session()` — save completed session

2. **`state/memory_store.py`** — cross-session memory:
   - SQLite database for sessions
   - JSON files for memory snapshots
   - User preferences, completed goals, extracted entities

3. **`SESSION_RESTORE` → `SESSION_RESTORED`** — reconnecting new queries to prior session state

4. **Context carry-forward** — new queries can reference prior session goals ("continue from where we left off")

5. **Multi-language NLU** — Hindi/English support via Qwen3-14B's native multilingual capability

6. **`state/task_tracker.py`** — full step state machine implementation

**Verification:** Each feature tested independently against the Phase 5 loop.

---

## 10. Phase 7 — Demo Rehearsal

**Status:** TODO
**Depends on:** Phases 4–6
**What needs to happen:**

1. **Run the target demo task** end-to-end repeatedly (e.g., "Buy headphones under ₹1000 on Flipkart")
2. **Fix whatever breaks** in the server module first
3. **Profile and optimize**:
   - Plan generation latency (target: fits in 3-5s step budget)
   - Memory usage
4. **Confirm all 5 test scenarios** from `COMMUNICATION_SPEC.md` §5 pass:
   - Scenario 1: Multi-tab e-commerce comparison
   - Scenario 2: Dynamic popup dismissal
   - Scenario 3: Broken CSS selector → VLM grounding
   - Scenario 4: CAPTCHA handoff
   - Scenario 5: CRITICAL/approval-required path (checkout/payment)
5. **Final performance pass** — ensure plan generation fits within latency budget

**Verification:** The chosen demo task completes cleanly, twice in a row.

---

## 11. File Inventory

### All files created/modified by Dev 5:

```
server/
├── main.py                          # FastAPI app + LLM lifecycle
├── config.py                        # All settings (Pydantic Settings)
├── setup.py                         # Colab/Kaggle one-click setup script
├── requirements.txt                 # Python dependencies
├── PRD.md                           # Product requirements (server scope)
├── ARCHITECTURE.md                  # Folder structure, tech stack, data flow
├── RULES.md                         # Coding style, error handling, hard rules
├── PHASES.md                        # Phase-by-phase task breakdown
├── MEMORY.md                        # Session log (update after every session)
├── api/
│   ├── __init__.py
│   ├── routes.py                    # /api/health endpoint
│   └── websocket_handler.py         # /ws WebSocket handler + routing
├── core/
│   ├── __init__.py
│   ├── planner.py                   # Prompt template + LLM call + plan parsing
│   ├── protocol_engine.py           # SAFE/CAUTION/CRITICAL/FORBIDDEN classification
│   └── vlm_client.py               # Async HTTP client for Dev 6's VLM server
├── models/
│   ├── __init__.py
│   └── llm_loader.py               # Qwen3-14B 4-bit loader
├── schemas/
│   ├── __init__.py
│   ├── messages.py                  # WebSocketMessage, MessageType enum
│   ├── actions.py                   # ActionPlan, PlanStep, ActionType
│   └── protocols.py                 # classify_protocol_level()
└── state/
    ├── __init__.py
    ├── session_manager.py           # (empty — Phase 6)
    ├── task_tracker.py              # (empty — Phase 5)
    └── memory_store.py              # (empty — Phase 6)

/schemas/                            # Team contracts (JSON Schema)
├── agent_message.schema.ts          # WebSocket envelope
├── action.schema.json               # Plan output shape
├── dom_snapshot.schema.json         # Sanitized DOM format
├── vault_manifest.schema.json       # Boolean key presence
├── redacted_payload.schema.json     # Combined sanitized payload
└── vision_context.schema.json       # BlazeFace + MobileViT output

/fixtures/                           # Test data
├── dom_snapshot.json
├── vault_manifest.json
├── agent_message_user_query.json
├── action_schema.json
├── session_memory.json
└── vision_context.json
```

---

## 12. How to Run

### Local (with GPU):
```bash
cd server
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Colab:
1. Upload `server/` folder
2. Runtime → Change runtime type → T4 GPU
3. `%run setup.py`

### Kaggle:
1. Upload `server/` folder
2. Settings → Accelerator → GPU T4
3. Settings → Internet → On
4. Set `NGROK_AUTH_TOKEN` in `setup.py`
5. `%run setup.py`

### After server is running:
- API docs: `http://localhost:8000/docs`
- Health: `http://localhost:8000/api/health`
- WebSocket: `ws://localhost:8000/ws`

---

*Last updated: 2026-09-12 — End of Phase 3*
