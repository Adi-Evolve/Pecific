# 📡 PrivacyLens Communication Specification & Data Dictionary
**SIH Problem Statement PS26171: On-Device Visual Perception for Light-Weight Browser Agents**

---

## 1. Architectural Overview & Security Guarantees

PrivacyLens employs a **Single-Link Orchestration Architecture** with strict on-device privacy boundaries:
1. **Chrome Extension (Browser Client)**:
   - **On-Device Vision Worker**: Runs lightweight Vision Transformer (**TinyViT / MobileViT-XXS**) and **BlazeFace** in a Web Worker (via WebGPU / ONNX Runtime Web). Produces a structured `vision_context` (`screen_type`, `layout`, `detected_regions`, `faces_detected`, `visual_pii_regions`).
   - **On-Device Privacy Worker**: Sanitizes DOM and masks PII locally into synthetic tokens (`[PAN_1]`, `[AADHAAR_1]`, `[PHONE_1]`, `[EMAIL_1]`). Blurs detected faces and visual PII regions on-device via Canvas 2D / WebGPU before anything leaves the browser.
   - **Local Credential Vault**: Stores encrypted passwords; secrets are **never sent to the cloud**.
   - Maintains a single WebSocket connection to the LLM Planning Server (`wss://<llm-ngrok>.ngrok-free.app/ws`).
2. **Notebook 1: LLM Planning Server (Qwen2.5-7B via Ollama / FastAPI)**:
   - Central reasoning brain and session manager.
   - Consumes both **`sanitized_dom`** and client-generated **`vision_context`** (`screen_type`).
   - Generates structured Plans with Chain-of-Thought (CoT) cross-verifying DOM elements with the visual state.
   - Directly calls the VLM server over high-speed datacenter REST (`https://<vlm-ngrok>.ngrok-free.app`) for deep visual grounding when DOM selectors fail or visual verification is requested.
3. **Notebook 2: VLM Perception Server (Qwen2.5-VL-7B-Instruct / FastAPI)**:
   - Deep vision-language grounding (maps visual elements to `[x, y]` pixel coordinates).
   - Dynamic obstacle detection (detects popups, cookie consent walls, CAPTCHAs).
   - Post-action visual verification (confirms page state transitions).

---

## 2. Standard Message Envelopes

### 2.1 WebSocket Envelope (Extension $\longleftrightarrow$ LLM Server)
All WebSocket communications follow a strictly typed envelope:

```typescript
interface WebSocketMessage<T = any> {
  type: string;             // Action or event verb (e.g., "USER_QUERY", "PLAN")
  session_id: string;       // Unique session identifier (e.g., "sess_1726051200_abc")
  client_timestamp?: number;// Milliseconds since Unix epoch
  payload: T;               // Data specific to the message type
}
```

### 2.2 Client-Side `vision_context` Schema (Satisfies the 25% Visual Context Criteria)
Generated on-device by **TinyViT/MobileViT + BlazeFace** and sent in every `USER_QUERY` and `STEP_RESULT`:

```json
{
  "screen_type": "search_results",
  "confidence": 0.94,
  "layout": {
    "visual_density": "high",
    "has_active_modal": false,
    "has_sticky_footer": true,
    "canvas_heavy": false
  },
  "detected_regions": [
    { "type": "search_bar", "bbox": [320, 20, 620, 40] },
    { "type": "filter_sidebar", "bbox": [20, 80, 220, 700] },
    { "type": "product_grid", "bbox": [260, 80, 1260, 700] }
  ],
  "faces_detected": [
    { "bbox": [400, 120, 480, 200], "confidence": 0.97 }
  ],
  "visual_pii_regions": [
    { "type": "face", "bbox": [400, 120, 480, 200] }
  ]
}
```

---

## 3. Complete Message Catalog

### 3.1 Client $\longrightarrow$ Server Messages

