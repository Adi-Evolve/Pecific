# iSIH Privacy-Preserving Browser Agent — 6-Person Build Plan

Goal: ship the full system (extension + Colab server) as fast as possible with **minimal cross-person blocking** and **minimal merge conflicts**. The strategy is *contracts-first, parallel-tracks*: agree on every JSON/message schema on day one, then let each person build and unit-test their module against fixture data instead of against each other's half-finished code. Real integration only happens at two deliberate checkpoints, not continuously.

---

## 1. Team → Module Ownership

Each role owns a distinct folder from the original architecture, so no two people ever edit the same file. This alone eliminates most merge conflicts.

| Role | Person | Owns (folders/files) | Ties to eval criteria |
|---|---|---|---|
| **R1 — Extension Shell & Orchestrator** | Dev 1 | `extension/manifest.json`, `extension/popup/*`, `extension/sidepanel/*`, `extension/service-worker.js` | UX, latency |
| **R2 — DOM & Execution Engineer** | Dev 2 | `extension/content/*` (extractor, action-executor, verification) | Visual/DOM context accuracy (25%) |
| **R3 — Privacy Engineer** | Dev 3 | `extension/workers/privacy-worker.js` + `regex.js`, `ner.js`, `ocr.js`, `redaction.js` | **PII recall/precision + redaction precision (40% combined) — highest-weight owner** |
| **R4 — Vision & Client-Systems Engineer** | Dev 4 | `extension/workers/vision-worker.js`, `extension/vault/*`, `extension/tab-manager/*` | Visual accuracy, resource use (20%) |
| **R5 — Server/LLM Lead** | Dev 5 | `server/main.py`, `server/config.py`, `server/api/*`, `server/core/*`, `server/state/*`, `server/models/llm_loader.py` | Plan quality, latency |
| **R6 — Server Vision/VLM Engineer** | Dev 6 | `server/vision/*`, `server/models/vlm_loader.py`, Colab/ngrok ops, co-owns `server/schemas/*` | Visual grounding accuracy (25%) |

> Because R3's module (Privacy Engine) covers 40% of the scoring, give it first claim on review time and a second pair of hands (R4, who is idle-est after Phase 2) if it's running behind — see §6.

---

## 2. The One Rule That Prevents Blocking: Contracts First

Every arrow in the architecture diagram is a JSON schema. If that schema is frozen on Day 0, both sides of the arrow can be built simultaneously against a fake/fixture version of the other side. Nobody has to wait for a teammate's code — only for their teammate's **schema**, which is settled in Phase 0.

Freeze these six contracts before any feature code is written:
1. `dom_snapshot.schema.json` — DOM extractor output (owned by R2, consumed by R5)
2. `vision_context.schema.json` — vision worker output (owned by R4, consumed by R5/R6)
3. `redacted_payload.schema.json` — sanitized DOM + redaction map format (owned by R3, consumed by R5)
4. `agent_message.schema.ts` — the WebSocket envelope (`USER_QUERY`, `PLAN`, `STEP_RESULT`, `APPROVAL_REQUIRED`, etc.) (owned jointly by R1 + R5)
5. `action.schema.json` — the structured action the server returns (owned by R5, consumed by R2)
6. `vault_manifest.schema.json` — key-presence-only format (owned by R4, consumed by R5)

Once frozen, create a shared `/fixtures/` directory with 2-3 realistic sample files per schema (sample DOM snapshot, sample screenshot, sample vision context, sample plan JSON, sample vault manifest). Everyone builds and unit-tests against these fixtures for Phases 1-2.

---

## 3. Git & Collaboration Workflow

- **Structure:** one monorepo, `main` branch protected, trunk-based development (short-lived branches, merge daily — a long-lived feature branch on a fast-moving hackathon project causes worse conflicts than frequent small merges).
- **Branch naming:** `feat/<initials>-<module>` (e.g. `feat/r3-regex-pii`). One PR per person per day minimum, even if small.
- **Review:** R1 reviews all `extension/*` PRs except their own; R5 reviews all `server/*` PRs except their own. This keeps two people fluent in the whole codebase without slowing everyone down.
- **Schema changes:** any change to a frozen contract in `/schemas/` must be posted in the team channel *before* merging — it's the only thing that can silently break someone else's work.
- **No shared files:** since each role owns a distinct folder (§1), avoid ever having two people edit `service-worker.js` or `main.py` simultaneously — route new logic through small new files that get imported, not through edits to someone else's core file.

---

## 4. Phase-by-Phase Task List

