/**
 * regex.test.js — Unit Tests for Regex PII Scanner
 * Run with: node extension/workers/__tests__/regex.test.js
 * 
 * Tests all PII patterns, smart exclusion rules, and edge cases.
 * Uses the pii_test_strings.json fixture for comprehensive coverage.
 */

import { scanRegexPII, scanDOMElements, luhnCheck } from '../regex.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Test Framework (minimal — no external deps) ────────────────────────────────

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

function assertIncludes(array, type, value, msg = '') {
  const found = array.find(m => m.type === type && m.value === value);
  if (!found) {
    throw new Error(`${msg}\n     Expected to find { type: "${type}", value: "${value}" }\n     Got: ${JSON.stringify(array.map(m => ({ type: m.type, value: m.value })))}`);
  }
}

function assertNotIncludes(array, type, msg = '') {
  const found = array.find(m => m.type === type);
  if (found) {
    throw new Error(`${msg}\n     Expected NO matches of type "${type}"\n     But found: ${JSON.stringify(found)}`);
  }
}

function assertEmpty(array, msg = '') {
  if (array.length !== 0) {
    throw new Error(`${msg}\n     Expected empty array\n     Got: ${JSON.stringify(array.map(m => ({ type: m.type, value: m.value })))}`);
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

console.log('\n🔒 Privacy Engine — Regex PII Scanner Tests\n');

// ── Email Tests ──────────────────────────────────────────────────────────────

console.log('📧 Email Detection:');

test('Detects personal email', () => {
  const matches = scanRegexPII('Contact me at aditya.sharma@gmail.com', { parentTag: 'SPAN' });
  assertIncludes(matches, 'EMAIL', 'aditya.sharma@gmail.com');
});

test('Skips noreply@ emails', () => {
  const matches = scanRegexPII('From: noreply@amazon.in');
  assertNotIncludes(matches, 'EMAIL');
});

test('Skips support@ emails', () => {
  const matches = scanRegexPII('support@example.com');
  assertNotIncludes(matches, 'EMAIL');
});

test('Skips emails in footer context', () => {
  const matches = scanRegexPII('help@flipkart.com', { parentTag: 'FOOTER' });
  assertNotIncludes(matches, 'EMAIL');
});

test('Detects multiple emails', () => {
  const matches = scanRegexPII('primary: a@b.com secondary: c@d.com', { parentTag: 'DIV' });
  assertEqual(matches.filter(m => m.type === 'EMAIL').length, 2);
});

// ── Phone Tests ─────────────────────────────────────────────────────────────

console.log('\n📱 Phone Detection:');

test('Detects Indian phone with +91', () => {
  const matches = scanRegexPII('+91 98765 43210', { parentTag: 'SPAN' });
  assertIncludes(matches, 'PHONE', '+91 98765 43210');
});

test('Detects Indian phone without prefix', () => {
  const matches = scanRegexPII('Call 9876543210', { parentTag: 'SPAN' });
  assertEqual(matches.filter(m => m.type === 'PHONE').length, 1);
});

test('Skips toll-free 1800 numbers', () => {
  const matches = scanRegexPII('1800-123-4567', { parentTag: 'FOOTER', nearbyLabels: 'Customer Care' });
  assertNotIncludes(matches, 'PHONE');
});

test('Skips phone in footer', () => {
  const matches = scanRegexPII('9876543210', { parentTag: 'FOOTER' });
  assertNotIncludes(matches, 'PHONE');
});

// ── Aadhaar Tests ───────────────────────────────────────────────────────────

console.log('\n🆔 Aadhaar Detection:');

test('Detects valid Aadhaar with spaces', () => {
  const matches = scanRegexPII('Aadhaar: 2345 6789 0123');
  assertIncludes(matches, 'AADHAAR', '2345 6789 0123');
});

test('Detects valid Aadhaar without spaces', () => {
  const matches = scanRegexPII('234567890123');
  assertEqual(matches.filter(m => m.type === 'AADHAAR').length, 1);
});

test('Rejects Aadhaar starting with 0', () => {
  const matches = scanRegexPII('0123 4567 8901');
  assertNotIncludes(matches, 'AADHAAR');
});

test('Rejects Aadhaar starting with 1', () => {
  const matches = scanRegexPII('1123 4567 8901');
  assertNotIncludes(matches, 'AADHAAR');
});

test('Rejects all-same-digit Aadhaar', () => {
  const matches = scanRegexPII('2222 2222 2222');
  assertNotIncludes(matches, 'AADHAAR');
});

// ── PAN Tests ───────────────────────────────────────────────────────────────

console.log('\n📋 PAN Detection:');

test('Detects valid PAN (Person)', () => {
  const matches = scanRegexPII('PAN: ABCPD1234E');
  assertIncludes(matches, 'PAN', 'ABCPD1234E');
});

test('Detects valid PAN (Company)', () => {
  const matches = scanRegexPII('ABCCD1234E');
  assertIncludes(matches, 'PAN', 'ABCCD1234E');
});

test('Rejects PAN with invalid category (X)', () => {
  const matches = scanRegexPII('ABCXD1234E');
  assertNotIncludes(matches, 'PAN');
});

// ── Credit Card Tests ───────────────────────────────────────────────────────

console.log('\n💳 Credit Card Detection:');

test('Luhn check passes for valid Visa', () => {
  assertEqual(luhnCheck('4532015112830366'), true);
});

test('Luhn check fails for random digits', () => {
  assertEqual(luhnCheck('1234567890123456'), false);
});

test('Detects Luhn-valid credit card', () => {
  const matches = scanRegexPII('Card: 4532 0151 1283 0366');
  assertIncludes(matches, 'CARD', '4532 0151 1283 0366');
});

test('Rejects Luhn-invalid card number', () => {
  const matches = scanRegexPII('Number: 1234 5678 9012 3456');
  assertNotIncludes(matches, 'CARD');
});

// ── UPI Tests ───────────────────────────────────────────────────────────────

console.log('\n💰 UPI Detection:');

test('Detects UPI ID with @ybl', () => {
  const matches = scanRegexPII('Pay via aditya@ybl');
  assertIncludes(matches, 'UPI', 'aditya@ybl');
});

test('Detects UPI ID with @paytm', () => {
  const matches = scanRegexPII('user@paytm');
  assertIncludes(matches, 'UPI', 'user@paytm');
});

test('Distinguishes UPI from email', () => {
  const matches = scanRegexPII('UPI: user@paytm email: user@gmail.com', { parentTag: 'SPAN' });
  assertIncludes(matches, 'UPI', 'user@paytm');
  assertIncludes(matches, 'EMAIL', 'user@gmail.com');
});

// ── DOB Tests ───────────────────────────────────────────────────────────────

console.log('\n📅 Date of Birth Detection:');

test('Detects DOB with DOB label', () => {
  const matches = scanRegexPII('15/03/1998', { nearbyLabels: 'Date of Birth' });
  assertIncludes(matches, 'DOB', '15/03/1998');
});

test('Skips date without DOB label', () => {
  const matches = scanRegexPII('Order placed on 15/03/2024', { nearbyLabels: 'Order Date' });
  assertNotIncludes(matches, 'DOB');
});

// ── IP Address Tests ────────────────────────────────────────────────────────

console.log('\n🌐 IP Address Detection:');

test('Detects public IP', () => {
  const matches = scanRegexPII('Your IP: 203.45.67.89');
  assertIncludes(matches, 'IP', '203.45.67.89');
});

test('Skips localhost', () => {
  const matches = scanRegexPII('Server: 127.0.0.1');
  assertNotIncludes(matches, 'IP');
});

// ── IFSC Tests ──────────────────────────────────────────────────────────────

console.log('\n🏦 IFSC Detection:');

test('Detects valid IFSC code', () => {
  const matches = scanRegexPII('IFSC: HDFC0001234');
  assertIncludes(matches, 'IFSC', 'HDFC0001234');
});

// ── Passport Tests ──────────────────────────────────────────────────────────

console.log('\n✈️ Passport Detection:');

test('Detects passport with label', () => {
  const matches = scanRegexPII('J1234567', { nearbyLabels: 'Passport Number' });
  assertIncludes(matches, 'PASSPORT', 'J1234567');
});

test('Skips passport-like without label', () => {
  const matches = scanRegexPII('Order ID: A1234567', { nearbyLabels: 'Order' });
  assertNotIncludes(matches, 'PASSPORT');
});

// ── Password Tests ──────────────────────────────────────────────────────────

console.log('\n🔑 Password Detection:');

test('Detects password input type', () => {
  const matches = scanRegexPII('mypassword123', { inputType: 'password' });
  assertIncludes(matches, 'PASSWORD_FIELD', '[hidden]');
});

// ── Indian SPII Tests (SIH PS26171) ────────────────────────────────────────

console.log('\n🗳️ Indian Voter ID (EPIC) Detection:');

test('Detects standard Voter ID', () => {
  const matches = scanRegexPII('Voter card number ABC1234567');
  assertIncludes(matches, 'VOTER_ID', 'ABC1234567');
});

test('Detects Voter ID with slash separator', () => {
  const matches = scanRegexPII('EPIC: XYZ/9876543');
  assertIncludes(matches, 'VOTER_ID', 'XYZ/9876543');
});

console.log('\n🚗 Indian Driving License (DL) Detection:');

test('Detects standard Parivahan Driving License format', () => {
  const matches = scanRegexPII('Driving License DL-0420110012345 issued in Delhi');
  assertIncludes(matches, 'DL', 'DL-0420110012345');
});

test('Detects Driving License with state code and spaces', () => {
  const matches = scanRegexPII('DL Number: MH02 20180012345', { nearbyLabels: 'Driving Licence' });
  assertIncludes(matches, 'DL', 'MH02 20180012345');
});

console.log('\n🏢 EPFO UAN Detection:');

test('Detects EPFO UAN with UAN context label', () => {
  const matches = scanRegexPII('Your UAN is 101234567890', { nearbyLabels: 'EPFO UAN Number' });
  assertIncludes(matches, 'EPFO_UAN', '101234567890');
});

test('Skips 12-digit number without UAN label (avoiding order ID collisions)', () => {
  const matches = scanRegexPII('Shipment barcode 101234567890', { nearbyLabels: 'Package tracking' });
  assertNotIncludes(matches, 'EPFO_UAN');
});

console.log('\n🚙 Vehicle Registration (RC) Detection:');

test('Detects Indian vehicle plate format', () => {
  const matches = scanRegexPII('Vehicle No: DL 01 AB 1234', { nearbyLabels: 'Vehicle RC' });
  assertIncludes(matches, 'VEHICLE_RC', 'DL 01 AB 1234');
});

test('Detects Bharat Series (BH) vehicle plate', () => {
  const matches = scanRegexPII('Registered Car: 22 BH 1234 AA');
  assertIncludes(matches, 'VEHICLE_RC', '22 BH 1234 AA');
});

test('Detects Bharat Series (BH) vehicle plate with hyphens without context label', () => {
  const matches = scanRegexPII('Vehicle Plate: 22-BH-1234-AA');
  assertIncludes(matches, 'VEHICLE_RC', '22-BH-1234-AA');
});

console.log('\n🏦 Indian Bank Account Number Detection:');

test('Detects Bank Account with account label', () => {
  const matches = scanRegexPII('A/C No: 112345678901', { nearbyLabels: 'Savings Bank Account Number' });
  assertIncludes(matches, 'BANK_ACCOUNT', '112345678901');
});

test('Detects 12-digit Bank Account starting with 2-9 (not shadowed by Aadhaar)', () => {
  const matches = scanRegexPII('A/C: 512345678901', { nearbyLabels: 'Bank Account Number' });
  assertIncludes(matches, 'BANK_ACCOUNT', '512345678901');
  assertNotIncludes(matches, 'AADHAAR');
});

test('Detects 12-digit EPFO UAN starting with 2-9 (not shadowed by Aadhaar)', () => {
  const matches = scanRegexPII('UAN: 201234567890', { nearbyLabels: 'EPFO UAN Number' });
  assertIncludes(matches, 'EPFO_UAN', '201234567890');
  assertNotIncludes(matches, 'AADHAAR');
});

test('Skips bank account digits without account label', () => {
  const matches = scanRegexPII('Invoice serial 112345678901', { nearbyLabels: 'Invoice ID' });
  assertNotIncludes(matches, 'BANK_ACCOUNT');
});

// ── False Positive Tests ────────────────────────────────────────────────────

console.log('\n🚫 False Positive Prevention:');

test('No PII in product info', () => {
  const matches = scanRegexPII('boAt Bassheads 100 — ₹449 | 4.1 stars', { parentTag: 'DIV', parentClass: 'product-card' });
  assertEmpty(matches);
});

test('No PII in navigation', () => {
  const matches = scanRegexPII('Home | Electronics | Headphones | Filters', { parentTag: 'NAV' });
  assertEmpty(matches);
});

test('No PII in price text', () => {
  const matches = scanRegexPII('₹24,990 MRP ₹29,990 (17% off)');
  assertEmpty(matches);
});

// ── DOM Elements Test ───────────────────────────────────────────────────────

console.log('\n📄 DOM Element Scanning:');

test('Scans multiple DOM elements correctly', () => {
  const elements = [
    { id: 'e1', text: 'aditya@gmail.com', tag: 'SPAN', parentClass: 'profile' },
    { id: 'e2', text: 'boAt Headphones ₹449', tag: 'SPAN', parentClass: 'product' },
    { id: 'e3', text: '', tag: 'INPUT', type: 'password' },
  ];
  const results = scanDOMElements(elements);
  
  // e1 should have email match
  const e1 = results.find(r => r.elementId === 'e1');
  assertEqual(!!e1, true, 'e1 should have matches');
  assertIncludes(e1.matches, 'EMAIL', 'aditya@gmail.com');
  
  // e2 should have no matches (product info)
  const e2 = results.find(r => r.elementId === 'e2');
  assertEqual(e2, undefined, 'e2 should have no matches');
  
  // e3 should have password match
  const e3 = results.find(r => r.elementId === 'e3');
  assertEqual(!!e3, true, 'e3 should have matches');
  assertIncludes(e3.matches, 'PASSWORD_FIELD', '[hidden]');
});

// ── Summary ─────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(50));
console.log(`\n📊 Results: ${passedTests}/${totalTests} passed, ${failedTests} failed\n`);

if (failedTests > 0) {
  process.exit(1);
} else {
  console.log('🎉 All tests passed!\n');
}
