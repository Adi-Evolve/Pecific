# Dev 5 — Server / LLM Planning Module: PRD

## Core Problem

Accept sanitized, PII-redacted context from the browser extension; understand user intent; produce a safe, structured, step-by-step execution plan — without ever needing or receiving real sensitive data. The server acts as the central reasoning brain, consuming redacted DOM snapshots, vault manifests (boolean field presence only), and redacted screenshots, then producing structured multi-step action plans via Qwen3-14B.

## Target Users

- **Direct API consumer**: the Chrome/Firefox browser extension (via WebSocket).
- **Indirect**: the end user whose natural-language goal must be correctly interpreted and decomposed into safe, executable steps.

## Main Features (Server-Only Scope)

1. **Sanitized Input Ingestion** — Accept `USER_QUERY` over WebSocket containing sanitized DOM, vault manifest, redacted screenshot reference, and goal text.
2. **Multi-Step Plan Generation** — Use Qwen3-14B (4-bit quantized) with chain-of-thought prompting to decompose a user goal into a structured, schema-valid execution plan.
3. **Risk Classification** — Classify every step as `SAFE` / `CAUTION` / `CRITICAL` / `FORBIDDEN` based on action type and context.
4. **VLM Integration** — Call the VLM perception server (`/ground`, `/detect-obstacles`, `/verify`, `/analyze`) when DOM alone is insufficient for visual grounding.
5. **Task State Tracking** — Maintain step lifecycle per the defined state machine: PENDING → RUNNING → SUCCESS/FAILED/BLOCKED_APPROVAL → RETRYING → HYBRID_FALLBACK.
6. **Session Memory** — Persist preferences, completed goals, and extracted entities across tasks and sessions (SQLite/JSON).
7. **Approval Gate** — Emit `APPROVAL_REQUIRED` for `CRITICAL` steps (purchase, login, delete, payment); block execution until `APPROVAL_RESPONSE` received.
8. **Self-Correction** — On step failure: retry, request VLM grounding as fallback, or gracefully degrade to `HYBRID_FALLBACK`.
9. **Multi-Language NLU** — Support Hindi/English user queries via the LLM's native multilingual capability.

## Success Criteria

- Given any fixture `dom_snapshot.json`, produces a valid plan matching `action.schema.json` with no manual correction needed.
- Never emits an action operating on anything other than `[TOKEN]` placeholders for PII fields — real values must never appear in a prompt or a log.
- `CRITICAL` actions (purchase, login, delete, payment) always require `APPROVAL_REQUIRED` before dispatch — no exceptions.
- End-to-end plan generation latency: consistent with the 3–5 second total step time budget.
- All five test scenarios from `COMMUNICATION_SPEC.md` §5 pass with valid JSON output.

## Out of Scope

- DOM extraction (Dev 2), PII detection or redaction (Dev 3), vision/BlazeFace/OCR (Dev 4), VLM inference (Dev 6), extension UI (Dev 1).

## Reference Documents

- `build_plan` (root) — system architecture, model selection, 7-layer build breakdown.
- `COMMUNICATION_SPEC.md` (root) — message formats, state machine schemas, 5 worked JSON scenarios.
- `iSIH_Build_Plan_6Person.md` (root) — team role assignments, schema ownership, phase task list.
