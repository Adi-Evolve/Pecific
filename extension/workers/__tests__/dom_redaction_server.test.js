/**
 * dom_redaction_server.test.js
 * 
 * Verifies that:
 * 1. DOM redaction preserves the complete structure, hierarchy, and meaning of the DOM
 * 2. Sensitive fields (both text and input values) are replaced with typed semantic tokens
 * 3. The server receives exact metadata about what sensitive field was redacted (types, tokens, selector)
 * 4. Zero raw secret values are leaked in the server payload
 */

import { scanDOMElements } from '../regex.js';
import { redactDOM, resolveToken, restoreTokens } from '../redaction.js';

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    process.exitCode = 1;
  }
}

console.log('\n🌐 Server-Facing DOM Redaction & Structure Preservation Tests\n');

// ── Test 1: DOM Structure & Attribute Invariance ──────────────────────────────
console.log('🏛️ Section 1: DOM Structure & Attribute Invariance:');

const rawDOM = {
  url: 'https://bank.example.in/account',
  title: 'Secure Account Details',
  viewport: { width: 1280, height: 720, scroll_x: 0, scroll_y: 0 },
  elements_count: 5,
  elements: [
    {
      id: 'e_nav',
      tag: 'A',
      selector: '#nav-home',
      text: 'Home Dashboard',
      href: '/home',
      interactive: true,
      role: 'link',
      coordinates: [10, 10, 100, 30],
    },
    {
      id: 'e_email_input',
      tag: 'INPUT',
      type: 'email',
      selector: 'input#login_email',
      placeholder: 'Enter Registered Email',
      value: 'aditya.sharma@gmail.com',
      interactive: true,
      role: 'textbox',
      coordinates: [100, 100, 300, 40],
    },
    {
      id: 'e_pass_input',
      tag: 'INPUT',
      type: 'password',
      selector: 'input#login_password',
      placeholder: 'Enter Password',
      value: 'SuperSecret123!',
      interactive: true,
      role: 'textbox',
      coordinates: [100, 160, 300, 40],
    },
    {
      id: 'e_card_display',
      tag: 'SPAN',
      selector: '.card-number-val',
      text: 'Saved Card: 4532 0151 1283 0366',
      interactive: false,
      role: 'generic',
      coordinates: [100, 220, 250, 30],
    },
    {
      id: 'e_submit_btn',
      tag: 'BUTTON',
      selector: 'button#btn-continue',
      text: 'Continue',
      interactive: true,
      role: 'button',
      coordinates: [100, 280, 150, 40],
    },
  ],
};

const matches = scanDOMElements(rawDOM.elements);
const result = redactDOM(rawDOM, matches, 'test_sess_server');
const sanitized = result.sanitizedDOM;

assert(sanitized.elements.length === rawDOM.elements.length, 'Element count remains exactly identical');
assert(sanitized.url === rawDOM.url, 'Page URL remains identical');
assert(sanitized.viewport.width === 1280, 'Viewport dimensions preserved');

// Verify clean element (e_nav) is not modified
const navEl = sanitized.elements.find(e => e.id === 'e_nav');
assert(navEl.text === 'Home Dashboard', 'Clean element text untouched');
assert(navEl.selector === '#nav-home', 'Clean element selector untouched');
assert(navEl.is_redacted === false, 'Clean element is_redacted is false');
assert(navEl.coordinates[0] === 10, 'Clean element coordinates intact');

// ── Test 2: Input Value Redaction & Semantic Metadata ────────────────────────
console.log('\n🔒 Section 2: Input Value Redaction & Semantic Metadata:');

const emailEl = sanitized.elements.find(e => e.id === 'e_email_input');
assert(emailEl.value === '[EMAIL_1]', 'Email input value replaced with semantic token [EMAIL_1]');
assert(!emailEl.value.includes('aditya.sharma@gmail.com'), 'Raw email NEVER present in element value');
assert(emailEl.is_redacted === true, 'Email input is_redacted is true');
assert(emailEl.redacted_types.includes('EMAIL'), 'Email input redacted_types includes EMAIL');
assert(emailEl.redacted_tokens.includes('[EMAIL_1]'), 'Email input redacted_tokens includes [EMAIL_1]');
assert(emailEl.tag === 'INPUT', 'Tag remains INPUT');
assert(emailEl.selector === 'input#login_email', 'CSS selector preserved');
assert(emailEl.coordinates[1] === 100, 'Coordinates preserved for grounding');

