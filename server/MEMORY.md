# Dev 5 — Server Memory Log

## Completed

- **Phase 0**: All 6 JSON schemas written in `/schemas/` (team contracts):
  - `agent_message.schema.ts` — WebSocket envelope with 14 message types
  - `action.schema.json` — Plan output with 16 action types, 4 execution modes, 4 verify methods
  - `dom_snapshot.schema.json` — Sanitized DOM format
  - `vault_manifest.schema.json` — Boolean-only key presence
  - `redacted_payload.schema.json` — Combined sanitized payload
  - `vision_context.schema.json` — BlazeFace + MobileViT output
- **Phase 0**: Pydantic models implemented in `server/schemas/`:
  - `messages.py` — `WebSocketMessage`, `MessageType` enum
  - `actions.py` — `ActionPlan`, `PlanStep`, `ActionType`, `ExecutionMode`
  - `protocols.py` — `classify_protocol_level()`, protocol constants
- **Phase 0**: Fixture files created in `/fixtures/`:
  - `dom_snapshot.json` — Amazon search page DOM
  - `vault_manifest.json` — Email, password, phone available
  - `agent_message_user_query.json` — Full USER_QUERY envelope
  - `action_schema.json` — 7-step Amazon+Flipkart comparison plan
  - `session_memory.json` — Sample session with preferences
  - `vision_context.json` — Search results screen classification
- **Phase 0**: All Pydantic models validated against fixtures — all pass.
- Skipped DESIGN.md per instructions (Dev 1 owns UI design).
- Created all 5 scoped documentation files (PRD, ARCHITECTURE, RULES, PHASES, MEMORY).
- **Phase 1**: FastAPI skeleton completed:
  - `config.py` — Pydantic Settings with all env vars (LLM, VLM, session, WS config)
  - `main.py` — FastAPI app with lifespan manager, CORS, route includes
  - `api/routes.py` — `/api/health` GET endpoint returning model status
  - `api/websocket_handler.py` — `/ws` WebSocket handler with envelope validation + echo
  - `requirements.txt` — All Phase 1-2 dependencies listed
  - `__init__.py` files for api/, core/, state/, schemas/ packages
  - All 7 verification tests pass (imports, config, routes, envelope validation, health endpoint, root endpoint)
- **Phase 2**: Core engine build completed:
  - `models/llm_loader.py` — Qwen3-14B 4-bit loader with bitsandbytes, Flash Attention disabled, CUDA auto device map
  - `core/planner.py` — Prompt template with 7 rules, prompt builder, LLM output parser (handles markdown fences, embedded JSON), retry logic with corrective prompt
  - `core/protocol_engine.py` — classify_plan_steps(), has_critical_steps(), get_critical_steps(), get_next_executable_step()
  - `core/vlm_client.py` — Async HTTP client for Dev 6's VLM server (detect_obstacles, ground, verify, analyze)
  - Updated `api/websocket_handler.py` — Full message routing (USER_QUERY → planner, STEP_RESULT, APPROVAL_RESPONSE, SESSION_RESTORE, PAUSE/RESUME/STOP)
  - Updated `main.py` — LLM loads at startup, unloads at shutdown
  - Updated `requirements.txt` — All dependencies listed
  - All 8 verification tests pass (prompt building, LLM output parsing, schema validation, protocol classification, WebSocket routing, config, health endpoint, end-to-end fixture validation)
- **Phase 3**: VLM integration completed:
  - Updated `core/planner.py` — VLM context auto-fetched when screenshot provided, SCREENSHOT steps trigger VLM re-planning, `replan_after_failure()` for error recovery
  - Updated `api/websocket_handler.py` — STEP_RESULT error recovery: SELECTOR_NOT_FOUND → VLM /ground, ELEMENT_OBSCURED → VLM /detect-obstacles + DISMISS_POPUP, CAPTCHA_TRIGGERED → CAPTCHA_HANDOFF, PAGE_TIMEOUT → WAIT + retry
  - Created `colab_setup.py` — Step-by-step Colab notebook script (install deps, verify GPU, load LLM, start server, ngrok tunnel, test)
  - All Phase 3 tests pass (VLM imports, screenshot detection, mocked VLM context, error recovery routing, full import chain)
