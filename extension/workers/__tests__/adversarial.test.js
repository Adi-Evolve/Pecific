/**
 * adversarial.test.js — Adversarial Edge-Case & Stress Tests
 * PrivacyLens Privacy Engine (Dev 3 — R3)
 * Run with: node extension/workers/__tests__/adversarial.test.js
 * 
 * Verifies high recall and surgical precision against adversarial, obfuscated,
 * Indian-specific formatting tricks, boundary conditions, and collision attempts.
 */

import { scanRegexPII, scanDOMElements } from '../regex.js';
import { redactDOM, resetCounters, resolveToken, restoreTokens } from '../redaction.js';

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
  if (!condition) throw new Error(msg || 'Expected condition to be true');
}

function assertContainsToken(text, tokenPrefix) {
  if (!text.includes(tokenPrefix)) {
    throw new Error(`Expected text to contain token prefix "${tokenPrefix}", got: "${text}"`);
  }
}

console.log('\n🥊 Privacy Engine — Adversarial & Stress Testing\n');

// ── 1. Separators & Formatting Tricks ──────────────────────────────────────────
console.log('🧪 Section 1: Complex Formatting & Separators');

test('Detects Aadhaar with hyphen separators: 2345-6789-0123', () => {
  const matches = scanRegexPII('Aadhaar: 2345-6789-0123');
  assertEqual(matches.length, 1);
  assertEqual(matches[0].type, 'AADHAAR');
  assertEqual(matches[0].value, '2345-6789-0123');
});

test('Detects PAN with lowercase letters: abcpd1234e', () => {
  const matches = scanRegexPII('PAN card is abcpd1234e');
  assertEqual(matches.length, 1);
  assertEqual(matches[0].type, 'PAN');
  assertEqual(matches[0].value.toUpperCase(), 'ABCPD1234E');
});

test('Detects Indian phone with dashes: +91-98765-43210', () => {
  const matches = scanRegexPII('Reach me at +91-98765-43210');
  assertEqual(matches.length, 1);
  assertEqual(matches[0].type, 'PHONE');
  assertEqual(matches[0].value, '+91-98765-43210');
});

test('Detects complex email with plus-addressing: user.name+tag@sub.example.co.in', () => {
  const matches = scanRegexPII('Send to user.name+tag@sub.example.co.in please');
  assertEqual(matches.length, 1);
  assertEqual(matches[0].type, 'EMAIL');
  assertEqual(matches[0].value, 'user.name+tag@sub.example.co.in');
});

test('Detects UPI IDs with multiple leading segments: merchant.pay-99@okicici', () => {
  const matches = scanRegexPII('Pay to merchant.pay-99@okicici');
  assertEqual(matches.length, 1);
  assertEqual(matches[0].type, 'UPI');
  assertEqual(matches[0].value, 'merchant.pay-99@okicici');
});

test('Detects Luhn-valid credit card formatted with dashes: 4532-0151-1283-0366', () => {
  const matches = scanRegexPII('Card 4532-0151-1283-0366');
  assertEqual(matches.length, 1);
  assertEqual(matches[0].type, 'CARD');
  assertEqual(matches[0].value, '4532-0151-1283-0366');
});

// ── 2. Boundary & Punctuation Injections ────────────────────────────────────────
console.log('\n🧱 Section 2: Boundary & Punctuation Injections');

test('Handles PII wrapped tightly in parentheses and quotes', () => {
  const text = '("aditya@gmail.com") / [+91 98765 43210] / {ABCPD1234E}';
  const matches = scanRegexPII(text);
  assertEqual(matches.length, 3);
  assertEqual(matches.map(m => m.type).sort(), ['EMAIL', 'PAN', 'PHONE']);
});

test('Extracts PII from query parameters in href', () => {
  const href = 'https://example.com/auth?redirect=home&email=user@test.org&phone=9876543210';
  const matches = scanRegexPII(href);
  assertEqual(matches.length, 2);
  assertEqual(matches.map(m => m.type).sort(), ['EMAIL', 'PHONE']);
});

// ── 3. Adversarial False Positive Resistance ───────────────────────────────────
console.log('\n🛡️ Section 3: False Positive Resistance Under Adversarial Strings');

test('Rejects product order IDs formatted like 16-18 digit sequences: OD123456789012345678', () => {
  const matches = scanRegexPII('Order ID: OD123456789012345678');
  assertEqual(matches.length, 0, 'Long order ID should not match Aadhaar or credit card');
});

