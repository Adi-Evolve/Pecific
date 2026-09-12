# Dev 5 — Server / LLM Planning Module: Rules

## Libraries to Use

| Purpose | Library | Rationale |
|---|---|---|
| Web framework | FastAPI | Team standard; async-native; WebSocket support built-in |
| Schema validation | Pydantic v2 | All message payloads validated via models, never hand-rolled JSON parsing |
| Async HTTP client | httpx | Async-friendly for VLM server calls; not `requests` |
| Prompt templating | Jinja2 or Python f-strings | For the planner prompt template |
| LLM loading | `transformers` + `bitsandbytes` or `autoawq` | 4-bit quantization for Qwen3-14B on T4 |
| Persistence | `sqlite3` (stdlib) | Session memory storage |

## Libraries to Avoid

| Library | Reason |
|---|---|
| Flask | Team standardized on FastAPI |
| `requests` | Not async-compatible; use `httpx` instead |
| Flash Attention 2 | T4 GPU lacks Ampere+ architecture; will crash or silently degrade. Must be disabled in model loading config. |
| Any hand-rolled JSON validation | Always use Pydantic models |

## Coding Style

- **Type-hint everything**: all function signatures, return types, and Pydantic model fields must have type annotations.
- **One module = one responsibility**: `planner.py` does prompt building + LLM call + parsing. `protocol_engine.py` does classification. `vlm_client.py` does VLM HTTP calls. Never mix these.
- **Pydantic models for all message payloads**: never pass raw `dict` between modules for structured data.
- **Match folder/file names exactly** as specified in ARCHITECTURE.md. Do not invent alternative names.

## Error Handling

### LLM Output Validation
1. Every LLM output is validated against `action.schema.json` immediately after generation.
2. On invalid JSON: retry **once** with a corrective follow-up prompt:
   ```
   Your last output was invalid JSON. Output ONLY valid JSON matching this schema:
   {schema}
   ```
3. On second failure: emit `ERROR` to the extension. Do not guess or partially execute.

### Error Code Routing (per `COMMUNICATION_SPEC.md` §6.2)

| Error Code | Server Action |
|---|---|
| `SELECTOR_NOT_FOUND` | Call VLM `/ground` → dispatch click via coordinates (`HYBRID` mode) |
| `ELEMENT_OBSCURED` | Call VLM `/detect-obstacles` → dispatch `DISMISS_POPUP` on close button |
| `CAPTCHA_TRIGGERED` | Emit `CAPTCHA_HANDOFF` → pause agent, notify user |
| `PAGE_TIMEOUT` | Emit `WAIT(3000)` then retry step with refreshed DOM snapshot |
| `AUTH_REQUIRED` | Emit `APPROVAL_REQUIRED` → pause pipeline |

### General Error Principles
- Never silently swallow errors. Every exception must either be retried (with backoff), reported to the extension via `ERROR`, or trigger a self-correction path.
- Log errors with enough context to debug, but **never log PII values**.

## Naming Conventions

- **Message `type` strings**: `UPPER_SNAKE_CASE` exactly as listed in the message catalog (e.g., `USER_QUERY`, `APPROVAL_REQUIRED`). Never invent a new message type without flagging it to the team.
- **File names**: match the folder structure in ARCHITECTURE.md exactly.
- **Schema field names**: use `snake_case` in Python (Pydantic models), matching the TypeScript schema definitions.

## Hard "Must Never" Rules (Non-Negotiable)

1. **NEVER log, print, or persist a real PII value.** The DOM snapshot and screenshot received are already redacted. Treat any `[TOKEN]`-style placeholder as opaque. Do not attempt to "decode" or infer the real value behind a token.

2. **NEVER let the LLM's prompt include vault field VALUES — only the vault MANIFEST (which fields exist as booleans).** If a plan step needs vault data, emit `TYPE_FROM_VAULT` and let the extension fill it locally.

3. **NEVER dispatch a CRITICAL-classified step without a preceding `APPROVAL_REQUIRED` → `APPROVAL_RESPONSE` round trip.** This is the core privacy guarantee — no purchase, login, delete, or payment action executes without explicit user consent.

4. **NEVER let the LLM output plain English instead of JSON.** This is rule #1 in the prompt template. Enforce it via parsing/retry logic, not just by requesting it in the prompt.

5. **NEVER attempt to solve a CAPTCHA server-side.** Always emit `CAPTCHA_HANDOFF` and let the user solve it manually.

6. **NEVER edit files outside the `server/` folder.** If new logic is needed in a file another dev owns, create a new file that gets imported instead.

7. **NEVER create long-lived branches.** Use short-lived `feat/dev5-<module>` branches, merge daily.

8. **NEVER change a frozen schema in `/schemas/` without first notifying the team.** Schema changes are the single most likely thing to silently break someone else's work.
