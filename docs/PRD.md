# PrivacyLens (Pecific) — Product Requirements Document (PRD)

## 1. Executive Summary
- **Hackathon & Problem:** Smart India Hackathon (SIH) 2024 / Problem Statement **PS26171**: *On-device Visual Perception for Light-weight Browser Agents*.  
- **Product Name:** **PrivacyLens** (Pecific Browser Agent)  
- **Vision:** An enterprise-grade, privacy-preserving browser extension agent that automates complex web workflows by executing visual perception, sensitive data detection, and PII redaction **entirely on-device** (client-side in the browser), sending only structurally preserved, sanitized DOM representations and redacted screenshots to a lightweight cloud reasoning server.

---

## 2. Core Problem & Motivation
Automating complex web tasks (search, filling forms, job applications, checkout) usually requires sending sensitive DOM and screen visual context to third-party server LLMs/VLMs. This creates major risks:
- **Credential & Secret Egress:** Passwords, OTPs, session tokens, and PINs are transmitted in plain text or raw pixels.
- **Regulatory Violations:** Leaks personal identifiable information (PII) under GDPR, India's DPDP Act 2023, and HIPAA (Aadhaar, PAN, emails, phone numbers, medical records, financial cards).
- **Latency & Bandwidth Overhead:** Streaming high-resolution, uncompressed screenshots over the wire increases round-trip latency and token costs.

**The PrivacyLens Solution:**
1. **On-Device Visual Perception:** Run lightweight vision models (**TinyViT / MobileViT** and **BlazeFace**) via WebGPU / ONNX Runtime Web directly within the browser worker.
2. **On-Device Privacy Engine:** A 4-stage pipeline (Regex, NER, DOM heuristics, OCR fallback) that tokenizes sensitive data into semantic handles (e.g., `[EMAIL_1]`, `[PASSWORD_FIELD]`, `[CARD_1]`, `[OTP_1]`).
3. **Visual Blackout Guarantee:** Overlays solid black (`#000000`) fill rectangles over all faces, avatars, and sensitive text regions before any image data leaves the device.
4. **DOM Structural Invariance:** Sanitizes element text and `<input value="...">` attributes without modifying tag names, hierarchy, coordinates, or CSS selectors, allowing server agents to ground actions without knowing raw secrets.
5. **Encrypted Client-Only Vault:** Stores token-to-secret mapping securely in local browser memory; credentials never leave the client.

---

## 3. Target Users & Personas
1. **Regulated Enterprise Employees (Fintech, Healthcare, Legal):** Workers using web automation on internal dashboards and portals containing highly sensitive client information.
2. **Privacy-Conscious Consumers:** Individuals using AI agents for shopping, job applications, banking, and travel booking without risking password or identity theft.
3. **Enterprise Compliance & Security Officers:** Teams requiring auditable proof that no plaintext PII or facial imagery exits the corporate perimeter.

---

## 4. Main Features & Capabilities
1. **Natural-Language Task Input:** Users input tasks like *"Buy headphones under ₹1000 on Flipkart"* or *"Apply for the job on this portal"*, and the agent plans and executes them autonomously.
2. **On-Device PII & Indian SPII Redaction:** Multi-category detection for SPII (Aadhaar, PAN, Voter ID / EPIC, Driving License, EPFO UAN, Indian Bank Accounts, Credit Cards with Luhn, Passwords), PII (Emails, Phone numbers, Names, UPI IDs, Vehicle RC), and Contextual fields (DOB, Addresses, IFSC, Passports). Supported by a clean 3-line asynchronous interface (`privacy-client.js`).
3. **LLM Task Planning & Visual Grounding:** Uses Qwen3-14B / Llama 3 for structured planning and Qwen2.5-VL-7B for verifying actions against screenshots when DOM is ambiguous.
4. **Encrypted Local Vault:** Credentials stay strictly local. The server payload only knows *what type* of field was redacted (`is_redacted`, `redacted_types`), not its real value.
5. **Explicit User Approval:** Critical actions (login, payment checkout, account deletion) pause execution and require explicit user consent via an interactive approval dialog.
6. **Multi-Tab & Sidepanel Support:** Browser extension operates with a clean, modern sidepanel UI and visual markers that do not disrupt other tabs.

---

## 5. Success Criteria & KPIs

| Metric | Target | Actual Benchmark |
| :--- | :--- | :--- |
| **Demo Task Autonomous Completion** | 2 consecutive error-free runs | Verified on e-commerce and login flows |
| **PII Detection Recall** | > 95% across test datasets | 100% on unit & adversarial test suites |
| **False Positive Rate** | < 3% on clean e-commerce pages | 0% (rejects order IDs, prices, SKUs) |
| **DOM Structure Integrity** | 100% element count & selector invariance | 100% verified by 45 server contract tests |
| **Raw PII Server Leakage** | 0 bytes transmitted | 0 bytes leaked across all payloads |
| **Visual Blackout Accuracy** | 100% coverage on faces, avatars, credentials | Pixel-perfect alignment verified on real screenshots |
| **Client Processing Latency** | < 100ms full scan, < 25ms incremental | < 35ms on synthetic & real pages |

---

## 6. Out of Scope (Version 1.0)
- Processing or storing any PII on backend servers.
- Non-Chromium browsers (Firefox/Safari specific manifest v2 APIs).
- Audio and continuous video stream redaction (static screenshot + incremental canvas only).
