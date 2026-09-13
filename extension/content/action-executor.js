/**
 * action-executor.js
 * Owner: Dev2 (DOM & Execution Engineer)
 * STUB — real implementation lands in Phase 2.
 *
 * Will execute CLICK / TYPE / SCROLL / SELECT actions received from the
 * server (via action.schema.json) against elements tagged by
 * dom-extractor.js (matched via the data-dev2-id attribute), then
 * re-check DOM state and report STEP_RESULT back.
 */

(function () {
  'use strict';

  function notImplemented(actionName) {
    throw new Error(`[dev2] action-executor: "${actionName}" not implemented until Phase 2`);
  }

  window.ActionExecutor = {
    click: () => notImplemented('CLICK'),
    type: () => notImplemented('TYPE'),
    scroll: () => notImplemented('SCROLL'),
    select: () => notImplemented('SELECT'),
  };
})();