| Message `type` | Direction | Description | Trigger |
|---|---|---|---|
| `USER_QUERY` | Extension $\to$ Server | User goal + `sanitized_dom` + `vision_context` + `vault_manifest` + `redacted_screenshot` | User submits prompt |
| `STEP_RESULT` | Extension $\to$ Server | Execution result, error diagnostics, post-step URL, updated `vision_context`, redacted screenshot | After each action execution |
| `APPROVAL_RESPONSE` | Extension $\to$ Server | User's approval decision for critical/financial actions | User clicks Approve/Deny |
| `SESSION_RESTORE` | Extension $\to$ Server | Requests session recovery and memory synchronization | Reconnecting after disconnect |
| `PAUSE_AGENT` | Extension $\to$ Server | Temporarily suspends action dispatch | User clicks Pause |
| `RESUME_AGENT` | Extension $\to$ Server | Resumes action dispatch from current step | User clicks Resume |
| `STOP_AGENT` | Extension $\to$ Server | Aborts task, cancels pending steps, resets state | User clicks Stop |

### 3.2 Server $\longrightarrow$ Client Messages

| Message `type` | Direction | Description | Trigger |
|---|---|---|---|
| `PLAN` | Server $\to$ Extension | Full multi-step DAG with Chain-of-Thought and protocol levels | Generated upon `USER_QUERY` |
| `NEXT_STEP` | Server $\to$ Extension | Dispatches the next executable action step | Prior step completed successfully |
| `APPROVAL_REQUIRED`| Server $\to$ Extension | Halts pipeline and requests explicit user permission | Next step is `CRITICAL` (e.g. login, payment) |
| `DYNAMIC_OBSTACLE` | Server $\to$ Extension | Notifies extension of popup, modal, or CAPTCHA detected | VLM spots an obscuring element |
| `SESSION_RESTORED` | Server $\to$ Extension | Returns active plan, completed steps, and session memory | Received `SESSION_RESTORE` |
| `TASK_COMPLETE` | Server $\to$ Extension | Final summary report and extracted structured data | All steps executed successfully |
| `ERROR` | Server $\to$ Extension | Unrecoverable error notification | Self-correction retries exhausted |

### 3.3 LLM Server $\longleftrightarrow$ VLM Server Endpoints

| Endpoint | Method | Purpose | Typical Latency |
|---|---|---|---|
| `/health` | `GET` | Probe VRAM usage and model readiness | ~15 ms |
| `/detect-obstacles` | `POST` | Identify popups, cookie consent overlays, login walls, CAPTCHAs | ~900 ms |
| `/ground` | `POST` | Find precise `[x, y]` pixel coordinates for buttons or inputs | ~1.2 s |
| `/verify` | `POST` | Check whether a visual condition is met post-execution | ~800 ms |
| `/analyze` | `POST` | General multi-modal image + text reasoning | ~1.1 s |

---

## 4. End-to-End Scenarios & Wire Payloads

---

### Scenario 1: E-Commerce Search & Multitasking (DOM + Visual Context Ingest)
*User prompt: "Search Sony WH-1000XM5 on Amazon, filter 4 stars & above, and extract top prices."*

#### Step 1.1: Extension sends `USER_QUERY` (With On-Device `vision_context`)
```json
{
  "type": "USER_QUERY",
  "session_id": "sess_ecom_001",
  "client_timestamp": 1726052000100,
  "payload": {
    "query": "Search Sony WH-1000XM5 on Amazon, filter 4 stars & above, and extract top prices.",
    "current_url": "https://www.amazon.in",
    "page_title": "Online Shopping site in India: Shop Online for Mobiles, Books, Watches...",
    "viewport": { "width": 1280, "height": 720, "scroll_x": 0, "scroll_y": 0 },
    "vision_context": {
      "screen_type": "dashboard_home",
      "confidence": 0.95,
      "layout": {
        "visual_density": "high",
        "has_active_modal": false,
        "has_sticky_footer": false,
        "canvas_heavy": false
      },
      "detected_regions": [
        { "type": "search_header", "bbox": [0, 0, 1280, 60] },
        { "type": "promo_banner", "bbox": [0, 60, 1280, 320] },
        { "type": "category_grid", "bbox": [50, 340, 1230, 700] }
      ],
      "faces_detected": [],
      "visual_pii_regions": []
    },
    "sanitized_dom": {
      "elements_count": 2,
      "elements": [
        {
          "id": "e_search",
          "tag": "INPUT",
          "selector": "#twotabsearchtextbox",
          "placeholder": "Search Amazon.in",
          "type": "text",
          "interactive": true,
          "role": "searchbox",
          "coordinates": [320, 24, 600, 38]
        },
        {
          "id": "e_submit",
          "tag": "INPUT",
          "selector": "#nav-search-submit-button",
          "value": "Go",
          "type": "submit",
          "interactive": true,
          "coordinates": [925, 24, 45, 38]
        }
      ]
    },
    "vault_manifest": {
      "has_email": true,
      "has_password": true,
      "has_phone": true
    },
    "redacted_screenshot": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBD...",
    "privacy_stats": {
      "faces_redacted": 0,
      "pii_tokens_masked": 0,
      "dom_masked_fields": 0
    }
  }
}
```

