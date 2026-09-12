# Project Requirements Document (PRD)

## Product Brief
**Product Name:** iSIH Privacy-Preserving Browser Agent
**Core Problem:** Automating complex web tasks (search, filling forms, checkout) usually requires sending sensitive DOM/screen data to third-party servers. Users want agentic automation without compromising personal data (PII).
**Target Users:** Privacy-conscious individuals and enterprises needing secure web automation.

## Main Features
1. **Natural-Language Task Input:** Users can input tasks like "Buy headphones under ₹1000 on Flipkart" and the agent executes them autonomously.
2. **On-Device PII Redaction:** Sensitive info (emails, names, Aadhaar, PAN, faces) is detected and redacted *locally* using Regex, NER, OCR, and Face Detection before any data leaves the browser.
3. **LLM Task Planning & Visual Grounding:** Uses Qwen3-14B for planning and Qwen2.5-VL-7B for verifying actions against screenshots.
4. **Encrypted Local Vault:** Credentials are saved locally. The server only knows *if* a field exists, not its value.
5. **Explicit User Approval:** Critical actions (login, checkout, deletion) pause execution and require explicit user consent.
6. **Multi-Tab Support:** Agent operates with visual markers and doesn't interfere with user's other tabs.

## Success Criteria
- The system can complete the demo task ("Buy headphones under ₹1000 on Flipkart") autonomously, twice in a row, without errors.
- Zero PII leaks to the server (100% precision/recall on redaction test sets).
- Latency remains acceptable (DOM extraction <50ms, PII scan <300ms, client models <100MB).

## Out of Scope
- Processing or storing any PII on the backend server.
- Supporting browsers outside of Chromium-based browsers initially.
