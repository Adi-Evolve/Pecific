/**
 * privacy_client.test.js — Test Suite for privacy-client.js Interface
 * Verifies the 3-line helper module, on-device vault isolation, and zero-egress checks.
 */

import { 
  sanitizeDOMSnapshot, 
  redactIncrementalDOMSnapshot, 
  resolveVaultToken, 
  restoreVaultText, 
  getPrivacyTelemetry, 
  verifyZeroEgress, 
  resetSessionVault,
  PrivacyClient 
} from '../privacy-client.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${message} (Expected: ${expected}, Actual: ${actual})`);
  }
}

async function runTests() {
  console.log('\n🔒 Privacy Client — Integration & Helper Module Tests');

  resetSessionVault('test_client_session');

  // Sample DOM Snapshot containing standard PII and Indian SPII
  const rawDOM = {
    url: 'https://service-portal.gov.in/profile',
    title: 'Citizen Profile & Services',
    viewport: { width: 1280, height: 800 },
    elements_count: 6,
    elements: [
      { id: 'el_header', tag: 'H1', text: 'Welcome, Aditya Sharma' },
      { id: 'el_email', tag: 'INPUT', type: 'text', value: 'aditya.sharma@gov.in', selector: '#user-email' },
      { id: 'el_voter', tag: 'SPAN', text: 'Voter ID: ABC1234567', selector: '#epic-badge' },
      { id: 'el_dl', tag: 'DIV', text: 'Driving License: DL-0420110012345', selector: '.dl-info' },
      { id: 'el_bank', tag: 'INPUT', type: 'text', value: '112345678901', nearbyLabels: 'Bank Account Number', selector: '#bank-acc' },
      { id: 'el_pwd', tag: 'INPUT', type: 'password', value: 'GovSecret@2026', selector: '#login-pass' },
    ]
  };

  // ── Test 1: 3-Line Helper Module Execution ─────────────────────────────────
  console.log('\n📦 Group 1: 3-Line Asynchronous Helper Module');
  
  // Dev 1 3-line pattern:
  const result = await sanitizeDOMSnapshot(rawDOM, null, { sessionId: 'test_client_session' });
  
  assert(!!result.sanitizedDOM, 'Returns sanitizedDOM');
  assert(!!result.tokenManifest, 'Returns tokenManifest');
  assert(!!result.clientVault, 'Returns clientVault');
  assertEqual(result.sanitizedDOM.elements_count, 6, 'Preserves element count exactly');

  // Check token substitutions
  const sanitizedJson = JSON.stringify(result.sanitizedDOM);
  assert(!sanitizedJson.includes('aditya.sharma@gov.in'), 'Raw email NOT present in sanitized DOM');
  assert(!sanitizedJson.includes('ABC1234567'), 'Raw Voter ID NOT present in sanitized DOM');
  assert(!sanitizedJson.includes('DL-0420110012345'), 'Raw DL NOT present in sanitized DOM');
  assert(!sanitizedJson.includes('112345678901'), 'Raw Bank Account NOT present in sanitized DOM');
  assert(!sanitizedJson.includes('GovSecret@2026'), 'Raw password NOT present in sanitized DOM');

  // Check token manifest
  const manifest = result.tokenManifest;
  assert(manifest.tokens_used.length >= 4, 'Manifest tracks all masked tokens');
  assert(manifest.tokens_used.some(t => t.startsWith('[EMAIL_')), 'Tracks EMAIL token');
  assert(manifest.tokens_used.some(t => t.startsWith('[VOTER_ID_')), 'Tracks VOTER_ID token');
  assert(manifest.tokens_used.some(t => t.startsWith('[DL_')), 'Tracks DL token');
  assert(manifest.tokens_used.some(t => t.startsWith('[BANK_ACCOUNT_')), 'Tracks BANK_ACCOUNT token');

  // ── Test 2: Zero-Egress Verification ───────────────────────────────────────
  console.log('\n🛡️ Group 2: Zero-Egress Assurance Engine');
  
  assertEqual(result.zeroEgressProof.safe, true, 'Zero egress verification reports safe');
  assertEqual(result.zeroEgressProof.leakedCount, 0, 'Zero secrets leaked into sanitized DOM');

  // Adversarial check: deliberately inject a raw secret into a DOM clone
  const taintedDOM = JSON.parse(JSON.stringify(result.sanitizedDOM));
  taintedDOM.elements[0].text = 'Leaked email: aditya.sharma@gov.in';
  const breachCheck = verifyZeroEgress(taintedDOM, 'test_client_session');
  assertEqual(breachCheck.safe, false, 'Detects deliberate raw secret leakage');
  assertEqual(breachCheck.leakedCount, 1, 'Accurately reports 1 leaked token');

  // ── Test 3: Local Action Vault Resolution ──────────────────────────────────
  console.log('\n🔑 Group 3: Local Action Vault Resolution');

  const emailToken = manifest.tokens_used.find(t => t.startsWith('[EMAIL_'));
  const resolvedEmail = resolveVaultToken(emailToken, 'test_client_session');
  assertEqual(resolvedEmail, 'aditya.sharma@gov.in', 'Resolves email token from client vault');

  const voterToken = manifest.tokens_used.find(t => t.startsWith('[VOTER_ID_'));
  const resolvedVoter = resolveVaultToken(voterToken, 'test_client_session');
  assertEqual(resolvedVoter, 'ABC1234567', 'Resolves Voter ID token from client vault');

  const restored = restoreVaultText(`Login with ${emailToken}`, 'test_client_session');
  assertEqual(restored, 'Login with aditya.sharma@gov.in', 'Restores text template from client vault');

  // ── Test 4: Live Telemetry for UI Dashboard ────────────────────────────────
  console.log('\n📊 Group 4: Live Telemetry for UI Dashboard');

  const telemetry = getPrivacyTelemetry('test_client_session');
  assert(telemetry.spii_count >= 3, `Counts SPII properly (Found: ${telemetry.spii_count})`);
  assert(telemetry.pii_count >= 1, `Counts PII properly (Found: ${telemetry.pii_count})`);
  assertEqual(telemetry.zero_egress_verified, true, 'Zero-egress status is verified true');
  assert(telemetry.tokens_active.length > 0, 'Lists active tokens');

  // ── Test 5: Incremental DOM Scanning ───────────────────────────────────────
  console.log('\n⚡ Group 5: Incremental DOM Scanning');

  const nextRawDOM = JSON.parse(JSON.stringify(rawDOM));
  nextRawDOM.elements_count = 7;
  nextRawDOM.elements.push({
    id: 'el_phone',
    tag: 'SPAN',
    text: 'Mobile: +91 98765 43210'
  });

  const incrementalResult = await redactIncrementalDOMSnapshot(rawDOM, nextRawDOM, 'test_client_session');
  assert(!!incrementalResult.sanitizedDOM, 'Incremental returns sanitized DOM');
  assert(incrementalResult.incrementalStats.changed === 1, 'Only scanned 1 newly added element');
  assert(incrementalResult.tokenManifest.tokens_used.some(t => t.startsWith('[PHONE_')), 'Masked new phone token');

  // ── Test 6: Class-Based PrivacyClient ──────────────────────────────────────
  console.log('\n🏛️ Group 6: PrivacyClient Class');

  const client = new PrivacyClient('class_session');
  const classResult = await client.sanitize(rawDOM);
  assert(classResult.zeroEgressProof.safe, 'PrivacyClient instance executes sanitize safely');
  const clientTelemetry = client.getTelemetry();
  assertEqual(clientTelemetry.zero_egress_verified, true, 'PrivacyClient telemetry verified');

  console.log('\n' + '─'.repeat(50));
  console.log(`📊 Privacy Client Results: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('🎉 All Privacy Client tests passed!\n');
  }
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
