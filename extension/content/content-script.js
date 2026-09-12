/**
 * content-script.js
 * Owner: Dev2 (DOM & Execution Engineer)
 * Phase 1: injection skeleton + console-testable extractor wiring.
 *
 * Injected per manifest.json content_scripts entry, run_at: document_idle.
 */

(function () {
  'use strict';

  // dom-extractor.js is loaded before this file (see manifest content_scripts
  // order) and exposes window.DomExtractor.
  const extractor = window.DomExtractor;

  /**
   * Console-testable entry point.
   * In a live page's dev console: window.__domExtractor.extractSnapshot()
   */
  window.__domExtractor = {
    extractSnapshot: () => extractor.extractSnapshot(),
  };

  /**
   * Message listener — this is how the service worker (Dev1) will eventually
   * request a snapshot. Phase 1: just handle the one message type we need to
   * demo the extractor working end-to-end within the extension itself.
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === 'REQUEST_DOM_SNAPSHOT') {
      try {
        const snapshot = extractor.extractSnapshot();
        sendResponse({ ok: true, snapshot });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
      return true; // keep the message channel open for async sendResponse
    }
    // action-executor.js message handling arrives in Phase 2.
  });

  console.log('[dev2] content-script.js injected and ready');
})();