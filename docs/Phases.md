# Development Phases

The project uses contract-first, fixture-driven phases. A phase is complete only when its deliverables and exit check are satisfied.

## Phase 0: Contracts And Setup

**Deliverables**

- Freeze the six shared schemas in `schemas/`.
- Add representative fixtures for DOM, vision, redaction, actions, messages, and vault manifests.
- Confirm repository ownership and integration points.
- Decide the demo task, browser targets, and single versus dual model deployment.

**Exit check:** every team member can build against the schemas without waiting for another module.

## Phase 1: Foundation

**Deliverables**

- MV3 manifest, popup/side-panel shells, and service-worker router.
- Content-script injection and semantic DOM extraction skeleton.
- Pure regex PII detector with tests.
- Vision worker and face-detection proof of life.
- FastAPI health route and WebSocket envelope echo.
- VLM loading proof of life in the target GPU environment.

**Exit check:** each module runs independently against fixtures or a local smoke test.

## Phase 2: Core Engines

**Deliverables**

- Popup-to-service-worker messaging and approval UI.
- DOM action executor and post-action verification.
- NER, OCR, combined privacy pipeline, and redaction engine.
- Screen classification, vision context, and encrypted vault foundation.
- LLM planning and protocol safety classification.
- VLM visual grounding endpoint.

**Exit check:** module-level tests pass and outputs validate against shared schemas.

## Phase 3: Side-Level Integration

**Client deliverable:** service worker requests DOM and vision context, runs sanitization, and produces a valid redacted payload.

**Server deliverable:** gateway accepts a fixture payload, produces a valid plan, and invokes visual grounding when required.

**Exit check:** client and server each complete a full local loop without depending on the other side.

## Phase 4: Client-Server Integration

**Deliverables**

- Establish the WebSocket connection.
- Send a live sanitized payload.
- Receive a valid plan/action envelope.
- Confirm session IDs, step IDs, schema validation, and disconnect recovery.

**Exit check:** one real request completes the sanitized payload -> plan round trip.

## Phase 5: Full Agent Loop

**Deliverables**

- Execute server actions and report step results.
- Enforce approval for critical actions.
- Fill approved fields from the local vault.
- Re-sanitize every new page state.
- Handle obstacles, waits, retries, and verification failures.
- Complete one simple search-and-click task autonomously.

**Exit check:** the representative task completes with no raw PII leaving the client.

## Phase 6: Advanced Features

**Deliverables**

- Agent-tab registry and user-tab protection.
- Progress, timeline, cancellation, and recovery UI.
- Session memory and context carry-forward.
- Improved obstacle detection and self-correction.
- Smart waits and bounded retry with backoff.
- Privacy confidence indicators and reusable task templates.

**Exit check:** each feature works independently against the Phase 5 loop.

## Phase 7: Hardening And Demo

**Deliverables**

- Repeated end-to-end demo runs.
- Adversarial PII and redaction tests, including overlapping regions.
- Model fallback and server outage behavior.
- Performance pass for DOM extraction, local scanning, payload size, and action latency.
- Documentation and runbook updates.

**Exit check:** the chosen demo completes twice consecutively in the target environment, and known limitations are documented.

## Delivery Discipline

- Merge small, focused changes.
- Treat schemas as reviewed interfaces.
- Keep model-dependent work behind deterministic fakes where possible.
- Do not begin a later phase by bypassing an earlier phase's safety or validation exit check.