### Phase 0 — Kickoff & Contracts *(whole team, short — do not skip)*
- [ ] All 6: agree on the 6 schemas in §2; commit them to `/schemas/`.
- [ ] All 6: agree on repo layout (matches the folders in §1), create `/fixtures/`.
- [ ] Dev 1 + Dev 5: draft `agent_message.schema.ts` together (the one contract two different roles co-own).
- [ ] Dev 6: confirm Colab access, start pulling Qwen3-14B and Qwen2.5-VL-7B weights in the background (large downloads — start this immediately, it gates Phase 2 for R5/R6).
- **Exit condition:** schemas merged, fixtures committed, everyone knows their folder.

### Phase 1 — Foundation *(all 6 in parallel, zero cross-dependencies)*
| Owner | Tasks |
|---|---|
| Dev 1 | MV3 manifest + permissions; empty popup/sidepanel shells; service-worker skeleton with a message router stub (routes by `type`, logic TBD) |
| Dev 2 | Content script injection skeleton; raw DOM → accessibility-tree parse; element tagging with IDs (testable standalone in a browser console on any page) |
| Dev 3 | Regex PII engine only (emails, phone, Aadhaar, PAN, Luhn card check) — pure functions, unit-tested against string fixtures, no browser needed yet |
| Dev 4 | BlazeFace integration in a Web Worker, tested against sample images in `/fixtures/` |
| Dev 5 | FastAPI app skeleton, `/health` route, WebSocket handler that echoes messages conforming to the frozen envelope schema |
| Dev 6 | Get Qwen2.5-VL-7B loading and running a single inference in Colab (INT4, no Flash Attention); confirm ngrok tunnel works end to end |
- **Verification:** each person demos their piece in isolation (console command, unit test, curl/websocket ping, notebook cell) — no waiting on anyone else.

### Phase 2 — Core Engine Build *(all 6 in parallel, fixture-driven)*
| Owner | Tasks |
|---|---|
| Dev 1 | Wire popup → service worker message passing; approval-dialog UI component (visual only, not yet wired to real logic); notification permission setup |
| Dev 2 | DOM Action Executor (click/type/navigate via `querySelector` + dispatched events); post-action verification (re-check DOM state) |
| Dev 3 | BERT-NER (Xenova, ONNX INT8) + Tesseract.js OCR, both in the privacy worker; combine with regex output; redaction engine (token replacement + redaction map, kept client-only) |
| Dev 4 | MobileViT-XXS screen classifier in vision worker; merge with BlazeFace output into `vision_context` (per the frozen schema); start Vault (AES-256-GCM via Web Crypto API) |
| Dev 5 | Planning module: prompt template + Qwen3-14B integration; protocol engine (SAFE/CAUTION/CRITICAL classification); test with `/fixtures/dom_snapshot.json` → valid `action.schema.json` output (no client needed) |
| Dev 6 | Visual grounding endpoint: screenshot → bounding box / action prediction via Qwen2.5-VL-7B; test with `/fixtures/screenshot.png` |
- **Verification:** each module passes its own unit/integration test against fixtures. This is the biggest chunk of work — expect it to take the longest of any phase.
- **Note:** R3's redaction engine is the highest-weighted deliverable — once done, have R4 (usually first to finish Phase 2) spend spare time writing adversarial test cases for it (edge-case PII strings, overlapping face+text regions) rather than starting Phase 3 early.

### Phase 3 — Side-Level Integration *(splits into two parallel pairs — first real dependency, but only within each side)*
**Client side (Dev 1 leads, Dev 2/3/4 support):**
- [ ] Wire service worker: query → request DOM snapshot (R2) + vision analysis (R4) → send to privacy worker (R3) → produce sanitized payload.
- [ ] This is a merge of already-finished, already-tested modules — should be plumbing, not new logic.

**Server side (Dev 5 leads, Dev 6 supports):**
- [ ] Wire gateway: sanitized payload in → LLM plan out; hook VLM visual-verification call into the plan loop when the LLM requests a screenshot check.
- [ ] Again, plumbing between two already-tested modules.

- **Verification (client):** feeding a real page produces a correctly sanitized payload matching the schema — checked without any server running.
- **Verification (server):** feeding a fixture payload produces a valid plan, with VLM invoked correctly when requested — checked without any extension running.

### Phase 4 — Client ↔ Server Integration *(the one unavoidable two-person sync point)*
- [ ] Dev 1 + Dev 5 pair up: connect the WebSocket for real, send a live sanitized payload from the extension to the live server, confirm a real plan comes back and the envelope matches schema.
- [ ] Dev 2, 3, 4, 6: available for on-call debugging but keep working on Phase 6 advanced-feature prep (see below) rather than blocking on this pairing.
- **Exit condition:** one full round trip (query → sanitized payload → plan) works end to end, once.

