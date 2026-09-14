/**
 * content-script.js
 * Owner: Dev2 (DOM & Execution Engineer)
 * Phase 1: injection skeleton + console-testable extractor wiring.
 *
 * Injected per manifest.json content_scripts entry, run_at: document_idle.
 */

(function () {
  'use strict';

  // dom-extractor.js and action-executor.js are loaded before this file
  // (see manifest content_scripts order) and expose window.DomExtractor /
  // window.ActionExecutor.
  const extractor = window.DomExtractor;
  const executor = window.ActionExecutor;

  /**
   * Console-testable entry points.
   * In a live page's dev console (same isolated world — see content-script
   * context in the DevTools context dropdown):
   *   window.__domExtractor.extractSnapshot()
   *   window.__actionExecutor.execute({ id: 1, action: "CLICK", target: { selector: "..." } })
   */
  window.__domExtractor = {
    extractSnapshot: () => extractor.extractSnapshot(),
  };
  window.__actionExecutor = {
    execute: (step) => executeAndReport(step),
  };

  /**
   * Phase 5: runs the action, then reports the outcome back to the service
   * worker as a STEP_RESULT message (matching StepResultPayload from
   * agent_message.schema.ts), so both the console helper and the real
   * EXECUTE_ACTION message path go through the same reporting logic.
   */
  async function executeAndReport(rawStep) {
    let result;
    try {
      result = await executor.execute(rawStep);
    } catch (err) {
      result = {
        step_id: rawStep?.step_id ?? rawStep?.id,
        action: rawStep?.action,
        success: false,
        error: String(err),
      };
    }

    reportStepResult(result);
    return result;
  }

  function reportStepResult(result) {
    // Best-effort fresh snapshot so the planner sees post-action DOM state,
    // not just whether the action itself succeeded. Never let a snapshot
    // failure block sending the result.
    let domSnapshot;
    try {
      domSnapshot = extractor.extractSnapshot();
    } catch (err) {
      console.warn('[dev2] could not attach post-action snapshot to STEP_RESULT:', err);
    }

    const payload = {
      success: result.success,
      step_id: result.step_id,
      action: result.action,
      error: result.error,
      domSnapshot,
    };

    chrome.runtime.sendMessage({ type: 'STEP_RESULT', payload }).catch((err) => {
      console.warn('[dev2] failed to relay STEP_RESULT to service worker:', err);
    });
  }

  /**
   * Message listener — this is how the service worker (Dev1) will eventually
   * request a snapshot or an action execution. Phase 1/2: handle both
   * message types so each module is demoable within the extension itself,
   * with no server or other module needed yet.
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

    if (message && message.type === 'EXECUTE_ACTION') {
      // Dev1's service worker sends { type: 'EXECUTE_ACTION', payload: msg.payload }
      // where msg.payload is a NextStepPayload: { step?, actionId?, action? }.
      const rawStep = message.payload?.step
        ?? message.payload?.action
        ?? message.payload
        ?? message.step;

      if (!rawStep) {
        sendResponse({ ok: false, error: 'EXECUTE_ACTION received with no step data' });
        return true;
      }

      executeAndReport(rawStep)
        .then((result) => sendResponse({ ok: true, result }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }
  });

  console.log('[dev2] content-script.js injected and ready');

  // Dev-only: log a snapshot immediately so you can verify the extractor
  // without needing to switch the DevTools console context. Remove or
  // gate behind a debug flag before Phase 7 polish.
  try {
    console.log('[dev2] sample snapshot:', extractor.extractSnapshot());
  } catch (err) {
    console.error('[dev2] extractSnapshot failed on injection:', err);
  }
})();