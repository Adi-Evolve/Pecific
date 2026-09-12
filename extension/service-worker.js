// extension/service-worker.js
// Integrated with Dev 3 PrivacyLens Engine (3-Line Privacy Helper + Client Vault)

import { 
  sanitizeDOMSnapshot, 
  resolveVaultToken, 
  restoreVaultText, 
  getPrivacyTelemetry, 
  verifyZeroEgress, 
  resetSessionVault 
} from './workers/privacy-client.js';

console.log("iSIH Agent Service Worker Registered with PrivacyLens Engine.");

let currentSessionId = 'session_' + Date.now();

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-sidepanel') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0 && tabs[0].id) {
        chrome.sidePanel.open({ windowId: tabs[0].windowId }).catch(console.error);
      }
    });
  }
});

// ─── WebSocket Client Integration (Phase 4) ──────────────────────────────────
let ws = null;
const WS_URL = 'ws://localhost:8000/ws/browser-agent';

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  
  console.log('[SW] Connecting to WebSocket:', WS_URL);
  ws = new WebSocket(WS_URL);
  
  ws.onopen = () => {
    console.log('[SW] WebSocket connected to server.');
  };
  
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      console.log('[SW] Received from Server:', msg.type);
      handleServerMessage(msg);
    } catch (e) {
      console.error('[SW] Failed to parse server message:', e);
    }
  };
  
  ws.onclose = () => {
    console.log('[SW] WebSocket closed. Will reconnect on next action.');
    ws = null;
  };
  
  ws.onerror = (err) => {
    console.error('[SW] WebSocket error:', err);
  };
}

function sendToServer(message) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    connectWebSocket();
    // Wait briefly for connection
    setTimeout(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      } else {
        console.warn('[SW] WebSocket not open, dropping message:', message.type);
      }
    }, 1000);
  } else {
    ws.send(JSON.stringify(message));
  }
}

async function handleServerMessage(msg) {
  switch (msg.type) {
    case 'PLAN':
      console.log('[SW] New Plan received:', msg.payload?.goal);
      chrome.runtime.sendMessage({
         type: 'UPDATE_ETA',
         payload: { goal: msg.payload?.goal, steps: msg.payload?.plan?.total_steps || 3 }
      }).catch(()=>{});
      break;
    case 'NEXT_STEP':
      console.log('[SW] Executing Next Step:', msg.payload?.step?.action);
      // Route to Dev 2 content script
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'EXECUTE_ACTION',
            payload: msg.payload
          });
        }
      });
      break;
    case 'APPROVAL_REQUIRED':
      console.log('[SW] Approval Required for:', msg.payload?.description);
      chrome.runtime.sendMessage({
        type: 'APPROVAL_REQUIRED',
        payload: msg.payload
      }).catch(err => {
        console.warn('[SW] Could not broadcast APPROVAL_REQUIRED to UI:', err);
      });
      break;
    case 'TASK_COMPLETE':
      console.log('[SW] Task Complete:', msg.payload?.summary);
      chrome.notifications.create({
        type: 'basic',
        title: 'Pecific Agent',
        message: 'Task Complete: ' + (msg.payload?.summary || 'Goal achieved.'),
        iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
      });
      break;
    default:
      console.warn('[SW] Unknown server message type:', msg.type);
  }
}

// Ensure connection is active
connectWebSocket();


// ─── Broadcast Telemetry to Popup & Sidepanel ─────────────────────────────────
function broadcastTelemetry(telemetry) {
  try {
    chrome.runtime.sendMessage({
      type: 'PRIVACY_TELEMETRY_UPDATED',
      timestamp: new Date().toISOString(),
      payload: telemetry
    }).catch(() => {
      // Ignored if popup or sidepanel is closed
    });
  } catch (e) {
    // Context invalidated or closed
  }
}

// ─── Authorization & Sender Validation ─────────────────────────────────────────
function isAuthorizedSender(sender, targetSessionId) {
  if (typeof chrome !== 'undefined' && chrome.runtime?.id && sender?.id) {
    if (sender.id !== chrome.runtime.id) {
      return false;
    }
  }
  if (targetSessionId && targetSessionId !== currentSessionId) {
    return false;
  }
  return true;
}