#### Step 1.2: How the LLM Planner Ingests and Uses `vision_context`
In the LLM Server's prompt synthesis:
```text
USER GOAL: Search Sony WH-1000XM5 on Amazon, filter 4 stars & above, and extract top prices.
URL: https://www.amazon.in | Title: Amazon.in

ON-DEVICE VISUAL CONTEXT (TinyViT WebGPU):
- Screen Type: dashboard_home (Confidence: 0.95)
- Active Modal Detected: False
- Canvas-Heavy (WebGL/SVG): False
- Layout Regions: search_header, promo_banner, category_grid

DOM SNAPSHOT (2 interactive elements):
[e_search] <INPUT> ph="Search Amazon.in" sel="#twotabsearchtextbox" ⚡
[e_submit] <INPUT> 'Go' sel="#nav-search-submit-button" ⚡

Generate execution plan as JSON.
```

#### Step 1.3: LLM Server returns `PLAN` (with Chain-of-Thought referencing visual context)
```json
{
  "type": "PLAN",
  "session_id": "sess_ecom_001",
  "payload": {
    "plan": {
      "goal": "Search Sony WH-1000XM5 on Amazon, filter 4 stars, extract prices",
      "chain_of_thought": "1. Visual context confirms screen_type is 'dashboard_home'. Search header is visible at top. 2. DOM contains searchbox (#twotabsearchtextbox). Type query and press Enter. 3. Post-navigation screen_type should transition to 'search_results'. 4. Apply 4-star filter. 5. Extract top deals.",
      "total_steps": 5,
      "steps": [
        {
          "id": 1,
          "action": "TYPE",
          "target": { "selector": "#twotabsearchtextbox", "element_id": "e_search" },
          "value": "Sony WH-1000XM5",
          "execution_mode": "DOM",
          "protocol_level": "SAFE",
          "description": "Type search term into Amazon search box",
          "verify": { "method": "DOM_CHECK", "condition": "value_matches" },
          "timeout_ms": 5000
        },
        {
          "id": 2,
          "action": "PRESS_KEY",
          "target": { "selector": "#twotabsearchtextbox" },
          "key": "Enter",
          "execution_mode": "DOM",
          "protocol_level": "SAFE",
          "description": "Submit search form",
          "verify": { "method": "URL_CHECK", "condition": "url_contains('/s?k=')" },
          "timeout_ms": 8000
        },
        {
          "id": 3,
          "action": "WAIT",
          "duration_ms": 2000,
          "protocol_level": "SAFE",
          "description": "Wait for search results to load"
        },
        {
          "id": 4,
          "action": "CLICK",
          "target": { "selector": "section[aria-label='4 Stars & Up'] a", "text": "4 Stars & Up" },
          "execution_mode": "HYBRID",
          "protocol_level": "CAUTION",
          "description": "Apply 4 stars & above customer rating filter",
          "verify": { "method": "DOM_CHECK", "condition": "element_checked" },
          "timeout_ms": 8000
        },
        {
          "id": 5,
          "action": "EXTRACT",
          "target": { "selector": "div[data-component-type='s-search-result']" },
          "extraction_type": "LIST",
          "selectors": {
            "title": "h2 a span",
            "price": ".a-price .a-offscreen",
            "rating": ".a-icon-alt"
          },
          "amount": 3,
          "protocol_level": "SAFE",
          "description": "Extract title, price, and rating of top 3 products"
        }
      ]
    }
  }
}
```