- **Phase 5**: Full protocol hookup completed:
  - `state/task_tracker.py` — Full step state machine implementation:
    - States: PENDING → RUNNING → SUCCESS/FAILED/BLOCKED_APPROVAL → RETRYING → HYBRID_FALLBACK
    - Valid state transitions enforced via `VALID_TRANSITIONS` dict
    - `StepRecord` tracks attempts, errors, VLM fallback usage, approval status
    - `TaskTracker` class with plan lifecycle management, pause/resume/stop, step queries
    - `handle_step_result()` routes error codes to appropriate next states
    - Global registry: `get_tracker(session_id)` / `remove_tracker(session_id)`
  - Updated `api/websocket_handler.py`:
    - Full approval gate flow: CRITICAL steps → BLOCKED_APPROVAL → APPROVAL_RESPONSE → RUNNING
    - Task tracker integration: all state transitions tracked per session
    - Error recovery routing with tracker updates (SELECTOR_NOT_FOUND → HYBRID_FALLBACK, etc.)
    - PAUSE/RESUME/STOP handlers now update tracker state
    - Step dispatch via `_dispatch_next_step()` and `_dispatch_next_step_from_tracker()`
- **Phase 6**: Session memory & advanced features completed:
  - `state/session_manager.py` — Session lifecycle with SQLite persistence:
    - `create_session()` — new session with empty memory
    - `restore_session()` — load from SQLite by session_id
    - `archive_session()` — mark session as archived
    - `update_session()` — update session fields (goal, plan_id, step_ids, preferences, entities)
    - `list_sessions()` — list active/archived sessions
    - `delete_session()` — permanent deletion
    - Singleton accessor: `get_session_manager()`
  - `state/memory_store.py` — Cross-session memory with SQLite + JSON snapshots:
    - `store()` / `retrieve()` / `delete()` — generic key-value memory operations
    - `store_preference()` / `get_preferences()` — user preference persistence
    - `store_goal()` / `get_completed_goals()` — completed goal tracking
    - `store_entity()` / `get_entities()` — extracted entity storage
    - `store_history()` / `get_history()` — action/event history
    - `get_session_context()` — assemble cross-session context for planner
    - `save_snapshot()` / `load_snapshot()` — JSON file snapshots
    - Singleton accessor: `get_memory_store()`
  - Updated `core/planner.py`:
    - `generate_plan()` now fetches cross-session context from memory store
    - Context carry-forward: preferences, recent goals, known entities merged into prompt
  - Updated `api/websocket_handler.py`:
    - `SESSION_RESTORE` handler loads session from session manager
    - `USER_QUERY` handler creates/updates session in session manager
    - Session lifecycle wired into WebSocket flow

## In Progress

- Phase 4: Pair with Dev 1 for real WebSocket integration (requires Dev 1's extension)
- Phase 7: Demo rehearsal (requires Phases 4-6 complete)

## Recent Decisions

- `execution_mode` defaults to `DOM` for actions like EXTRACT/REPORT_RESULT that don't need a specific mode.
- Protocol classification uses keyword matching on description text (critical keywords: purchase, login, delete, payment; caution keywords: form, fill, submit, filter).
- Qwen3-14B prompt engineering chosen over fine-tuning for Phase 2; fine-tuning deferred to Phase 6/7 if failure rate >10%.
- Task tracker uses global registry (dict) for per-session trackers — sufficient for single-server deployment.
- Session persistence uses SQLite (single file) rather than PostgreSQL — simpler for hackathon deployment.
- Memory store uses same SQLite database as sessions — avoids connection management complexity.
- Context carry-forward passes user preferences and recent goals to planner — enables "continue from where we left off" functionality.

## Open Issues / Blockers

- Phase 4 requires Dev 1's extension to be working — cannot test real WebSocket integration solo.
- Phase 7 (demo rehearsal) depends on Phases 4-6 being complete.
