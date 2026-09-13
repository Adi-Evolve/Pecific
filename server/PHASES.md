# Dev 5 — Server / LLM Planning Module: Phase Breakdown

Phases are scoped to only Dev 5's tasks, matching the team's 8-phase plan from `iSIH_Build_Plan_6Person.md`.

---

## Phase 0 — Kickoff & Contracts

**Exit condition**: schemas merged, fixtures committed, everyone knows their folder.

- [ ] Freeze `agent_message.schema.ts` jointly with Dev 1 (co-owned contract).
- [ ] Freeze `action.schema.json` (Dev 5 owns — confirm shape with Dev 2 who consumes it).
- [ ] Confirm `dom_snapshot.schema.json` shape (Dev 2 owns, Dev 5 consumes).
- [ ] Confirm `vision_context.schema.json` shape (Dev 4 owns, Dev 5/6 consume).
- [ ] Confirm `redacted_payload.schema.json` shape (Dev 3 owns, Dev 5 consumes).
- [ ] Confirm `vault_manifest.schema.json` shape (Dev 4 owns, Dev 5 consumes).
- [ ] Set up `/fixtures/` samples: `dom_snapshot.json`, `vault_manifest.json`, `session_memory.json`, `agent_message.json`, `action_schema.json`.
- [ ] Create all six scoped documentation files (PRD, ARCHITECTURE, RULES, PHASES, MEMORY — skip DESIGN).

---

## Phase 1 — Foundation (FastAPI Skeleton)

**Verification**: WebSocket echo works via `websocat` or Python test script — no extension or LLM needed.

- [ ] Create `main.py` — FastAPI app entrypoint with lifespan manager.
- [ ] Create `config.py` — env vars, model paths, ngrok URLs, GPU config.
- [ ] Create `api/health.py` — `/health` GET route returning model status and VRAM usage.
- [ ] Create `api/websocket.py` — WebSocket handler that accepts a connection and echoes back any message conforming to the envelope schema (no real logic yet).
- [ ] Create `schemas/messages.py` — Pydantic models for `WebSocketMessage` envelope.
- [ ] Create `schemas/actions.py` — Pydantic models for action schema.
- [ ] Create `schemas/protocols.py` — Pydantic models for protocol levels.
- [ ] Verify with a raw WebSocket client (Python test script or `websocat`).

---

## Phase 2 — Core Engine Build (Largest Phase)

**Verification**: Feed `/fixtures/dom_snapshot.json` → confirm valid `action.schema.json` output, with zero client or VLM server running.

### 2a. LLM Loading
- [ ] Create `models/llm_loader.py` — Load Qwen3-14B via 4-bit quantization (AWQ or bitsandbytes).
- [ ] Disable Flash Attention 2 in model config (T4 limitation).
- [ ] Verify model loads and produces a basic completion.

### 2b. Planning Module
- [ ] Create `core/planner.py` — Implement the prompt template (§1.5 of DEV5_AI_INSTRUCTIONS.md) as a templated string.
- [ ] Populate all 7 bracketed variables from the current request context.
- [ ] Call Qwen3-14B and parse output.
- [ ] Validate LLM output against `action.schema.json` immediately after generation.
- [ ] Implement retry logic: on invalid JSON, retry once with corrective prompt; on second failure, emit `ERROR`.

### 2c. Protocol Engine
- [ ] Create `core/protocol_engine.py` — Classify each generated step as SAFE/CAUTION/CRITICAL/FORBIDDEN.
- [ ] Implement rule-of-thumb classification:
  - `SAFE`: navigation, scrolling, typing into non-sensitive fields, extracting data
  - `CAUTION`: form fills, filter changes, anything ambiguous
  - `CRITICAL`: login, payment, purchase, delete, account changes
  - `FORBIDDEN`: financial transactions without approval, credential sharing
- [ ] Flag any CRITICAL steps for the approval gate.

### 2d. Testing
- [ ] Test with `/fixtures/dom_snapshot.json` → valid `action.schema.json` output.
- [ ] Confirm zero PII values appear in any log or prompt.
- [ ] Confirm all CRITICAL actions are properly flagged.

---

## Phase 3 — VLM Integration

**Verification**: Fixture payload → valid plan, with VLM invoked correctly when requested — checked without any extension running.

- [ ] Create `core/vlm_client.py` — Async REST client for Dev 6's VLM server endpoints.
- [ ] Implement `POST /detect-obstacles` call (for popup/overlay detection).
- [ ] Implement `POST /ground` call (for visual coordinate fallback).
- [ ] Implement `POST /verify` call (for post-action visual verification).
- [ ] Implement `POST /analyze` call (for general multi-modal reasoning).
- [ ] Wire into `planner.py`: when LLM requests a SCREENSHOT (rule #7 in prompt template), call VLM and feed result back into planning.
- [ ] Test with fixture screenshot + mocked VLM response — do not require Dev 6's server to be live.

---

## Phase 4 — Client-Server Integration (Two-Person Sync with Dev 1)

**Verification**: One full round trip (query → sanitized payload → plan) works end to end.

- [ ] Pair with Dev 1: connect WebSocket for real.
- [ ] Send a live sanitized payload from the extension to the server.
- [ ] Confirm a real plan comes back and the envelope matches schema.
- [ ] Debug any schema mismatches or protocol issues.

---

## Phase 5 — Full Protocol Hookup

**Verification**: CRITICAL actions correctly emit `APPROVAL_REQUIRED` and resume on `APPROVAL_RESPONSE`.

- [x] Implement `APPROVAL_REQUIRED` emission for CRITICAL steps.
- [x] Implement `APPROVAL_RESPONSE` handling — resume plan execution after user approval.
- [x] Implement `PAUSE_AGENT`, `RESUME_AGENT`, `STOP_AGENT` handlers.
- [x] Implement `state/task_tracker.py` — full step state machine.
- [x] Test the full approval gate flow end-to-end.

---

## Phase 6 — Session Memory & Advanced Features

**Verification**: Each feature tested independently against the Phase 5 loop.

- [x] Create `state/session_manager.py` — Session lifecycle (create/restore/archive).
- [x] Create `state/memory_store.py` — Cross-session memory (SQLite/JSON).
- [x] Implement `SESSION_RESTORE` → `SESSION_RESTORED` flow for reconnecting queries to prior session state.
- [x] Implement context carry-forward: new queries can reference prior session goals.
- [ ] Multi-language NLU (Hindi/English) via Qwen3-14B's native multilingual capability.
- [ ] Implement error recovery: self-correction, retry with backoff, VLM-assisted re-planning.

---

## Phase 7 — Demo Rehearsal

**Verification**: The planner reliably produces clean plans for the team's final chosen demo task, twice in a row.

- [ ] Run the target demo task end-to-end repeatedly.
- [ ] Fix whatever breaks in the server module first.
- [ ] Profile and optimize: plan generation latency, memory usage.
- [ ] Confirm all five test scenarios from `COMMUNICATION_SPEC.md` §5 pass.
- [ ] Final performance pass: ensure plan generation fits within the 3–5 second step time budget.