### Phase 5 — Full Agentic Loop
| Owner | Tasks |
|---|---|
| Dev 2 | Wire action executor to actually run steps returned by the server; report `STEP_RESULT` back |
| Dev 5 | Protocol engine hookup: emit `APPROVAL_REQUIRED` for CRITICAL actions |
| Dev 1 | Wire the approval dialog (built in Phase 2) to real approval events; desktop notification on task complete |
| Dev 3 | Support: make sure re-sanitization happens correctly on every new DOM state in the loop, not just the first request |
| Dev 4 | Support: vault `TYPE_FROM_VAULT` action — server requests a type, vault fills the value locally |
| Dev 6 | Support: obstacle screenshot → VLM classification path (popup/login/CAPTCHA/cookie banner) |
- **Verification:** one complete simple task (e.g. a search + click) runs fully autonomously.

### Phase 6 — Advanced Features *(parallelizes again — interfaces are now stable)*
| Owner | Tasks |
|---|---|
| Dev 4 | Tab Manager: agent-tab registry, visual border/badge, user-tab read-only enforcement |
| Dev 1 | Screenshot timeline UI, undo/rollback, progress bar + ETA, keyboard shortcuts |
| Dev 5 | Session memory (SQLite/JSON), context carry-forward, multi-language NLU (Hindi/English) |
| Dev 6 | Dynamic obstacle handling refinement (popup/login-wall/CAPTCHA classification accuracy), self-correction/re-planning on failure |
| Dev 2 | Smart wait (page load/AJAX detection), error-recovery retry-with-backoff on the execution side |
| Dev 3 | Confidence indicators on the redaction dashboard, task templates (save/replay flows) |
- **Verification:** each feature tested independently against the Phase 5 loop; low risk of conflict since features touch different files.

### Phase 7 — Hardening, Polish & Demo Rehearsal *(whole team)*
- [ ] All: run the target demo task end to end repeatedly; fix whatever breaks in your own module first.
- [ ] Dev 1: UI/UX pass, error states, empty states.
- [ ] Dev 3 + Dev 4: joint pass on PII test pages (emails, names, faces, Aadhaar/PAN samples) since this is the highest-weight criterion — do not skip a dedicated review pass here.
- [ ] Dev 6: pin down Colab/ngrok reliability for the actual demo environment (this is a common last-minute failure point — test it under demo-like conditions, not just dev conditions).
- [ ] All: performance pass — each person profiles and optimizes their own module (client models <100MB total, DOM extraction <50ms, PII scan <300ms per the targets in the architecture doc).
- **Exit condition:** the chosen demo task ("Buy headphones under ₹1000 on Flipkart" or whatever you finalize) completes cleanly, twice in a row.

---

## 5. Dependency Map (what actually blocks what)

```
Phase 0 (contracts)
   │
   ├── R1, R2, R3, R4, R5, R6  →  Phase 1  (fully parallel, zero deps)
   │
   ├── R1, R2, R3, R4, R5, R6  →  Phase 2  (fully parallel, fixture-driven)
   │
   ├── [R1 waits on: R2 output, R3 output, R4 output]      → Phase 3 (client)
   ├── [R5 waits on: R6 output]                            → Phase 3 (server)
   │        (these two integrations happen in parallel with each other)
   │
   ├── [R1 + R5 pair; R2/R3/R4/R6 unblocked, doing Phase 6 prep] → Phase 4
   │
   ├── R2, R5, R1, R3, R4, R6  →  Phase 5  (converging, short)
   │
   ├── R1, R2, R3, R4, R5, R6  →  Phase 6  (fully parallel again)
   │
   └── R1, R2, R3, R4, R5, R6  →  Phase 7  (whole team)
```

Only two points in the entire project require two people to actively wait on each other: **Phase 3** (two pairs, running concurrently with each other, not with the whole team) and **Phase 4** (one pair, while the other four keep working). Everything else is parallelizable.

---

## 6. Priority Note

PII detection recall/precision + redaction precision together make up **40%** of the evaluation — more than any other criterion. Treat R3's module as the critical path for quality even though it isn't the critical path for scheduling: give it extra test coverage in Phase 2, a dedicated review pass in Phase 7, and pull in R4 (their nearest neighbor in skill set) to help stress-test it if it's the last module to stabilize.

## 7. Open Items to Settle Before Phase 0 Ends

These come straight from the build plan's own open questions and affect task scope, so resolve them first:
- Final demo task (affects what R2/R5 need to test against).
- Single vs. dual Colab notebook for LLM+VLM (affects R6's Phase 1 setup).
- Chrome-only vs. Chrome+Firefox (affects whether R4 needs a WASM fallback path).
- Voice input in/out of scope (affects whether R1 needs Web Speech API work).