#### Step 1.4: Extension executes Step 2 (`PRESS_KEY`) and returns `STEP_RESULT` with updated `vision_context`
Notice how the on-device TinyViT detects that the page **transitioned from `dashboard_home` to `search_results`**:

```json
{
  "type": "STEP_RESULT",
  "session_id": "sess_ecom_001",
  "payload": {
    "step_id": 2,
    "action": "PRESS_KEY",
    "status": "success",
    "current_url": "https://www.amazon.in/s?k=Sony+WH-1000XM5",
    "vision_context": {
      "screen_type": "search_results",
      "confidence": 0.96,
      "layout": {
        "visual_density": "high",
        "has_active_modal": false,
        "has_sticky_footer": false,
        "canvas_heavy": false
      },
      "detected_regions": [
        { "type": "results_header", "bbox": [0, 60, 1280, 110] },
        { "type": "filter_rail", "bbox": [20, 120, 240, 720] },
        { "type": "product_grid", "bbox": [260, 120, 1260, 720] }
      ],
      "faces_detected": [],
      "visual_pii_regions": []
    },
    "result": {
      "key_dispatched": "Enter",
      "navigated": true
    },
    "redacted_screenshot": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
  }
}
```

---

### Scenario 2: Secure Form-Filling via Credential Vault (Zero-Knowledge Privacy)
*User prompt: "Log into my account using my stored credentials."*

#### Step 2.1: On-device Vision Worker detects `screen_type: "login_auth"`
The extension dispatches `USER_QUERY` with:
```json
"vision_context": {
  "screen_type": "login_auth",
  "confidence": 0.98,
  "layout": {
    "visual_density": "low",
    "has_active_modal": false,
    "canvas_heavy": false
  },
  "detected_regions": [
    { "type": "auth_card", "bbox": [440, 120, 840, 520] }
  ],
  "faces_detected": [],
  "visual_pii_regions": []
}
```

#### Step 2.2: LLM Server sends `APPROVAL_REQUIRED`
When the planner encounters a sensitive action (`TYPE_FROM_VAULT`), it pauses execution and sends an approval request:

```json
{
  "type": "APPROVAL_REQUIRED",
  "session_id": "sess_auth_002",
  "payload": {
    "step": {
      "id": 2,
      "action": "TYPE_FROM_VAULT",
      "vault_key": "password",
      "target": {
        "selector": "input#ap_password",
        "element_id": "e_pwd"
      },
      "execution_mode": "DOM",
      "protocol_level": "CRITICAL",
      "description": "Autofill password into Amazon login password field"
    },
    "reason": "Filling sensitive authentication password requires user permission",
    "vault_key": "password"
  }
}
```

#### Step 2.3: User approves via Side Panel
```json
{
  "type": "APPROVAL_RESPONSE",
  "session_id": "sess_auth_002",
  "payload": {
    "step_id": 2,
    "action": "TYPE_FROM_VAULT",
    "approved": true,
    "useVault": true,
    "client_timestamp": 1726052120000
  }
}
```

#### Step 2.4: Extension injects password locally & confirms execution
```json
{
  "type": "STEP_RESULT",
  "session_id": "sess_auth_002",
  "payload": {
    "step_id": 2,
    "action": "TYPE_FROM_VAULT",
    "status": "success",
    "current_url": "https://www.amazon.in/ap/signin",
    "vision_context": {
      "screen_type": "login_auth",
      "confidence": 0.98
    },
    "result": {
      "vault_key_used": "password",
      "bytes_injected": 16,
      "input_dispatched": true
    },
    "redacted_screenshot": null
  }
}
```

---

