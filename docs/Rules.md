# AI Guardrails

These rules apply to AI-generated code and changes in this repository.

## Libraries And Stack

- Use the existing JavaScript browser-extension architecture and Python FastAPI backend.
- Prefer Web Workers for CPU/GPU-heavy client inference.
- Use ONNX Runtime Web and the checked-in `extension/lib/ort/` assets for browser inference.
- Use Web Crypto API primitives for local vault encryption; do not invent cryptography.
- Use JSON Schema and the existing shared schemas for cross-boundary validation.
- Use FastAPI and the existing server modules for API work.
- Avoid adding Redux, a new frontend framework, a second server framework, or a second message protocol.
- Do not replace working local model integrations with remote PII APIs.
- Add a dependency only when the existing platform or repository code cannot reasonably provide the behavior.

## Privacy Rules

- Treat the browser extension as the privacy enforcement boundary.
- Never send raw names, emails, phone numbers, addresses, government IDs, payment data, passwords, credential values, or unredacted faces to the server.
- Never log raw page content, screenshots, credentials, tokens, or redaction targets.
- Keep raw values and redaction maps client-side unless a future privacy review explicitly changes this rule.
- Fail closed when sanitization, schema validation, or action validation fails.
- The vault exposes capability and field presence, not secret values.

## Safety Rules

- Every server action must match `action.schema.json`.
- Critical actions require a distinct user approval event immediately before execution.
- Do not bypass authentication, CAPTCHA, paywalls, rate limits, or security controls.
- Do not execute arbitrary JavaScript supplied by the server.
- Restrict actions to the registered agent tab and reject stale or mismatched tab IDs.
- Use idempotency keys or step IDs where the existing protocol supports them.
- Stop after repeated verification failures and surface a useful error.

## Coding Style

- Preserve the repository's existing module boundaries and public message shapes.
- Use descriptive names; avoid one-letter variables and unexplained abbreviations.
- Keep functions small enough to test in isolation.
- Prefer explicit data transformations over hidden mutation.
- Validate inputs at boundaries and return structured errors.
- Keep comments rare and reserved for non-obvious reasoning.
- Use ASCII by default in source and documentation.
- Avoid unrelated refactors, formatting churn, and speculative abstractions.

## Error Handling

- Use typed or structured error categories such as validation, privacy, transport, model, execution, approval, and verification errors.
- Include a stable error code and safe user-facing message.
- Do not expose stack traces, prompts, raw model output, or sensitive payloads to the user or logs.
- Preserve enough sanitized context to reproduce failures with fixtures.
- Retry only transient transport/model failures, with bounded backoff.
- Do not retry irreversible actions automatically.

## Testing Requirements

- Add fixture-based tests for every shared schema change.
- Test positive and negative PII cases, overlapping regions, malformed inputs, and already-redacted values.
- Test that critical actions are blocked without approval.
- Test action execution and post-action verification independently from model calls.
- Keep model-dependent tests optional and provide deterministic fakes for normal CI.
- Run the narrowest relevant test or validation command after each change.

## What AI Must Not Do

- Do not invent files, endpoints, permissions, schemas, or model capabilities without documenting the decision.
- Do not silently change a shared contract.
- Do not commit secrets, model weights, credentials, or user fixtures containing real PII.
- Do not make server-side access to raw browser data a fallback for missing client logic.
- Do not disable redaction, approval gates, schema validation, or tab isolation to make a demo pass.
- Do not claim a feature is complete without a test or verified manual path.
- Do not modify unrelated user changes in a dirty worktree.
