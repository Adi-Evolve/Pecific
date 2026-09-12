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

                // Interactive DOM elements extraction
                const [injectionResult] = await chrome.scripting.executeScript({
                  target: { tabId: activeTab.id },
                  func: () => {
                    const elements = [];
                    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
                    let node;
                    let idx = 0;
                    while ((node = walker.nextNode())) {
                      const tag = node.tagName;
                      const isInteractive = ['INPUT', 'BUTTON', 'A', 'SELECT', 'TEXTAREA'].includes(tag);
                      const text = (node.innerText || node.textContent || '').trim();
                      const val = node.value || '';
                      if (isInteractive || (text && text.length > 0 && node.children.length === 0)) {
                        const rect = node.getBoundingClientRect();
                        elements.push({
                          id: node.id || `el_${idx++}`,
                          tag,
                          type: node.type || undefined,
                          text: text.slice(0, 500),
                          value: val.slice(0, 500),
                          placeholder: node.placeholder || undefined,
                          nearbyLabels: node.getAttribute('aria-label') || node.getAttribute('title') || undefined,
                          coordinates: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)],
                          selector: node.id ? `#${node.id}` : tag.toLowerCase()
                        });
                      }
                    }
                    return {
                      url: window.location.href,
                      title: document.title,
                      viewport: { width: window.innerWidth, height: window.innerHeight },
                      elements_count: elements.length,
                      elements
                    };
                  }
                });
                if (injectionResult?.result) {
                  rawDOM = injectionResult.result;
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

          // 2. Execute 3-line privacy helper to redact DOM & construct on-device vault
          const privacyResult = await sanitizeDOMSnapshot(rawDOM, screenshot, {
            sessionId: currentSessionId,
            verifyEgress: true,
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

