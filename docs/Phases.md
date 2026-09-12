# Development Phases (Dev 1 Focus)

This document tracks the phases of development with a focus on Dev 1 (Extension Shell & Orchestrator) deliverables.

## Phase 0: Kickoff & Contracts
**Goal:** Agree on schemas and repo layout.
**Dev 1 Task:** Draft `agent_message.schema.ts` collaboratively with Dev 5 (Server/LLM).
**Exit Condition:** Schemas merged, fixtures committed, folders established.

## Phase 1: Foundation
**Goal:** Establish basic skeleton and permissions.
**Dev 1 Task:**
- Create MV3 `manifest.json` with permissions (`activeTab`, `scripting`, etc.).
- Create empty `popup` and `sidepanel` HTML shells.
- Create `service-worker.js` skeleton with a stubbed message router (routing by `type`).

## Phase 2: Core Engine Build
**Goal:** Build individual components against fixtures.
**Dev 1 Task:**
- Wire popup to service worker message passing.
- Create Approval Dialog UI component (visual only).
- Request Notification permissions.

## Phase 3: Side-Level Integration (Client)
**Goal:** Merge client-side modules.
**Dev 1 Task:** Wire service worker to coordinate: query $\to$ request DOM snapshot (Dev 2) $\to$ vision analysis (Dev 4) $\to$ send to privacy worker (Dev 3) $\to$ produce sanitized payload.

## Phase 4: Client $\leftrightarrow$ Server Integration
**Goal:** Full round-trip integration.
**Dev 1 Task:** Connect WebSocket to live server, send sanitized payload, and confirm plan response matches schema.

## Phase 5: Full Agentic Loop
**Goal:** End-to-end autonomous action.
**Dev 1 Task:** Wire the approval dialog to real events and show desktop notifications on task completion.

## Phase 6: Advanced Features
**Goal:** Add UX polish.
**Dev 1 Task:** Screenshot timeline UI, undo/rollback controls, progress bar + ETA, keyboard shortcuts.

## Phase 7: Hardening & Polish
**Goal:** Demo prep.
**Dev 1 Task:** UI/UX pass, handle error states, empty states.