test('Rejects hex color codes: #FFFFFF, #00AABB', () => {
  const matches = scanRegexPII('Colors: #FFFFFF, #00AABB, background: #C0C0C0');
  assertEqual(matches.length, 0, 'Hex colors must not match PAN');
});

test('Rejects screen resolution strings: 1920x1080 and 3840x2160', () => {
  const matches = scanRegexPII('Resolution: 1920x1080, 4K: 3840x2160');
  assertEqual(matches.length, 0);
});

test('Rejects prices in Indian rupees: ₹1,49,999 and ₹999', () => {
  const matches = scanRegexPII('Total Price: ₹1,49,999 (was ₹1,79,999)');
  assertEqual(matches.length, 0);
});

test('Rejects product model numbers: Sony WH-1000XM5 and Bose QC45', () => {
  const matches = scanRegexPII('Models: Sony WH-1000XM5, Sennheiser HD660S, Bose QC45');
  assertEqual(matches.length, 0);
});

// ── 4. Nested Tokens & Collision Resistance ────────────────────────────────────
console.log('\n🔒 Section 4: Token Collision & Substitution Integrity');

test('Nested substrings in same sentence do not cause double-tokenization corruption', () => {
  resetCounters('test_collision');
  const dom = {
    elements_count: 1,
    elements: [
      { 
        id: 'el_nested',
        tag: 'DIV',
        text: 'User Aditya Sharma (aditya.sharma@gmail.com) paid UPI aditya@ybl'
      }
    ]
  };

  const matches = [
    {
      elementId: 'el_nested',
      matches: [
        { type: 'NAME', value: 'Aditya Sharma', start: 5, end: 18, confidence: 0.9, method: 'NER' },
        { type: 'EMAIL', value: 'aditya.sharma@gmail.com', start: 20, end: 43, confidence: 1.0, method: 'REGEX' },
        { type: 'UPI', value: 'aditya@ybl', start: 53, end: 63, confidence: 1.0, method: 'REGEX' }
      ]
    }
  ];

  const result = redactDOM(dom, matches, 'test_collision');
  const sanitizedText = result.sanitizedDOM.elements[0].text;

  // The email should NOT contain [NAME_1] inside it
  assertEqual(sanitizedText, 'User [NAME_1] ([EMAIL_1]) paid UPI [UPI_1]');
  
  // Verify restore works cleanly
  const restored = restoreTokens(sanitizedText, result.redactionMap);
  assertEqual(restored, 'User Aditya Sharma (aditya.sharma@gmail.com) paid UPI aditya@ybl');
});

// ── 5. Cross-Session Isolation ────────────────────────────────────────────────
console.log('\n🗄️ Section 5: Session Isolation & State Cleanliness');

test('Different sessions have isolated token numbering and scopes', () => {
  resetCounters('sess_alpha');
  const domA = {
    elements_count: 1,
    elements: [{ id: 'e1', tag: 'SPAN', text: 'Email: alpha@test.com' }]
  };
  const matchesA = [{ elementId: 'e1', matches: [{ type: 'EMAIL', value: 'alpha@test.com', start: 7, end: 21 }] }];
  const resA = redactDOM(domA, matchesA, 'sess_alpha');
  assertEqual(resA.sanitizedDOM.elements[0].text, 'Email: [EMAIL_1]');
  assertEqual(resA.redactionMap.tokens['[EMAIL_1]'], 'alpha@test.com');

  // Start new session
  resetCounters('sess_beta');
  const domB = {
    elements_count: 1,
    elements: [{ id: 'e1', tag: 'SPAN', text: 'Email: beta@test.com' }]
  };
  const matchesB = [{ elementId: 'e1', matches: [{ type: 'EMAIL', value: 'beta@test.com', start: 7, end: 20 }] }];
  const resB = redactDOM(domB, matchesB, 'sess_beta');
  assertEqual(resB.sanitizedDOM.elements[0].text, 'Email: [EMAIL_1]');
  assertEqual(resB.redactionMap.tokens['[EMAIL_1]'], 'beta@test.com');

  // Verify Session A lookup is not corrupted
  assertEqual(resolveToken(resA.redactionMap, '[EMAIL_1]'), 'alpha@test.com');
  assertEqual(resolveToken(resB.redactionMap, '[EMAIL_1]'), 'beta@test.com');
});

// ─── Summary ───────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(50));
console.log(`📊 Adversarial Results: ${passedTests}/${totalTests} passed, ${failedTests} failed`);
console.log('─'.repeat(50));

if (failedTests > 0) {
  process.exit(1);
}