// ─── Service Worker Message Router ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Log message type and metadata only to avoid leaking raw DOM/credentials into logs
  console.log("Service Worker received message:", message?.type);
  
  if (!message || !message.type) {
    sendResponse({ success: false, error: "Invalid message format." });
    return false;
  }

  // Asynchronous handling wrapper
  (async () => {
    try {
      switch (message.type) {
        case 'USER_QUERY': {
          console.log("[SW] Routing USER_QUERY:", message.payload?.query);
          
          let rawDOM = message.payload?.domSnapshot || null;
          let screenshot = message.payload?.screenshot || null;

          // If not provided by caller (e.g. standard popup prompt), dynamically extract active tab DOM & screenshot
          if (!rawDOM && typeof chrome !== 'undefined' && chrome.tabs && chrome.scripting) {
            try {
              const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
              if (activeTab?.id) {
                // Viewport screenshot
                if (!screenshot && chrome.tabs.captureVisibleTab) {
                  try {
                    screenshot = await chrome.tabs.captureVisibleTab(activeTab.windowId, { format: 'jpeg', quality: 80 });
                  } catch (e) {
                    console.warn('[SW] Could not capture visible tab screenshot:', e.message);
                  }
                }

                // Interactive DOM extraction via Dev 2's content script
                try {
                  const response = await chrome.tabs.sendMessage(activeTab.id, { type: 'REQUEST_DOM_SNAPSHOT' });
                  if (response && response.ok) {
                    rawDOM = response.snapshot;
                  } else {
                    console.warn('[SW] Dev 2 content script failed or returned false:', response?.error);
                  }
                } catch (e) {
                  console.warn('[SW] Could not reach content script (Dev 2):', e.message);
                }
              }
            } catch (err) {
              console.warn('[SW] Dynamic active tab capture failed, using fallback:', err.message);
            }
          }

          if (!rawDOM) {
            rawDOM = {
              url: message.payload?.url || "https://example.com",
              title: "Active Page",
              viewport: { width: 1280, height: 720 },
              elements_count: 0,
              elements: []
            };
          }

          // 1.5 Dev 4 Vision Analysis for Face Bounding Boxes
          let faceBBs = [];
          if (screenshot) {
            try {
              const res = await fetch(screenshot);
              const blob = await res.blob();
              if (!self.visionWorker) {
                self.visionWorker = new Worker('workers/vision-worker.js');
                self.visionWorker.postMessage({
                  type: 'INIT',
                  faceModelPath: 'models/blazeface.onnx',
                  screenModelPath: 'models/mobilevit_xxs.onnx'
                });
              }
              const visionContext = await new Promise((resolve) => {
                const listener = (e) => {
                  if (e.data.type === 'DETECT_OK' || e.data.type === 'ANALYZE_SCREEN_OK') {
                    self.visionWorker.removeEventListener('message', listener);
                    resolve(e.data);
                  } else if (e.data.type && e.data.type.endsWith('_FAIL')) {
                    self.visionWorker.removeEventListener('message', listener);
                    resolve(null);
                  }
                };
                self.visionWorker.addEventListener('message', listener);
                self.visionWorker.postMessage({ type: 'ANALYZE_SCREEN', imageData: blob });
              });
              
              if (visionContext && visionContext.vision_context?.faces_detected) {
                faceBBs = visionContext.vision_context.faces_detected.map(f => f.bbox);
              }
            } catch (err) {
              console.warn('[SW] Vision Analysis failed:', err.message);
            }
          }

          // 2. Execute 3-line privacy helper to redact DOM & construct on-device vault
          const privacyResult = await sanitizeDOMSnapshot(rawDOM, screenshot, {
            sessionId: currentSessionId,
            verifyEgress: true,
            faceBBs: faceBBs
          });

          // 3. Broadcast updated privacy telemetry to UI dashboard (Popup + Sidepanel)
          broadcastTelemetry(privacyResult.telemetry);

          console.log(`[SW] Privacy Sanitize Complete: ${privacyResult.tokenManifest.total_tokens} tokens masked. Zero Egress: ${privacyResult.zeroEgressProof.safe}`);

          // 4. Fail-Closed Guard: If zero-egress proof fails, refuse to send payload to caller / server
          if (!privacyResult.zeroEgressProof || !privacyResult.zeroEgressProof.safe) {
            const leakCount = privacyResult.zeroEgressProof?.leakedCount || 1;
            console.error(`[SW] CRITICAL FAIL-CLOSED: Zero-Egress Guard triggered! Detected ${leakCount} leaked secret(s). Payload transmission blocked.`);
            sendResponse({
              success: false,
              status: "blocked_leak_detected",
              error: `Zero-egress verification failed: ${leakCount} plaintext secret(s) leaked. Payload withheld.`,
              sessionId: currentSessionId,
              telemetry: privacyResult.telemetry,
              zeroEgressProof: privacyResult.zeroEgressProof,
            });
            return;
          }

          // 5. Send sanitized DOM + Token Manifest to caller / server transport
          sendResponse({
            success: true,
            status: "sanitized",
            sessionId: currentSessionId,
            query: message.payload?.query,
            sanitizedDOM: privacyResult.sanitizedDOM,
            tokenManifest: privacyResult.tokenManifest,
            redacted_screenshot: privacyResult.redactedScreenshot || null,
            privacyStats: privacyResult.privacyStats,
            telemetry: privacyResult.telemetry,
            zeroEgressProof: privacyResult.zeroEgressProof,
          });

          // 6. Transmit to Backend via WebSocket (Phase 4)
          console.log('[SW] Transmitting USER_QUERY and STEP_RESULT to server...');
          
          sendToServer({
            type: 'USER_QUERY',
            session_id: currentSessionId,
            payload: {
              query: message.payload?.query,
              url: rawDOM.url,
              viewport: rawDOM.viewport
            }
          });

          sendToServer({
            type: 'STEP_RESULT',
            session_id: currentSessionId,
            payload: {
              success: true,
              sanitized_dom: privacyResult.sanitizedDOM,
              vault_manifest: privacyResult.tokenManifest,
              redacted_screenshot: privacyResult.redactedScreenshot || null
            }
          });
          
          chrome.runtime.sendMessage({
            type: 'RENDER_TIMELINE_STEP',
            payload: {
              title: message.payload?.action || 'Extracted Page Context',
              detail: `Masked ${privacyResult.privacyStats?.totalMasked || 0} tokens in this step.`,
              screenshot: privacyResult.redactedScreenshot || null
            }
          }).catch(()=>{});
          break;
        }

        case 'GET_PRIVACY_TELEMETRY':
        case 'GET_PRIVACY_METRICS': {
          const telemetry = getPrivacyTelemetry(currentSessionId);
          sendResponse({
            success: true,
            status: "success",
            sessionId: currentSessionId,
            telemetry,
          });
          break;
        }

        case 'RESOLVE_TOKEN': {
          // Local action executor (Dev 2) requests credential strictly on client
          const reqSessionId = message.payload?.sessionId || currentSessionId;
          if (!isAuthorizedSender(sender, reqSessionId)) {
            console.warn('[SW] Unauthorized token resolution attempt blocked.');
            sendResponse({ success: false, error: "Unauthorized: Token resolution rejected." });
            break;
          }
          const token = message.payload?.token;
          const rawValue = resolveVaultToken(token, reqSessionId);
          console.log(`[SW] Local token resolution for ${token}: ${rawValue ? 'SUCCESS' : 'NOT_FOUND'}`);
          sendResponse({
            success: true,
            status: "resolved",
            token,
            value: rawValue, // Kept strictly local for TYPE_FROM_VAULT
          });
          break;
        }

        case 'RESTORE_TEXT': {
          const reqSessionId = message.payload?.sessionId || currentSessionId;
          if (!isAuthorizedSender(sender, reqSessionId)) {
            console.warn('[SW] Unauthorized text restoration attempt blocked.');
            sendResponse({ success: false, error: "Unauthorized: Text restoration rejected." });
            break;
          }
          const text = message.payload?.text || '';
          const restored = restoreVaultText(text, reqSessionId);
          sendResponse({
            success: true,
            status: "restored",
            restoredText: restored,
          });
          break;
        }

        case 'STOP_AGENT': {
          console.log("[SW] Routing STOP_AGENT");
          sendResponse({ success: true, status: "stopped", sessionId: currentSessionId });
          break;
        }

        case 'APPROVAL_RESPONSE': {
          console.log("Routing APPROVAL_RESPONSE", message.payload);
          sendToServer({
            type: 'APPROVAL_RESPONSE',
            session_id: currentSessionId,
            payload: message.payload
          });
          sendResponse({ success: true, status: "sent" });
          break;
        }

        case 'UNDO_ACTION': {
          console.log("Routing UNDO_ACTION");
          sendToServer({
            type: 'UNDO_ACTION',
            session_id: currentSessionId,
            payload: {}
          });
          sendResponse({ success: true, status: "sent" });
          break;
        }

        case 'RESET_SESSION': {
          resetSessionVault(currentSessionId);
          currentSessionId = 'session_' + Date.now();
          const newTelemetry = getPrivacyTelemetry(currentSessionId);
          broadcastTelemetry(newTelemetry);
          sendResponse({ success: true, status: "reset", sessionId: currentSessionId });
          break;
        }

        default:
          console.warn(`Unhandled message type: ${message.type}`);
          sendResponse({ success: false, error: "Unhandled message type" });
      }
    } catch (error) {
      console.error("[SW] Error processing message:", error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  // Return true to indicate asynchronous response
  return true; 
});

// Setup sidepanel behavior (safeguarded in case API is unavailable)
if (chrome.sidePanel) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch((error) => console.error(error));
}

