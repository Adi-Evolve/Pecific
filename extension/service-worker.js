// extension/service-worker.js

// Import schemas when needed (Note: MV3 modules support imports)
// import { ExtensionToServerMessageType, ServerToExtensionMessageType } from '../schemas/agent_message.schema.js';

console.log("iSIH Agent Service Worker Registered.");

// Message Router Stub
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Service Worker received message:", message);
  
  if (!message || !message.type) {
    sendResponse({ error: "Invalid message format." });
    return false;
  }

  try {
    switch (message.type) {
      // Examples of future routing logic
      case 'USER_QUERY':
        console.log("Routing USER_QUERY", message.payload);
        // TODO: Request DOM snapshot -> Vision -> Privacy -> Server
        sendResponse({ status: "processing" });
        break;
        
      case 'APPROVAL_RESPONSE':
        console.log("Routing APPROVAL_RESPONSE", message.payload);
        // TODO: Forward to server
        sendResponse({ status: "sent" });
        break;

      default:
        console.warn(`Unhandled message type: ${message.type}`);
        sendResponse({ error: "Unhandled message type" });
    }
  } catch (error) {
    console.error("Error processing message:", error);
    sendResponse({ error: error.message });
  }

  // Return true to indicate we will send a response asynchronously if needed
  return true; 
});

// Setup sidepanel behavior (safeguarded in case API is unavailable)
if (chrome.sidePanel) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch((error) => console.error(error));
}
