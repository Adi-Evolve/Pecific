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

// ─── Service Worker Message Router ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Service Worker received message:", message?.type, message);
  
  if (!message || !message.type) {
    sendResponse({ error: "Invalid message format." });
    return false;
  }

  // Asynchronous handling wrapper
  (async () => {
    try {
      switch (message.type) {
        case 'USER_QUERY': {
          console.log("[SW] Routing USER_QUERY:", message.payload?.query);
          
          // 1. Extract DOM snapshot from message or fallback
          const rawDOM = message.payload?.domSnapshot || {
            url: message.payload?.url || "https://example.com",
            title: "Active Page",
            viewport: { width: 1280, height: 720 },
            elements_count: 0,
            elements: []
          };
          const screenshot = message.payload?.screenshot || null;

          // 2. Execute 3-line privacy helper to redact DOM & construct on-device vault
          const privacyResult = await sanitizeDOMSnapshot(rawDOM, screenshot, {
            sessionId: currentSessionId,
            verifyEgress: true,
          });

          // 3. Broadcast updated privacy telemetry to UI dashboard (Popup + Sidepanel)
          broadcastTelemetry(privacyResult.telemetry);

          console.log(`[SW] Privacy Sanitize Complete: ${privacyResult.tokenManifest.total_tokens} tokens masked. Zero Egress: ${privacyResult.zeroEgressProof.safe}`);

          // 4. Send sanitized DOM + Token Manifest to caller / server queue
          sendResponse({
            status: "sanitized",
            sessionId: currentSessionId,
            query: message.payload?.query,
            sanitizedDOM: privacyResult.sanitizedDOM,
            tokenManifest: privacyResult.tokenManifest,
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
            status: "success",
            sessionId: currentSessionId,
            telemetry,
          });
          break;
        }

        case 'RESOLVE_TOKEN': {
          // Local action executor (Dev 2) requests credential strictly on client
          const token = message.payload?.token;
          const rawValue = resolveVaultToken(token, currentSessionId);
          console.log(`[SW] Local token resolution for ${token}: ${rawValue ? 'SUCCESS' : 'NOT_FOUND'}`);
          sendResponse({
            status: "resolved",
            token,
            value: rawValue, // Kept strictly local for TYPE_FROM_VAULT
          });
          break;
        }

        case 'RESTORE_TEXT': {
          const text = message.payload?.text || '';
          const restored = restoreVaultText(text, currentSessionId);
          sendResponse({
            status: "restored",
            restoredText: restored,
          });
          break;
        }

        case 'STOP_AGENT': {
          console.log("[SW] Routing STOP_AGENT");
          sendResponse({ status: "stopped", sessionId: currentSessionId });
          break;
        }

        case 'APPROVAL_RESPONSE': {
          console.log("Routing APPROVAL_RESPONSE", message.payload);
          sendResponse({ status: "sent" });
          break;
        }

        case 'RESET_SESSION': {
          resetSessionVault(currentSessionId);
          currentSessionId = 'session_' + Date.now();
          const newTelemetry = getPrivacyTelemetry(currentSessionId);
          broadcastTelemetry(newTelemetry);
          sendResponse({ status: "reset", sessionId: currentSessionId });
          break;
        }

        default:
          console.warn(`Unhandled message type: ${message.type}`);
          sendResponse({ error: "Unhandled message type" });
      }
    } catch (error) {
      console.error("[SW] Error processing message:", error);
      sendResponse({ error: error.message });
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

