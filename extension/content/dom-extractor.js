/**
 * dom-extractor.js
 * Owner: Dev2 (DOM & Execution Engineer)
 * Phase 1: raw DOM -> accessibility-tree parse -> element tagging.
 *
 * Output shape matches /schemas/dom_snapshot.schema.json.
 * No dependency on any other module — testable standalone in the console.
 */

(function () {
  'use strict';

  const INTERACTIVE_SELECTOR = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    '[role="button"]',
    '[role="link"]',
    '[role="searchbox"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[onclick]',
    '[tabindex]',
  ].join(',');

  let nextId = 1;

  function resetIdCounter() {
    nextId = 1;
  }

  function inferRole(el) {
    if (el.getAttribute('role')) return el.getAttribute('role');
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'listbox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'search') return 'searchbox';
      if (type === 'submit' || type === 'button') return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'password') return 'textbox';
      return 'textbox';
    }
    return 'generic';
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    if (parseFloat(style.opacity) === 0) return false;
    return true;
  }

  function toRect(el) {
    const r = el.getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
  }

  function extractElements() {
    resetIdCounter();
    const nodeList = document.querySelectorAll(INTERACTIVE_SELECTOR);
    const elements = [];

    nodeList.forEach((el) => {
      if (!isVisible(el)) return;

      const tag = el.tagName.toUpperCase();
      const entry = {
        id: nextId++,
        tag,
        role: inferRole(el),
        rect: toRect(el),
      };

      const type = el.getAttribute('type');
      if (type) entry.type = type;

      const placeholder = el.getAttribute('placeholder');
      if (placeholder) entry.placeholder = placeholder;

      // NOTE: text/value are raw here — Dev3's privacy worker sanitizes
      // this before anything leaves the client. Do not send this object
      // to the network directly.
      const text = (el.textContent || '').trim();
      if (text && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        entry.text = text.slice(0, 200);
      }
      if ('value' in el && el.value) {
        entry.value = String(el.value).slice(0, 200);
      }

      // Tag the live DOM node so the (Phase 2) action-executor can find it
      // again by this same id without re-querying the whole page.
      el.setAttribute('data-dev2-id', String(entry.id));

      elements.push(entry);
    });

    return elements;
  }

  function extractForms() {
    const forms = [];
    document.querySelectorAll('form').forEach((form, i) => {
      const fields = [];
      form.querySelectorAll('input, select, textarea').forEach((field) => {
        const name = field.getAttribute('name') || field.getAttribute('id');
        if (name) fields.push(name);
      });
      if (fields.length > 0) {
        forms.push({
          id: form.getAttribute('id') || `form-${i}`,
          fields,
          // vault_available is populated later by the vault manager (Dev4);
          // Phase 1 just establishes the shape.
          vault_available: {},
        });
      }
    });
    return forms;
  }

  /**
   * Phase 1 placeholder for the DOM-sufficiency check that gates whether
   * the vision worker needs to run (see updated vision-usage flow). A
   * simple heuristic for now: enough interactive elements found = DOM is
   * sufficient. This will get refined once the actual gating logic is
   * designed with Dev1/Dev4.
   */
  function isContextSufficient(elements) {
    return elements.length > 0;
  }

  function extractSnapshot() {
    const elements = extractElements();
    const forms = extractForms();

    return {
      url: window.location.href,
      title: document.title,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      elements,
      forms,
      context_sufficient: isContextSufficient(elements),
    };
  }

  window.DomExtractor = {
    extractSnapshot,
  };
})();