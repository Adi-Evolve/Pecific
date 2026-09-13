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
    return null;
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
      return notImplemented('TYPE_FROM_VAULT', 'depends on Dev4 vault module — not built yet');
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
      return notImplemented('NEW_TAB', 'depends on Dev4 tab-manager — not built yet');
    },
    SWITCH_TAB(step) {
      return notImplemented('SWITCH_TAB', 'depends on Dev4 tab-manager — not built yet');
    },
    CLOSE_TAB(step) {
      return notImplemented('CLOSE_TAB', 'depends on Dev4 tab-manager — not built yet');
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

  async function execute(step) {
    const handler = handlers[step.action];
    if (!handler) {
      return { step_id: step.id, success: false, error: `unknown action: ${step.action}` };
    }

    const before = window.location.href;
    const result = await handler(step);
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