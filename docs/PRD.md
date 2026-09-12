# Product Requirements Document

## Product

**iSIH Privacy-Preserving Vision Browser Agent** is a browser extension and backend that carries out multi-step web tasks for a user while keeping personal data on the user's device.

## Core Problem

Browser automation agents need page content, screenshots, and form values to plan actions. Sending this context to a remote model can expose names, contact details, government identifiers, payment data, passwords, and faces. Users need useful automation without giving a server raw private information or allowing an agent to perform high-impact actions without consent.

## Target Users

- People who want help with repetitive web research, shopping, and form workflows.
- Users who handle sensitive personal or financial information in the browser.
- Evaluators and developers testing privacy-preserving agent behavior.
- The Smart India Hackathon PS26171 demonstration team and reviewers.

## Main Features

### Task Execution

- Accept a natural-language task in the popup or side panel.
- Plan multi-step workflows such as search, comparison, form filling, and checkout preparation.
- Execute clicks, typing, navigation, waits, and tab-scoped actions.
- Verify page state after each action and recover or re-plan when needed.

### Local Privacy Protection

- Extract semantic DOM context locally.
- Detect structured PII with deterministic regular expressions.
- Detect contextual entities with local NER.
- Detect text embedded in screenshots with local OCR.
- Detect faces locally.
- Redact DOM values and screenshot regions before sending context to the server.
- Keep raw values and the redaction map on the device.

### Safety And Approval

- Classify actions as safe, cautionary, or critical.
- Ask for approval before login, purchase, deletion, submission, or other irreversible actions.
- Fill credentials only from the encrypted local vault; the server receives field availability, never values.
- Restrict execution to an agent-owned tab and avoid unrelated user tabs.

### Vision And Recovery

- Use local vision context to describe page state.
- Use server-side visual grounding only with sanitized screenshots.
- Detect obstacles such as popups, cookie banners, login walls, and CAPTCHA pages.
- Retry, wait, verify, or request a new plan when an action fails.

## Success Criteria

- A representative task completes end to end: user request -> sanitized context -> plan -> approved actions -> verified completion.
- No raw configured PII value or unredacted sensitive screenshot region is sent to the backend in privacy test cases.
- The six shared contracts in `schemas/` validate messages exchanged by the client and server.
- Critical actions cannot execute without an explicit user approval event.
- The agent remains scoped to its registered task tab.
- The demo remains usable when the preferred WebGPU path is unavailable and a documented fallback is selected.
- Privacy detection and redaction are measured with fixture-based precision and recall tests.

## Out Of Scope

- Fully unsupervised purchases, account changes, or destructive actions.
- Storing raw user credentials or PII on the server.
- Bypassing CAPTCHA, authentication, paywalls, or website security controls.
- Training foundation models on user pages or task data.
- A general-purpose browser replacement.
- Production-grade multi-tenant hosting, billing, or enterprise administration.
- Voice input/output unless explicitly added as a later decision.
- Guaranteed support for every browser or website in the first release.

## Constraints

- The extension is the privacy boundary; sanitization must happen before network serialization.
- The backend must consume structured sanitized payloads and return structured actions.
- The initial server deployment targets Python 3.11+ and a development GPU environment such as a Colab T4.
- Chrome support is the initial assumption; Firefox support remains an open scope decision.
