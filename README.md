# iSIH — Privacy-Preserving Vision Browser Agent

A browser extension + backend server that autonomously completes web tasks (search, fill forms, compare products, checkout) on the user's behalf — while keeping all personal data on-device. Sensitive information (names, emails, phone numbers, Aadhaar/PAN, credit cards, faces) is detected and redacted locally before anything is sent to the server, so the backend never sees raw personal data.

Built for Smart India Hackathon, Problem Statement PS26171.

## Features

- Natural-language task input ("Buy headphones under ₹1000 on Flipkart") → autonomous multi-step execution
- On-device PII detection and redaction (regex, NER, face detection, OCR) — nothing sensitive leaves the browser
- LLM-based task planning with visual grounding via a VLM for on-screen verification
- Explicit user approval required before any sensitive action (logins, purchases, deletions)
- Encrypted local credential vault — the server only knows *which* fields exist, never their values
- Multi-tab agent support with visual markers, so the agent never touches the user's other tabs
- Error recovery, smart waiting, and session memory across related tasks

## Tech Stack

- **Extension:** Chrome Manifest V3, JavaScript/TypeScript, ONNX Runtime Web (WebGPU), Transformers.js, Tesseract.js
- **Server:** Python 3.11+, FastAPI, Qwen3-14B (planning), Qwen2.5-VL-7B (visual grounding)
- **Dev deployment:** Google Colab (T4 GPU) + ngrok

## Project Structure

```
extension/   Chrome/Firefox extension (client)
server/      FastAPI backend (LLM + VLM)
schemas/     Shared data contracts between client and server
fixtures/    Sample data for local development and testing
docs/        Project documentation
```

## Getting Started

### Extension

```bash
cd extension
npm install
npm run build
```

Then load the `extension/dist` folder as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked).

### Server

```bash
cd server
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Server config (model paths, ngrok URL, etc.) lives in `server/config.py`.

## Documentation

- [`docs/PRD.md`](docs/PRD.md) — what we're building and why
- [`docs/Architecture.md`](docs/Architecture.md) — system design and data flow

## License

TBD.