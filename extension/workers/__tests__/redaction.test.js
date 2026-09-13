/**
 * redaction.test.js — Unit Tests for Redaction Engine
 * Run with: node extension/workers/__tests__/redaction.test.js
 * 
 * Tests DOM token replacement, token reuse/deduplication, longest-match-first,
 * redaction map integrity, token restoration, and fixture-based privacy guarantees.
 */

import { 
  redactDOM, resetCounters, resolveToken, restoreTokens,
  getPIICategory, redactIncrementalDOM
} from '../redaction.js';
import { scanDOMElements } from '../regex.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Minimal Test Harness ───────────────────────────────────────────────────────

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failedTests++;
    console.log(`  ❌ ${name}`);
    console.log(`     ${error.message}`);
  }
}

function assertEqual(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${msg}\n     Expected: ${e}\n     Actual:   ${a}`);
  }
}

function assertTrue(condition, msg = '') {
  if (!condition) {
    throw new Error(msg || 'Assertion failed: expected truthy');
  }
}

function assertFalse(condition, msg = '') {
  if (condition) {
    throw new Error(msg || 'Assertion failed: expected falsy');
  }
}

// ─── Test Suites ───────────────────────────────────────────────────────────────

console.log('\n🔒 Redaction Engine — Unit Tests\n');

// Group 1: Basic Redaction & Token Creation
console.log('📦 Group 1: Basic Redaction & Token Creation');

test('Replaces single PII match with numbered token', () => {
  resetCounters('test_session_1');
  const domSnapshot = {
    elements_count: 1,
    elements: [
      { id: 'e1', tag: 'SPAN', text: 'Email: aditya@gmail.com' }
    ]
  };
  const matches = [
    {
      elementId: 'e1',
      matches: [
        { type: 'EMAIL', value: 'aditya@gmail.com', start: 7, end: 23, confidence: 1.0, method: 'REGEX' }
      ]
    }
  ];

  const result = redactDOM(domSnapshot, matches, 'test_session_1');
  assertEqual(result.sanitizedDOM.elements[0].text, 'Email: [EMAIL_1]', 'Text should have token');
  assertEqual(result.redactionMap.tokens['[EMAIL_1]'], 'aditya@gmail.com', 'Redaction map should store value');
  assertEqual(result.privacyStats.pii_tokens_masked, 1, 'Token count should be 1');
  assertEqual(result.privacyStats.dom_masked_fields, 1, 'Masked fields should be 1');
  assertEqual(result.tokenManifest.tokens_used, ['[EMAIL_1]'], 'Manifest should list token');
});

test('Replaces multiple distinct PII types with typed tokens', () => {
  resetCounters('test_session_2');
  const domSnapshot = {
    elements_count: 2,
    elements: [
      { id: 'e1', tag: 'DIV', text: 'Call +91 98765 43210 or email user@test.com' },
      { id: 'e2', tag: 'DIV', text: 'PAN: ABCPD1234E' }
    ]
  };
  const matches = [
    {
      elementId: 'e1',
      matches: [
        { type: 'PHONE', value: '+91 98765 43210', start: 5, end: 20, confidence: 1.0, method: 'REGEX' },
        { type: 'EMAIL', value: 'user@test.com', start: 30, end: 43, confidence: 1.0, method: 'REGEX' }
      ]
    },
    {
      elementId: 'e2',
      matches: [
        { type: 'PAN', value: 'ABCPD1234E', start: 5, end: 15, confidence: 1.0, method: 'REGEX' }
      ]
    }
  ];

  const result = redactDOM(domSnapshot, matches, 'test_session_2');
  assertEqual(result.sanitizedDOM.elements[0].text, 'Call [PHONE_1] or email [EMAIL_1]');
  assertEqual(result.sanitizedDOM.elements[1].text, 'PAN: [PAN_1]');
  assertEqual(result.redactionMap.tokens['[PHONE_1]'], '+91 98765 43210');
  assertEqual(result.redactionMap.tokens['[EMAIL_1]'], 'user@test.com');
  assertEqual(result.redactionMap.tokens['[PAN_1]'], 'ABCPD1234E');
  assertEqual(result.privacyStats.pii_tokens_masked, 3);
  assertEqual(result.privacyStats.dom_masked_fields, 2);
});

// Group 2: Token Reuse & Deduplication
console.log('\n🔄 Group 2: Token Reuse & Deduplication');

test('Reuses identical token for same PII value appearing multiple times', () => {
  resetCounters('test_session_3');
  const domSnapshot = {
    elements_count: 2,
    elements: [
      { id: 'e1', tag: 'P', text: 'Contact aditya@gmail.com for help.' },
      { id: 'e2', tag: 'SPAN', text: 'Your account: aditya@gmail.com' }
    ]
  };
  const matches = [
    {
      elementId: 'e1',
      matches: [
        { type: 'EMAIL', value: 'aditya@gmail.com', start: 8, end: 24, confidence: 1.0, method: 'REGEX' }
      ]
    },
    {
      elementId: 'e2',
      matches: [
        { type: 'EMAIL', value: 'aditya@gmail.com', start: 14, end: 30, confidence: 1.0, method: 'REGEX' }
      ]
    }
  ];

  const result = redactDOM(domSnapshot, matches, 'test_session_3');
  assertEqual(result.sanitizedDOM.elements[0].text, 'Contact [EMAIL_1] for help.');
  assertEqual(result.sanitizedDOM.elements[1].text, 'Your account: [EMAIL_1]');
  // Same token used across elements
  assertEqual(Object.keys(result.redactionMap.tokens).length, 1);
  assertEqual(result.redactionMap.tokens['[EMAIL_1]'], 'aditya@gmail.com');
  assertEqual(result.tokenManifest.tokens_used, ['[EMAIL_1]']);
});

// Group 3: Longest-Match-First Replacement
console.log('\n📏 Group 3: Longest-Match-First Replacement');

test('Longest match is replaced first to prevent substring corruption', () => {
  resetCounters('test_session_4');
  const domSnapshot = {
    elements_count: 1,
    elements: [
      { id: 'e1', tag: 'DIV', text: 'Aditya Sharma (email: aditya@gmail.com)' }
    ]
  };
  // Simulate both an email match and a name match where name is substring of email
  const matches = [
    {
      elementId: 'e1',
      matches: [
        { type: 'NAME', value: 'Aditya Sharma', start: 0, end: 13, confidence: 0.9, method: 'NER' },
        { type: 'EMAIL', value: 'aditya@gmail.com', start: 22, end: 38, confidence: 1.0, method: 'REGEX' },
        { type: 'NAME', value: 'aditya', start: 22, end: 28, confidence: 0.85, method: 'NER' }
      ]
    }
  ];

  const result = redactDOM(domSnapshot, matches, 'test_session_4');
  // 'aditya@gmail.com' (16 chars) must be replaced before 'aditya' (6 chars)
  assertEqual(result.sanitizedDOM.elements[0].text, '[NAME_1] (email: [EMAIL_1])');
  assertEqual(result.redactionMap.tokens['[EMAIL_1]'], 'aditya@gmail.com');
  assertEqual(result.redactionMap.tokens['[NAME_1]'], 'Aditya Sharma');
});

// Group 4: Password Fields Redaction
console.log('\n🔑 Group 4: Password Fields Redaction');

test('Password fields are replaced with [PASSWORD_FIELD]', () => {
  resetCounters('test_session_5');
  const domSnapshot = {
    elements_count: 1,
    elements: [
      { id: 'pwd', tag: 'INPUT', type: 'password', text: 'SuperSecret123', value: 'SuperSecret123' }
    ]
  };
  const matches = [
    {
      elementId: 'pwd',
      matches: [
        { type: 'PASSWORD_FIELD', value: '[hidden]', start: 0, end: 0, confidence: 1.0, method: 'REGEX' }
      ]
    }
  ];

  const result = redactDOM(domSnapshot, matches, 'test_session_5');
  assertEqual(result.sanitizedDOM.elements[0].text, '[PASSWORD_FIELD]');
  assertEqual(result.sanitizedDOM.elements[0].value, '[PASSWORD_FIELD]');
  assertEqual(result.privacyStats.pii_breakdown.other, 1);
  assertEqual(result.privacyStats.detection_methods.dom_attribute, 1);
});

// Group 5: Token Resolution & Restoration
console.log('\n🔓 Group 5: Token Resolution & Restoration');

test('resolveToken retrieves original value', () => {
  const map = {
    tokens: {
      '[EMAIL_1]': 'test@example.com',
      '[PAN_1]': 'ABCPD1234E'
    }
  };
  assertEqual(resolveToken(map, '[EMAIL_1]'), 'test@example.com');
  assertEqual(resolveToken(map, '[PAN_1]'), 'ABCPD1234E');
  assertEqual(resolveToken(map, '[CARD_1]'), null);
  assertEqual(resolveToken(null, '[EMAIL_1]'), null);
});

test('restoreTokens accurately restores text containing multiple tokens', () => {
  const map = {
    tokens: {
      '[EMAIL_1]': 'aditya@gmail.com',
      '[PHONE_1]': '+91 98765 43210',
      '[NAME_1]': 'Aditya'
    }
  };
  const tokenized = 'Hello [NAME_1], we will call [PHONE_1] or email [EMAIL_1].';
  const expected = 'Hello Aditya, we will call +91 98765 43210 or email aditya@gmail.com.';
  assertEqual(restoreTokens(tokenized, map), expected);
});

test('restoreTokens handles text with no tokens gracefully', () => {
  const map = { tokens: { '[EMAIL_1]': 'aditya@gmail.com' } };
  assertEqual(restoreTokens('Normal text with no tokens', map), 'Normal text with no tokens');
});

// Group 6: Full Fixture Pipeline (Regex + Redaction on dom_with_pii.json)
console.log('\n🧪 Group 6: Full Fixture Pipeline (dom_with_pii.json)');

test('Full pipeline on dom_with_pii.json sanitizes all sensitive data correctly', () => {
  resetCounters('test_session_fixture');
  const domPath = join(__dirname, '..', '..', '..', 'fixtures', 'dom_with_pii.json');
  const rawDOM = JSON.parse(readFileSync(domPath, 'utf8'));

  // Step 1: Scan with regex
  const domMatches = scanDOMElements(rawDOM.elements);
  assertTrue(domMatches.length > 0, 'Should find PII matches in fixture');

  // Step 2: Redact DOM
  const redactedResult = redactDOM(rawDOM, domMatches, 'test_session_fixture');
  const sanitized = redactedResult.sanitizedDOM;

  // Verify elements:
  const elMap = {};
  for (const el of sanitized.elements) {
    elMap[el.id] = el;
  }

  // e_2: email
  assertEqual(elMap['e_2'].text, '[EMAIL_1]', 'Email should be tokenized');
  assertEqual(redactedResult.redactionMap.tokens['[EMAIL_1]'], 'aditya.sharma@gmail.com');

  // e_3: phone
  assertEqual(elMap['e_3'].text, '[PHONE_1]', 'Phone should be tokenized');
  assertEqual(redactedResult.redactionMap.tokens['[PHONE_1]'], '+91 98765 43210');

  // e_4: credit card
  assertEqual(elMap['e_4'].text, '[CARD_1]', 'Credit card should be tokenized');
  assertEqual(redactedResult.redactionMap.tokens['[CARD_1]'], '4532 0151 1283 0366');

  // e_5: PAN
  assertEqual(elMap['e_5'].text, 'PAN: [PAN_1]', 'PAN should be tokenized');
  assertEqual(redactedResult.redactionMap.tokens['[PAN_1]'], 'ABCPD1234E');

  // e_6: Aadhaar
  assertEqual(elMap['e_6'].text, 'Aadhaar: [AADHAAR_1]', 'Aadhaar should be tokenized');
  assertEqual(redactedResult.redactionMap.tokens['[AADHAAR_1]'], '2345 6789 0123');

  // e_7: UPI
  assertEqual(elMap['e_7'].text, 'UPI: [UPI_1]', 'UPI should be tokenized');
  assertEqual(redactedResult.redactionMap.tokens['[UPI_1]'], 'aditya@ybl');

  // e_8: DOB
  assertEqual(elMap['e_8'].text, 'Date of Birth: [DOB_1]', 'DOB should be tokenized');
  assertEqual(redactedResult.redactionMap.tokens['[DOB_1]'], '15/03/1998');

  // e_10: password input
  assertEqual(elMap['e_10'].text, '[PASSWORD_FIELD]', 'Password should be masked');

  // e_11: IFSC
  assertEqual(elMap['e_11'].text, 'IFSC: [IFSC_1]', 'IFSC should be tokenized');
  assertEqual(redactedResult.redactionMap.tokens['[IFSC_1]'], 'HDFC0001234');

  // e_12: Passport
  assertEqual(elMap['e_12'].text, 'Passport: [PASSPORT_1]', 'Passport should be tokenized');
  assertEqual(redactedResult.redactionMap.tokens['[PASSPORT_1]'], 'J1234567');

  // SMART EXCLUSION CHECKS:
  // e_footer_1: helpline (1800-123-4567) and support email (support@example.com) in footer
  assertEqual(elMap['e_footer_1'].text, 'Call us: 1800-123-4567 | support@example.com', 'Footer contacts must be preserved');

  // NON-PII CHECKS:
  // e_product_1: product name
  assertEqual(elMap['e_product_1'].text, 'boAt Bassheads 100 — ₹449', 'Product 1 must be kept');

  // e_product_2: product name
  assertEqual(elMap['e_product_2'].text, 'Sony WH-1000XM5 — ₹24,990', 'Product 2 must be kept');

  // Verify privacyStats totals
  assertTrue(redactedResult.privacyStats.pii_tokens_masked >= 8, 'At least 8 PII tokens masked');
  assertTrue(redactedResult.privacyStats.dom_masked_fields >= 8, 'At least 8 fields modified');
  assertTrue(redactedResult.tokenManifest.total_tokens >= 8, 'Token manifest has count');
});

// Group 7: Clean DOM Idempotency
console.log('\n✨ Group 7: Clean DOM Idempotency (dom_clean.json)');

test('Clean e-commerce DOM produces zero redactions', () => {
  resetCounters('test_session_clean');
  const cleanPath = join(__dirname, '..', '..', '..', 'fixtures', 'dom_clean.json');
  const rawCleanDOM = JSON.parse(readFileSync(cleanPath, 'utf8'));

  const domMatches = scanDOMElements(rawCleanDOM.elements);
  const redactedResult = redactDOM(rawCleanDOM, domMatches, 'test_session_clean');

  assertEqual(redactedResult.privacyStats.pii_tokens_masked, 0, 'No tokens should be masked');
  assertEqual(redactedResult.privacyStats.dom_masked_fields, 0, 'No fields should be modified');
  assertEqual(Object.keys(redactedResult.redactionMap.tokens).length, 0, 'Redaction map should be empty');
  assertEqual(redactedResult.tokenManifest.total_tokens, 0, 'Token manifest should have 0 tokens');
  assertEqual(redactedResult.sanitizedDOM.elements.length, rawCleanDOM.elements.length, 'Element count preserved');
});

// Group 8: Audit Metadata & Severity Classification (Dashboard UI Support)
console.log('\n🛡️ Group 8: Audit Metadata & Category Classification (Dashboard UI)');

test('Correctly categorizes PII severity tiers (SPII vs PII vs CONTEXTUAL)', () => {
  assertEqual(getPIICategory('AADHAAR'), 'SPII');
  assertEqual(getPIICategory('PAN'), 'SPII');
  assertEqual(getPIICategory('CARD'), 'SPII');
  assertEqual(getPIICategory('PASSWORD_FIELD'), 'SPII');
  assertEqual(getPIICategory('VOTER_ID'), 'SPII');
  assertEqual(getPIICategory('DL'), 'SPII');
  assertEqual(getPIICategory('EPFO_UAN'), 'SPII');
  assertEqual(getPIICategory('BANK_ACCOUNT'), 'SPII');
  assertEqual(getPIICategory('EMAIL'), 'PII');
  assertEqual(getPIICategory('PHONE'), 'PII');
  assertEqual(getPIICategory('NAME'), 'PII');
  assertEqual(getPIICategory('UPI'), 'PII');
  assertEqual(getPIICategory('VEHICLE_RC'), 'PII');
  assertEqual(getPIICategory('DOB'), 'CONTEXTUAL');
  assertEqual(getPIICategory('IFSC'), 'CONTEXTUAL');
});

test('redactDOM populates rich tokenAudit array with method, confidence, and elementId', () => {
  resetCounters('test_session_audit');
  const domSnapshot = {
    elements_count: 2,
    elements: [
      { id: 'el_email', tag: 'SPAN', text: 'Contact: aditya@gmail.com' },
      { id: 'el_pwd', tag: 'INPUT', type: 'password', text: 'secret' }
    ]
  };
  const matches = [
    {
      elementId: 'el_email',
      matches: [
        { type: 'EMAIL', value: 'aditya@gmail.com', start: 9, end: 25, confidence: 1.0, method: 'REGEX' }
      ]
    }
  ];

  const result = redactDOM(domSnapshot, matches, 'test_session_audit');
  assertTrue(Array.isArray(result.tokenAudit), 'tokenAudit should be an array');
  assertEqual(result.tokenAudit.length, 2, 'Should contain 2 audit entries');

  const emailAudit = result.tokenAudit.find(a => a.token === '[EMAIL_1]');
  assertTrue(!!emailAudit, 'Email audit exists');
  assertEqual(emailAudit.type, 'EMAIL');
  assertEqual(emailAudit.category, 'PII');
  assertEqual(emailAudit.method, 'REGEX');
  assertEqual(emailAudit.confidence, 1.0);
  assertEqual(emailAudit.elementId, 'el_email');

  const pwdAudit = result.tokenAudit.find(a => a.token === '[PASSWORD_FIELD]');
  assertTrue(!!pwdAudit, 'Password audit exists');
  assertEqual(pwdAudit.type, 'PASSWORD_FIELD');
  assertEqual(pwdAudit.category, 'SPII');
  assertEqual(pwdAudit.method, 'DOM_ATTRIBUTE');
  assertEqual(pwdAudit.elementId, 'el_pwd');
});

// Group 9: Incremental DOM Scanning (Agentic Loop Optimization)
console.log('\n⚡ Group 9: Incremental DOM Scanning (Action Loop Support)');

test('redactIncrementalDOM re-scans only modified or added elements', () => {
  resetCounters('test_session_incremental');
  const prevDOM = {
    elements_count: 3,
    elements: [
      { id: 'e1', tag: 'H1', text: 'Dashboard' },
      { id: 'e2', tag: 'SPAN', text: 'aditya@gmail.com' },
      { id: 'e3', tag: 'DIV', text: 'Some static text' }
    ]
  };

  // Next step: e1 and e3 are unchanged, e2 is unchanged, e4 is added with a phone number
  const nextDOM = {
    elements_count: 4,
    elements: [
      { id: 'e1', tag: 'H1', text: 'Dashboard' },
      { id: 'e2', tag: 'SPAN', text: 'aditya@gmail.com' },
      { id: 'e3', tag: 'DIV', text: 'Some static text' },
      { id: 'e4', tag: 'SPAN', text: 'Phone: +91 98765 43210' }
    ]
  };

  let scanCount = 0;
  const trackingScanFn = (elements) => {
    scanCount += elements.length;
    return scanDOMElements(elements);
  };

  const result = redactIncrementalDOM(prevDOM, nextDOM, trackingScanFn, 'test_session_incremental');
  assertEqual(result.incrementalStats.total, 4, 'Total elements is 4');
  assertEqual(result.incrementalStats.unchanged, 3, '3 elements were unchanged');
  assertEqual(result.incrementalStats.changed, 1, '1 element was newly added/changed');
  assertTrue(result.incrementalStats.timeMs >= 0, 'Reported execution time in ms');

  // Verify sanitized output contains both tokens
  const elMap = {};
  for (const el of result.sanitizedDOM.elements) {
    elMap[el.id] = el;
  }
  assertEqual(elMap['e2'].text, '[EMAIL_1]');
  assertEqual(elMap['e4'].text, 'Phone: [PHONE_1]');
});

test('redactIncrementalDOM achieves true diff-only scanning without rescanning unchanged elements', () => {
  const sessionId = 'test_diff_only_session';
  resetCounters(sessionId);

  const prevDOM = {
    elements_count: 3,
    elements: [
      { id: 'e1', tag: 'H1', text: 'Dashboard' },
      { id: 'e2', tag: 'SPAN', text: 'aditya@gmail.com' },
      { id: 'e3', tag: 'DIV', text: 'Some static text' }
    ]
  };

  // Initial scan of prevDOM
  const initialMatches = scanDOMElements(prevDOM.elements);
  const initialResult = redactDOM(prevDOM, initialMatches, sessionId);
  assertEqual(initialResult.sanitizedDOM.elements[1].text, '[EMAIL_1]');

  // Next step: e1, e2, e3 unchanged; e5 added with a PAN number
  const nextDOM = {
    elements_count: 4,
    elements: [
      { id: 'e1', tag: 'H1', text: 'Dashboard' },
      { id: 'e2', tag: 'SPAN', text: 'aditya@gmail.com' },
      { id: 'e3', tag: 'DIV', text: 'Some static text' },
      { id: 'e5', tag: 'SPAN', text: 'PAN: ABCPE1234F' }
    ]
  };

  let scanCount = 0;
  const trackingScanFn = (elements) => {
    scanCount += elements.length;
    return scanDOMElements(elements);
  };

  const incResult = redactIncrementalDOM(prevDOM, nextDOM, trackingScanFn, sessionId);
  assertEqual(scanCount, 1, 'Only exactly 1 changed element was scanned');
  assertEqual(incResult.incrementalStats.unchanged, 3, '3 elements were identified as unchanged');
  assertEqual(incResult.incrementalStats.changed, 1, '1 element was changed');

  // Verify unchanged e2 kept its token [EMAIL_1] and did NOT create [EMAIL_2]
  const elMap = {};
  for (const el of incResult.sanitizedDOM.elements) {
    elMap[el.id] = el;
  }
  assertEqual(elMap['e2'].text, '[EMAIL_1]');
  assertEqual(elMap['e5'].text, 'PAN: [PAN_1]');
  assertEqual(resolveToken(incResult.redactionMap, '[EMAIL_1]'), 'aditya@gmail.com');
  assertEqual(resolveToken(incResult.redactionMap, '[PAN_1]'), 'ABCPE1234F');
});

// ─── Summary ───────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(50));
console.log(`📊 Test Results: ${passedTests}/${totalTests} passed, ${failedTests} failed`);
console.log('─'.repeat(50));

if (failedTests > 0) {
  process.exit(1);
}