### Scenario 3: Canvas / WebGL Web Apps (Figma / Canva / Google Docs Canvas)
*When DOM contains zero usable input elements, on-device vision detects `canvas_heavy: true`.*

#### Step 3.1: Extension sends `USER_QUERY` with empty DOM but rich `vision_context`
```json
{
  "type": "USER_QUERY",
  "session_id": "sess_canvas_003",
  "payload": {
    "query": "Click on the blue 'Export' button in the design canvas",
    "current_url": "https://www.canva.com/design/DAF...",
    "vision_context": {
      "screen_type": "canvas_workspace",
      "confidence": 0.97,
      "layout": {
        "visual_density": "high",
        "canvas_heavy": true,
        "has_active_modal": false
      },
      "detected_regions": [
        { "type": "canvas_stage", "bbox": [80, 50, 1200, 670] },
        { "type": "top_toolbar", "bbox": [0, 0, 1280, 50] }
      ],
      "faces_detected": [],
      "visual_pii_regions": []
    },
    "sanitized_dom": {
      "elements_count": 0,
      "elements": []
    },
    "redacted_screenshot": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
  }
}
```

#### Step 3.2: LLM Planner detects `canvas_heavy: true` and automatically switches to `VISION` mode
The LLM queries the VLM Server via `POST /ground` to find the pixel coordinates:

```json
// HTTP POST https://vlm-server.ngrok-free.app/ground
{
  "screenshot": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
  "task": "Find the 'Export' or 'Share' action button on the top right toolbar"
}
```

VLM responds with grounded coordinates:
```json
{
  "page_description": "Canva design workspace with top purple banner and share/export options",
  "relevant_elements": [
    {
      "description": "Purple Export button on top right",
      "coordinates": [1190, 24],
      "action": "click"
    }
  ],
  "obstacles": [],
  "next_action": {
    "action": "CLICK",
    "target": { "coordinates": [1190, 24] },
    "reason": "Direct visual match for canvas toolbar action"
  }
}
```

#### Step 3.3: LLM Server returns `NEXT_STEP` in `VISION` mode
```json
{
  "type": "NEXT_STEP",
  "session_id": "sess_canvas_003",
  "payload": {
    "step": {
      "id": 1,
      "action": "CLICK",
      "target": { "coordinates": [1190, 24] },
      "execution_mode": "VISION",
      "protocol_level": "SAFE",
      "description": "Click Export button at canvas coordinates (1190, 24)",
      "verify": { "method": "SCREENSHOT", "condition": "Export dialog opened" }
    }
  }
}
```

---

## 5. How `vision_context` Directly Scores the 25% Visual Context Criterion

In the evaluation rubric for **PS26171 (Smart India Hackathon)**:

| Evaluation Criterion | Weight | How It Is Exercised End-to-End |
|:---|:---:|:---|
| **Accuracy of Visual Context** | **25%** | 1. Client-side **TinyViT/MobileViT** runs in a Web Worker (WebGPU) on every page capture.<br/>2. Emits `screen_type` (`search_results`, `checkout_cart`, `login_auth`, `canvas_workspace`) and layout properties.<br/>3. Transmitted in `USER_QUERY` and `STEP_RESULT`.<br/>4. LLM Planner uses `screen_type` in its Chain-of-Thought (CoT) to decide safety protocols and execution modes (`DOM` vs `VISION`).<br/>5. Cloud VLM (`Qwen2.5-VL-7B`) acts as the secondary grounding tier when DOM selectors fail. |
| **PII Recall & Precision** | **20%** | On-device Regex + DistilBERT-NER masks sensitive text into tokens before network egress. |
| **Redaction Precision** | **20%** | BlazeFace detects faces and blurs identity regions on-device via Canvas 2D / WebGPU. |
| **Task Completion Rate** | **15%** | Self-healing execution with dynamic obstacle dismissal and retry backoffs. |
| **Latency & Resource Use** | **20%** | TinyViT runs in <30ms; Ollama generates plans in ~1s; single-link WebSocket minimizes egress overhead. |

---
*Created for Smart India Hackathon (SIH PS26171) — PrivacyLens Autonomous Browser Agent.*
