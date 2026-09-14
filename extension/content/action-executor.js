/**
 * action-executor.js
 * Owner: Dev2 (DOM & Execution Engineer)
 * Phase 2: DOM Action Executor + post-action verification.
 *
 * Consumes ActionStep objects matching /schemas/action.schema.json
 * (owned by Dev5). Implements DOM-native actions only. Actions that
 * depend on other modules not yet built (vault, tab manager, vision,
 * obstacle handling) are explicit, labeled stubs — never silently faked.
 *
 * NOTE on verify.condition grammar: the schema does not define a format
 * for this string. Convention implemented here (needs confirmation from
 * Dev5 / team channel):
 *   "exists:<css selector>"   -> element must exist in DOM
 *   "text:<substring>"        -> substring must appear in document.body.innerText
 *   anything else             -> treated as a URL-prefix match (for URL_CHECK)
 */

(function () {
  'use strict';

  // ---- helpers ---------------------------------------------------------

  function resolveTarget(target) {
    if (!target) return null;
    if (target.selector) {
      const el = document.querySelector(target.selector);
      if (el) return el;
    }
    // Fallback: match by visible text hint among elements we tagged in
    // Phase 1 (data-dev2-id present == known interactive element).
    if (target.text) {
      const candidates = document.querySelectorAll('[data-dev2-id]');
      for (const el of candidates) {
        if ((el.textContent || '').trim().includes(target.text)) return el;
      }
    }
    // Fallback: VISION-mode targeting by [x, y] coordinates (used when the
    // planner had no reliable selector — see agent_message.schema.ts's
    // flat "coordinates" field).
    if (Array.isArray(target.coordinates) && target.coordinates.length === 2) {
      const [x, y] = target.coordinates;
      const el = document.elementFromPoint(x, y);
      if (el) return el;
    }
    return null;
  }

  /**
   * Two conflicting ActionStep shapes currently exist in the codebase:
   *  - action.schema.json (Dev5, given for Phase 2): nested "target" object,
   *    "id", "protocol_level", "verify", "fallback", "duration_ms".
   *  - The inline ActionStep interface in agent_message.schema.ts
   *    (co-owned Dev1+Dev5, actually used on the WebSocket wire): flat
   *    "selector"/"coordinates", "step_id", "risk_level"/"riskLevel",
   *    "use_vault"/"useVault" — no verify/fallback/duration_ms at all.
   *
   * This adapter accepts either shape (or a mix) and normalizes to the
   * nested shape every handler below is written against, so real traffic
   * from Dev1's service worker doesn't silently no-op. Flagged to the team
   * as a real contract divergence — this is a safety net, not a fix for
   * the underlying schema drift.
   */
  function normalizeStep(raw) {
    if (!raw) return raw;
    const target = raw.target || {};
    return {
      id: raw.id ?? raw.step_id ?? raw.action_id,
      action: raw.action,
      target: {
        selector: raw.selector ?? target.selector,
        url: raw.url ?? target.url,
        coordinates: raw.coordinates ?? target.coordinates,
        text: raw.text ?? target.text,
        tab_id: raw.tab_id ?? target.tab_id,
        tab_purpose: raw.tab_purpose ?? target.tab_purpose,
      },
      value: raw.value,
      key: raw.key,
      vault_key: raw.vault_key,
      execution_mode:
        raw.execution_mode
        || (!raw.selector && !target.selector && (raw.coordinates || target.coordinates) ? 'VISION' : 'DOM'),
      protocol_level: raw.protocol_level ?? raw.risk_level ?? raw.riskLevel ?? 'SAFE',
      description: raw.description,
      verify: raw.verify, // absent on the flat schema — runVerify handles undefined safely
      fallback: raw.fallback,
      timeout_ms: raw.timeout_ms,
      duration_ms: raw.duration_ms,
    };
  }

  function dispatchMouseSequence(el, type) {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', type].forEach((eventType) => {
      const EventCtor = eventType.startsWith('pointer') ? PointerEvent : MouseEvent;
      el.dispatchEvent(new EventCtor(eventType, opts));
    });
  }

  function setNativeValue(el, value) {
    // Needed so frameworks (React etc.) that listen via the native input
    // value setter actually register the change, not just the DOM attribute.
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) {
      desc.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Phase 6 — smart wait: resolves once the DOM has stopped mutating for
   * `quietMs`, or after `timeoutMs` regardless (never hangs indefinitely).
   * Replaces blindly guessing a fixed delay after actions that may trigger
   * async page/AJAX changes.
   */
  function waitForDomSettled(timeoutMs = 3000, quietMs = 300) {
    return new Promise((resolve) => {
      let quietTimer = null;
      let done = false;

      const finish = () => {
        if (done) return;
        done = true;
        observer.disconnect();
        clearTimeout(quietTimer);
        clearTimeout(hardTimeout);
        resolve();
      };

      const observer = new MutationObserver(() => {
        clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, quietMs);
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });

      // Start the quiet timer immediately in case nothing mutates at all.
      quietTimer = setTimeout(finish, quietMs);
      const hardTimeout = setTimeout(finish, timeoutMs);
    });
  }

  /**
   * Phase 6 — retry-with-backoff: retries a handler only when it failed for
   * the specific, transient reason "target element not found" (e.g. content
   * hasn't rendered yet). Bounded by step.timeout_ms (defaults to 5000ms,
   * same default as action.schema.json) rather than a fixed attempt count,
   * so it adapts to however long the caller says is acceptable.
   */
  async function executeWithRetry(step) {
    const timeoutMs = step.timeout_ms || 5000;
    const start = Date.now();
    let attempt = 0;
    let result;

    while (true) {
      attempt += 1;
      result = await handlers[step.action](step);

      if (result.success || result.error !== 'target element not found') {
        return result;
      }

      const elapsed = Date.now() - start;
      const backoff = Math.min(300 * 2 ** (attempt - 1), 2000);
      if (elapsed + backoff >= timeoutMs) {
        return result; // out of time — return the last failure as-is
      }
      await wait(backoff);
    }
  }

  function notImplemented(action, reason) {
    return { success: false, error: `NOT_IMPLEMENTED: ${action} — ${reason}` };
  }

  // ---- action handlers ---------------------------------------------------

  const handlers = {
    NAVIGATE(step) {
      if (!step.target || !step.target.url) {
        return { success: false, error: 'NAVIGATE requires target.url' };
      }
      window.location.assign(step.target.url);
      return { success: true, note: 'navigation initiated; page will unload' };
    },

    CLICK(step) {
      const el = resolveTarget(step.target);
      if (!el) return { success: false, error: 'target element not found' };
      if (step.execution_mode === 'VISION') {
        return notImplemented('CLICK (VISION mode)', 'depends on Dev4/Dev6 vision coordinate resolution — not built yet');
      }
      dispatchMouseSequence(el, 'click');
      return { success: true };
    },

    TYPE(step) {
      const el = resolveTarget(step.target);
      if (!el) return { success: false, error: 'target element not found' };
      if (typeof step.value !== 'string') {
        return { success: false, error: 'TYPE requires a string value' };
      }
      el.focus();
      setNativeValue(el, step.value);
      return { success: true };
    },

    TYPE_FROM_VAULT(step) {
      const el = resolveTarget(step.target);
      if (!el) return { success: false, error: 'target element not found' };
      const vaultKey = step.vault_key || step.target?.vault_key;
      if (!vaultKey) return { success: false, error: 'TYPE_FROM_VAULT requires vault_key' };

      return new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'RESOLVE_TOKEN',
          payload: { token: vaultKey, vault_key: vaultKey }
        }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          if (!response?.success || typeof response.value !== 'string') {
            resolve({ success: false, error: response?.error || 'vault value unavailable' });
            return;
          }
          el.focus();
          setNativeValue(el, response.value);
          resolve({ success: true });
        });
      });
    },

    PRESS_KEY(step) {
      if (!step.key) return { success: false, error: 'PRESS_KEY requires a key' };
      const el = resolveTarget(step.target) || document.activeElement || document.body;
      const opts = { bubbles: true, cancelable: true, key: step.key };
      el.dispatchEvent(new KeyboardEvent('keydown', opts));
      el.dispatchEvent(new KeyboardEvent('keypress', opts));
      el.dispatchEvent(new KeyboardEvent('keyup', opts));
      return { success: true };
    },

    HOVER(step) {
      const el = resolveTarget(step.target);
      if (!el) return { success: false, error: 'target element not found' };
      const rect = el.getBoundingClientRect();
      const opts = {
        bubbles: true, cancelable: true, view: window,
        clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
      };
      el.dispatchEvent(new MouseEvent('mouseover', opts));
      el.dispatchEvent(new MouseEvent('mouseenter', opts));
      el.dispatchEvent(new MouseEvent('mousemove', opts));
      return { success: true };
    },

    SCROLL(step) {
      const el = resolveTarget(step.target);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return { success: true };
      }
      const amount = step.value ? parseInt(step.value, 10) : 400;
      window.scrollBy({ top: amount, behavior: 'smooth' });
      return { success: true };
    },

    SELECT(step) {
      const el = resolveTarget(step.target);
      if (!el || el.tagName !== 'SELECT') {
        return { success: false, error: 'target is not a <select> element' };
      }
      const value = step.value;
      let matched = false;
      for (const opt of el.options) {
        if (opt.value === value || opt.textContent.trim() === value) {
          el.value = opt.value;
          matched = true;
          break;
        }
      }
      if (!matched) return { success: false, error: `no matching option for value "${value}"` };
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true };
    },

    async WAIT(step) {
      const ms = step.duration_ms || 1000;
      await wait(ms);
      return { success: true };
    },

    EXTRACT(step) {
      const el = resolveTarget(step.target);
      if (!el) return { success: false, error: 'target element not found' };
      const data = 'value' in el ? el.value : (el.textContent || '').trim();
      return { success: true, extracted: data };
    },

    SCREENSHOT(step) {
      return notImplemented('SCREENSHOT', 'requires vision worker / tab capture via service worker — Dev4/Dev6 scope, not built yet');
    },

    NEW_TAB(step) {
      return requestTabAction('NEW_TAB', step);
    },
    SWITCH_TAB(step) {
      return requestTabAction('SWITCH_TAB', step);
    },
    CLOSE_TAB(step) {
      return requestTabAction('CLOSE_TAB', step);
    },

    DISMISS_POPUP(step) {
      return notImplemented('DISMISS_POPUP', 'Phase 6 obstacle-handling scope (Dev6) — not built yet');
    },
    CAPTCHA_HANDOFF(step) {
      return notImplemented('CAPTCHA_HANDOFF', 'Phase 5/6 scope — hands control to user, not wired yet');
    },
    REPORT_RESULT(step) {
      return notImplemented('REPORT_RESULT', 'Phase 5 scope — service worker STEP_RESULT wiring (Dev1) not built yet');
    },
  };

  function requestTabAction(action, step) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'TAB_ACTION',
        payload: {
          action,
          tab_id: step.target?.tab_id || step.tab_id,
          url: step.target?.url || step.url,
          purpose: step.target?.tab_purpose || step.tab_purpose
        }
      }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response?.success
          ? { success: true, result: response.result }
          : { success: false, error: response?.error || `tab action failed: ${action}` });
      });
    });
  }

  // ---- verification ------------------------------------------------------

  function runVerify(verify) {
    if (!verify) return { checked: false };
    const { method, condition } = verify;

    if (method === 'URL_CHECK') {
      return { checked: true, passed: window.location.href.startsWith(condition) };
    }

    if (method === 'DOM_CHECK') {
      if (condition.startsWith('exists:')) {
        const sel = condition.slice('exists:'.length);
        return { checked: true, passed: document.querySelector(sel) !== null };
      }
      if (condition.startsWith('text:')) {
        const needle = condition.slice('text:'.length);
        return { checked: true, passed: (document.body.innerText || '').includes(needle) };
      }
      // Unrecognized convention — flagged rather than guessed at silently.
      return { checked: true, passed: null, note: 'unrecognized condition format, needs Dev5 confirmation' };
    }

    if (method === 'SCREENSHOT') {
      return { checked: false, note: 'SCREENSHOT verification not implemented — depends on vision worker' };
    }

    return { checked: false, note: `unknown verify method: ${method}` };
  }

  // ---- entry point --------------------------------------------------------

  async function execute(rawStep) {
    const step = normalizeStep(rawStep);
    const handler = handlers[step.action];
    if (!handler) {
      return { step_id: step.id, success: false, error: `unknown action: ${step.action}` };
    }

    const before = window.location.href;
    const result = await executeWithRetry(step);

    // Smart wait: give the DOM a chance to settle after actions that
    // commonly trigger async re-render (AJAX, client-side routing) before
    // we run verification — instead of guessing a fixed delay. NAVIGATE is
    // excluded: it unloads this content script entirely, so there's nothing
    // here left to wait on.
    if (result.success && (step.action === 'CLICK' || step.action === 'SELECT')) {
      await waitForDomSettled(Math.min(step.timeout_ms || 3000, 3000));
    }

    const after = window.location.href;

    const verification = runVerify(step.verify);

    return {
      step_id: step.id,
      action: step.action,
      ...result,
      url_changed: before !== after,
      verification,
    };
  }

  window.ActionExecutor = { execute };
})();