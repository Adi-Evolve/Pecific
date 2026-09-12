/**
 * dom-extractor.js
 * Owner: Dev2 (DOM & Execution Engineer)
 * Phase 1: raw DOM -> accessibility-tree parse -> element tagging.
 *
 * Output shape matches /schemas/dom_snapshot.schema.json 
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

  let counter = 0;

  function resetIdCounter() {
    counter = 0;
  }

  function nextId(el) {
    counter += 1;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'search') return `e_search_${counter}`;
    return `e_${counter}`;
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

  function toCoordinates(el) {
    const r = el.getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
  }

  function buildSelector(el) {
    if (el.id) return `#${el.id}`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      if (node.className && typeof node.className === 'string') {
        const cls = node.className.trim().split(/\s+/)[0];
        if (cls) part += `.${cls}`;
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function nearbyLabel(el) {
    if (el.id) {
      const lbl = document.querySelector(`label[for="${el.id}"]`);
      if (lbl) return lbl.textContent.trim().slice(0, 100);
    }
    const parentLabel = el.closest('label');
    if (parentLabel) return parentLabel.textContent.trim().slice(0, 100);
    const prev = el.previousElementSibling;
    if (prev && prev.tagName === 'LABEL') return prev.textContent.trim().slice(0, 100);
    return undefined;
  }

  function extractElements() {
    resetIdCounter();
    const nodeList = document.querySelectorAll(INTERACTIVE_SELECTOR);
    const elements = [];

    nodeList.forEach((el) => {
      if (!isVisible(el)) return;

      const tag = el.tagName.toUpperCase();
      const id = nextId(el);

      const entry = {
        id,
        tag,
        selector: buildSelector(el),
        interactive: true,
        role: inferRole(el),
        coordinates: toCoordinates(el),
      };

      const type = el.getAttribute('type');
      if (type) entry.type = type;

      const placeholder = el.getAttribute('placeholder');
      if (placeholder) entry.placeholder = placeholder;

      const href = el.getAttribute('href');
      if (href) entry.href = href;

      const autocomplete = el.getAttribute('autocomplete');
      if (autocomplete) entry.autocomplete = autocomplete;

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

      const parent = el.parentElement;
      if (parent) {
        entry.parentTag = parent.tagName.toLowerCase();
        if (parent.className && typeof parent.className === 'string') {
          entry.parentClass = parent.className.trim();
        }
        if (parent.id) entry.parentId = parent.id;
      }

      const label = nearbyLabel(el);
      if (label) entry.nearbyLabels = label;

      // Tag the live DOM node so the (Phase 2) action-executor can find it
      // again by this same id without re-querying the whole page.
      el.setAttribute('data-dev2-id', id);

      elements.push(entry);
    });

    return elements;
  }

  function extractForms() {
    const forms = [];
    document.querySelectorAll('form').forEach((form, i) => {
      const inputs = [];
      form.querySelectorAll('input, select, textarea').forEach((field) => {
        const name = field.getAttribute('name') || field.getAttribute('id');
        if (name) inputs.push(name);
      });
      forms.push({
        id: form.getAttribute('id') || `form-${i}`,
        action: form.getAttribute('action') || '',
        method: (form.getAttribute('method') || 'get').toLowerCase(),
        inputs,
      });
    });
    return forms;
  }

  /**
   * Heuristic for the DOM-sufficiency check that gates whether the vision
   * worker needs to run (see updated vision-usage flow). Will be refined
   * once the actual gating logic is designed with Dev1/Dev4.
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
      elements_count: elements.length,
      elements,
      forms,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scroll_x: window.scrollX,
        scroll_y: window.scrollY,
      },
      context_sufficient: isContextSufficient(elements),
    };
  }

  window.DomExtractor = {
    extractSnapshot,
  };
})();