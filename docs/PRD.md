# PrivacyLens — Product Requirements Document (PRD)

## 1. Executive Summary
**Problem Statement:** Smart India Hackathon (SIH) Problem Statement **PS26171**: *On-device Visual Perception for Light-weight Browser Agents*.  
**Product Name:** **PrivacyLens** (Pecific Browser Agent)  
**Vision:** An enterprise-grade, privacy-preserving browser extension agent that automates complex web workflows by executing visual perception, sensitive data detection, and PII redaction **entirely on-device** (client-side in the browser), sending only structurally preserved, sanitized DOM representations and redacted screenshots to a lightweight cloud reasoning server.

---

## 2. Core Problem & Motivation
Modern web agents typically capture raw screenshots and complete DOM trees, streaming them directly to multimodal cloud models (e.g., GPT-4o, Claude 3.5 Sonnet, Gemini Pro). This architecture introduces severe compliance, legal, and privacy risks:
- **Credential Egress:** Passwords, OTPs, session tokens, and PINs are transmitted in plain text or raw pixels.
- **Regulatory Violations:** Leaks personal identifiable information (PII) under GDPR, India's DPDP Act 2023, and HIPAA (Aadhaar, PAN, emails, phone numbers, medical records, financial cards).
- **Latency & Cost Overhead:** Streaming high-resolution, uncompressed video/screenshots over the wire increases round-trip latency and token costs.

**The PrivacyLens Solution:**
1. **On-Device Vision:** Run lightweight vision models (**TinyViT / MobileViT** and **BlazeFace**) via WebGPU / ONNX Runtime Web directly within the browser worker.
2. **On-Device Privacy Engine:** A 4-stage pipeline (Regex, NER, DOM heuristics, OCR fallback) that tokenizes sensitive data into semantic handles (e.g., `[EMAIL_1]`, `[PASSWORD_FIELD]`, `[CARD_1]`, `[OTP_1]`).
3. **Visual Blackout Guarantee:** Overlays solid black (`#000000`) fill rectangles over all faces, avatars, and sensitive text regions before any image data leaves the device.
4. **DOM Structural Invariance:** Sanitizes element text and `<input value="...">` attributes without modifying tag names, hierarchy, coordinates, or CSS selectors, allowing server agents to ground actions without knowing raw secrets.
5. **Client-Only Local Vault:** The secret-to-token map is isolated strictly in local browser memory and never leaves the client.

---

## 3. Target Users & Personas
1. **Regulated Enterprise Employees (Fintech, Healthcare, Legal):** Workers using web automation on internal dashboards and portals containing highly sensitive client information.
2. **Privacy-Conscious Consumers:** Individuals using AI agents for shopping, job applications, banking, and travel booking without risking password or identity theft.
3. **Enterprise Compliance & Security Officers:** Teams requiring auditable proof that no plaintext PII or facial imagery exits the corporate perimeter.

---

## 4. Main Features & Capabilities

### 4.1 On-Device Visual Perception (Client Vision Worker)
- **Screen Classification:** Classifies current viewport type (`login_auth`, `checkout_cart`, `email_inbox`, `search_results`, `account_settings`) in `< 30ms`.
- **Biometric & Face Redaction:** Detects human faces and personal avatar images (Google account avatars, profile photos, browser icons) and blacks them out.
- **Layout & Visual Grounding:** Identifies interactive buttons, banners, and modal overlays for multi-modal agent alignment.

### 4.2 On-Device Privacy Engine (Client Privacy Worker)
- **Multi-Category PII Detection:**
  - *SPII (Strict):* Aadhaar (12 digits with Verhoeff/checksum), PAN (Indian tax ID), Credit/Debit Cards (Luhn verified), Passwords (`[PASSWORD_FIELD]`).
  - *PII (Standard):* Personal Emails, Phone Numbers (Indian 10-digit / international), Names, UPI IDs (`user@provider`).
  - *Contextual:* Dates of Birth (`DOB`), Addresses / PIN codes, Passports, IFSC codes, IPv4 addresses.
- **Page-Wide Token Deduplication:** Uniformly assigns identical tokens to identical values appearing across multiple DOM nodes.
- **Incremental Scanning:** Re-scans only newly added or modified elements during multi-step execution loops in `< 25ms`.
- **Client-Only Vault:** Stores token-to-secret mapping securely in memory for local autofill.

### 4.3 Structural Invariance & Server Semantics
- **Attribute Preservation:** Preserves `id`, `tag`, `type`, `role`, `selector`, `coordinates`, and `interactive` flags.
- **Server Knowledge Without Raw Data:** Payload contains `is_redacted: true`, `redacted_types: [...]`, `redacted_tokens: [...]`, and a structured `token_manifest` (`tokens_used`, `token_types`, `redacted_elements`).
- **Autofill Roundtrip:** When the server returns `fill(selector, value="[EMAIL_1]")`, the client resolves `[EMAIL_1]` locally to the real secret before dispatching the DOM event.

---

## 5. Success Criteria & KPIs

| Metric | Target | Actual Benchmark |
| :--- | :--- | :--- |
| **PII Detection Recall** | > 95% across test datasets | 100% on unit & adversarial test suites |
| **False Positive Rate** | < 3% on clean e-commerce pages | 0% (rejects order IDs, prices, SKUs) |
| **DOM Structure Integrity** | 100% element count & selector invariance | 100% verified by 45 server contract tests |
| **Raw PII Server Leakage** | 0 bytes transmitted | 0 bytes leaked across all payloads |
| **Visual Blackout Accuracy** | 100% coverage on faces, avatars, credentials | Pixel-perfect alignment verified on real screenshots |
| **Client Processing Latency** | < 100ms full scan, < 25ms incremental | < 35ms on synthetic & real pages |

---

## 6. Out of Scope (Version 1.0)
- End-to-end multi-tenant server orchestration (hosted SaaS multi-region deployment).
- Support for non-Chromium browsers (Firefox/Safari specific manifest v2 APIs).
- Audio and continuous video stream redaction (static screenshot + incremental canvas only).