const passEl = sanitized.elements.find(e => e.id === 'e_pass_input');
assert(passEl.value === '[PASSWORD_FIELD]', 'Password value masked with [PASSWORD_FIELD]');
assert(passEl.text === '[PASSWORD_FIELD]', 'Password text masked with [PASSWORD_FIELD]');
assert(!passEl.value.includes('SuperSecret'), 'Raw password NEVER present');
assert(passEl.is_redacted === true, 'Password is_redacted is true');
assert(passEl.redacted_types.includes('PASSWORD_FIELD'), 'Password redacted_types includes PASSWORD_FIELD');
assert(passEl.redacted_tokens.includes('[PASSWORD_FIELD]'), 'Password redacted_tokens includes [PASSWORD_FIELD]');
assert(passEl.selector === 'input#login_password', 'Password CSS selector preserved for action targeting');

const cardEl = sanitized.elements.find(e => e.id === 'e_card_display');
assert(cardEl.text === 'Saved Card: [CARD_1]', 'Credit card in SPAN replaced with [CARD_1]');
assert(cardEl.is_redacted === true, 'Credit card span is_redacted is true');
assert(cardEl.redacted_types.includes('CARD'), 'Credit card redacted_types includes CARD');

// ── Test 3: Server Token Manifest & Redacted Elements Breakdown ───────────────
console.log('\n📊 Section 3: Server Token Manifest & Redacted Elements:');

const manifest = result.tokenManifest;
assert(Array.isArray(manifest.tokens_used), 'manifest.tokens_used is an array');
assert(manifest.tokens_used.includes('[EMAIL_1]'), 'tokens_used includes [EMAIL_1]');
assert(manifest.tokens_used.includes('[PASSWORD_FIELD]'), 'tokens_used includes [PASSWORD_FIELD]');
assert(manifest.tokens_used.includes('[CARD_1]'), 'tokens_used includes [CARD_1]');
assert(manifest.total_tokens === 3, 'total_tokens count is 3');

assert(manifest.token_types['[EMAIL_1]'] === 'EMAIL', 'token_types maps [EMAIL_1] -> EMAIL');
assert(manifest.token_types['[PASSWORD_FIELD]'] === 'PASSWORD_FIELD', 'token_types maps [PASSWORD_FIELD] -> PASSWORD_FIELD');
assert(manifest.token_types['[CARD_1]'] === 'CARD', 'token_types maps [CARD_1] -> CARD');

assert(Array.isArray(manifest.redacted_elements), 'manifest.redacted_elements is an array');
assert(manifest.redacted_elements.length === 3, 'manifest.redacted_elements has 3 items');

const emailSummary = manifest.redacted_elements.find(r => r.element_id === 'e_email_input');
assert(emailSummary && emailSummary.selector === 'input#login_email', 'Server knows selector for redacted email field');
assert(emailSummary.types.includes('EMAIL'), 'Server knows field type is EMAIL');
assert(emailSummary.tokens.includes('[EMAIL_1]'), 'Server knows token is [EMAIL_1]');

const passSummary = manifest.redacted_elements.find(r => r.element_id === 'e_pass_input');
assert(passSummary && passSummary.selector === 'input#login_password', 'Server knows selector for password field');
assert(passSummary.types.includes('PASSWORD_FIELD'), 'Server knows field is PASSWORD_FIELD');

// ── Test 4: Client-Only Vault Isolation ───────────────────────────────────────
console.log('\n🔐 Section 4: Client-Only Vault Isolation:');

const resolvedEmail = resolveToken(result.redactionMap, '[EMAIL_1]');
assert(resolvedEmail === 'aditya.sharma@gmail.com', 'Client can resolve [EMAIL_1] locally');

const restored = restoreTokens('Send receipt to [EMAIL_1]', result.redactionMap);
assert(restored === 'Send receipt to aditya.sharma@gmail.com', 'Client can restore tokens locally');

// Server payload stringification test (simulates WebSocket transmission)
const serverPayload = JSON.stringify({
  sanitized_dom: result.sanitizedDOM,
  privacy_stats: result.privacyStats,
  token_manifest: result.tokenManifest,
});

assert(!serverPayload.includes('aditya.sharma@gmail.com'), 'Payload to server has ZERO plain email');
assert(!serverPayload.includes('SuperSecret123!'), 'Payload to server has ZERO plain password');
assert(!serverPayload.includes('4532 0151 1283 0366'), 'Payload to server has ZERO plain credit card');

console.log(`\n──────────────────────────────────────────────────`);
console.log(`📊 DOM Server Protocol Results: ${passedTests}/${totalTests} passed`);
console.log(`──────────────────────────────────────────────────\n`);
