/**
 * privacy-client.js — High-Level Privacy Engine Client Interface
 * PrivacyLens / Pecific Privacy Engine (Dev 3 — R3)
 *
 * Exposes a clean, asynchronous 3-line helper module for Dev 1 (Service Worker & Extension Shell)
 * and Dev 2 (Action Executor) to sanitize DOM snapshots, redact screenshots, query
 * live telemetry for the UI dashboard, and resolve tokens locally from the on-device vault.
 *
 * 3-Line Usage Example for Dev 1:
 * ```javascript
 * import { sanitizeDOMSnapshot } from './workers/privacy-client.js';
 * const { sanitizedDOM, tokenManifest, clientVault } = await sanitizeDOMSnapshot(rawDom, screenshot);
 * ```
 *
 * Guaranteed Security Principles:
 * 1. ZERO RAW SECRET EGRESS: The clientVault containing raw passwords, Aadhaar, PAN,
 *    emails, and card numbers NEVER leaves the local device.
 * 2. STRUCTURAL INVARIANCE: DOM elements, tags, attributes, selectors, and bounding boxes
 *    remain preserved so the server LLM/VLM planner can reliably navigate the page.
 * 3. SUB-25MS INCREMENTAL SANITIZATION: During continuous action execution, only
 *    DOM diffs are scanned.
 *
 * @module privacy-client
 */

import { scanDOMElements, scanRegexPII } from './regex.js';
import { isNERReady, scanDOMElementsNER } from './ner.js';
import { 
  redactDOM, 
  redactImage,
  redactIncrementalDOM, 
  mergeElementMatches,
  resolveToken as resolveTokenCore, 
  restoreTokens as restoreTokensCore, 
  resetCounters,
  getPIICategory 
} from './redaction.js';

// ─── In-Memory Client Vault Storage (Session Isolated) ─────────────────────────

class ClientVaultStore {
  constructor() {
    /** @type {Map<string, { redactionMap: any, tokenAudit: any[], lastTelemetry: any }>} */
    this.sessions = new Map();
    this.defaultSessionId = 'active_session';
  }

  getOrCreateSession(sessionId = this.defaultSessionId) {
    const sId = sessionId || this.defaultSessionId;
    if (!this.sessions.has(sId)) {
      this.sessions.set(sId, {
        redactionMap: { tokens: {}, vaultMapping: {}, sessionId: sId },
        tokenAudit: [],
        lastTelemetry: {
          spii_count: 0,
          pii_count: 0,
          contextual_count: 0,
          total_masked: 0,
          tokens_active: [],
          zero_egress_verified: false,
          leaked_count: 0,
          leaked_tokens: [],
          last_sanitized_at: null,
          token_manifest: { tokens_used: [], total_tokens: 0 },
        }
      });
    }
    return this.sessions.get(sId);
  }

  setSessionData(sessionId, redactionMap, tokenAudit, telemetry) {
    const sId = sessionId || this.defaultSessionId;
    this.sessions.set(sId, {
      redactionMap,
      tokenAudit: tokenAudit || [],
      lastTelemetry: telemetry,
    });
  }

  resolve(sessionId, token) {
    const session = this.getOrCreateSession(sessionId);
    return resolveTokenCore(session.redactionMap, token);
  }

  restore(sessionId, text) {
    const session = this.getOrCreateSession(sessionId);
    return restoreTokensCore(text, session.redactionMap);
  }

  getTelemetry(sessionId) {
    const session = this.getOrCreateSession(sessionId);
    return session.lastTelemetry;
  }

  reset(sessionId) {
    const sId = sessionId || this.defaultSessionId;
    resetCounters(sId);
    this.sessions.delete(sId);
  }
}

const globalVaultStore = new ClientVaultStore();

// ─── Telemetry Computation Helper ──────────────────────────────────────────────

function computeTelemetry(redactionResult, sessionId, zeroEgressProof = null) {
  const audit = redactionResult.tokenAudit || [];
  let spiiCount = 0;
  let piiCount = 0;
  let contextualCount = 0;

  for (const item of audit) {
    const cat = item.category || getPIICategory(item.type);
    if (cat === 'SPII') spiiCount++;
    else if (cat === 'PII') piiCount++;
    else contextualCount++;
  }

  const tokensUsed = redactionResult.tokenManifest?.tokens_used || [];
  const isVerified = zeroEgressProof ? zeroEgressProof.safe : false;
  const leakedCount = zeroEgressProof ? zeroEgressProof.leakedCount : 0;
  const leakedTokens = zeroEgressProof ? zeroEgressProof.leakedTokens : [];

  return {
    sessionId: sessionId || 'active_session',
    spii_count: spiiCount,
    pii_count: piiCount,
    contextual_count: contextualCount,
    total_masked: tokensUsed.length,
    tokens_active: tokensUsed,
    zero_egress_verified: isVerified,
    leaked_count: leakedCount,
    leaked_tokens: leakedTokens,
    last_sanitized_at: new Date().toISOString(),
    token_manifest: redactionResult.tokenManifest || { tokens_used: [], total_tokens: 0 },
    breakdown: redactionResult.privacyStats?.pii_breakdown || {},
  };
}

// ─── Zero-Egress Assertion Engine ─────────────────────────────────────────────

/**
 * Verify that a sanitized DOM payload contains ZERO raw secrets from the client vault.
 * Recursively inspects text, values, placeholders, and attributes.
 *
 * @param {object} sanitizedDOM - The sanitized DOM payload to check before sending to server
 * @param {string} [sessionId='active_session'] - Active session ID
 * @returns {{ safe: boolean, leakedCount: number, leakedTokens: string[], details: string[] }}
 */
export function verifyZeroEgress(sanitizedDOM, sessionId = 'active_session') {
  const session = globalVaultStore.getOrCreateSession(sessionId);
  const secretEntries = Object.entries(session.redactionMap?.tokens || {});

  if (secretEntries.length === 0) {
    return { safe: true, leakedCount: 0, leakedTokens: [], details: [] };
  }

  const domString = JSON.stringify(sanitizedDOM);
  const leakedTokens = [];
  const details = [];

  for (const [token, rawSecret] of secretEntries) {
    if (!rawSecret || rawSecret.length < 3 || rawSecret === '[hidden]') continue;

    // Check if raw secret exists anywhere in the JSON payload
    if (domString.includes(rawSecret)) {
      leakedTokens.push(token);
      details.push(`Raw secret for ${token} detected in payload string!`);
    }
  }

  const safe = leakedTokens.length === 0;
  return {
    safe,
    leakedCount: leakedTokens.length,
    leakedTokens,
    details,
  };
}

// ─── Primary 3-Line Helper Module ──────────────────────────────────────────────

/**
 * Sanitize a DOM snapshot and screenshot asynchronously.
 * This is the primary 3-line helper module designed for Dev 1.
 *
 * @param {object} domSnapshot - Raw accessibility / DOM tree from content script
 * @param {string|null} [screenshot=null] - Base64 screenshot (optional)
 * @param {object} [options={}] - Optional configuration
 * @param {string} [options.sessionId='active_session'] - Session identifier
 * @param {boolean} [options.verifyEgress=true] - Run automatic zero-egress check
 * @returns {Promise<{
 *   sanitizedDOM: object,
 *   tokenManifest: object,
 *   redactedScreenshot: string|null,
 *   privacyStats: object,
 *   telemetry: object,
 *   zeroEgressProof: { safe: boolean, leakedCount: number },
 *   clientVault: { resolve: (token: string) => string|null, restore: (text: string) => string }
 * }>}
 */
export async function sanitizeDOMSnapshot(domSnapshot, screenshot = null, options = {}) {
  const sessionId = options.sessionId || 'active_session';
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

  // 1. Scan DOM elements with Regex and contextual NER (if loaded)
  const elements = domSnapshot?.elements || [];
  const regexMatches = scanDOMElements(elements);
  let nerMatches = [];
  try {
    if (typeof isNERReady === 'function' && isNERReady()) {
      nerMatches = await scanDOMElementsNER(elements);
    }
  } catch (err) {
    console.warn('[PrivacyClient] NER scan fallback:', err.message);
  }
  const elementMatches = mergeElementMatches(regexMatches, nerMatches);

  // 2. Perform DOM token substitution & construct client-only redaction map
  const redactResult = redactDOM(domSnapshot, elementMatches, sessionId);

  // Store intermediate vault mapping before verification so verifyZeroEgress can cross-check secrets
  globalVaultStore.setSessionData(
    sessionId,
    redactResult.redactionMap,
    redactResult.tokenAudit,
    null
  );

  // 3. Zero-egress assurance verification (Always run verification; never bypass)
  const zeroEgressProof = verifyZeroEgress(redactResult.sanitizedDOM, sessionId);

  // 4. Compute verified telemetry incorporating genuine proof and cache in on-device vault
  const telemetry = computeTelemetry(redactResult, sessionId, zeroEgressProof);
  globalVaultStore.setSessionData(
    sessionId, 
    redactResult.redactionMap, 
    redactResult.tokenAudit, 
    telemetry
  );

  // 5. Visual Redaction: Draw blackouts over PII bounding boxes if screenshot is present
  let redactedScreenshot = null;
  if (screenshot) {
    const domPIIRegions = (redactResult.sanitizedDOM?.elements || [])
      .filter(el => el.is_redacted && Array.isArray(el.coordinates) && el.coordinates.length === 4)
      .map(el => ({
        bbox: el.coordinates,
        type: (el.redacted_types && el.redacted_types[0]) || 'DOM_PII',
        elementId: el.id,
      }));

    try {
      const imgRes = await redactImage(screenshot, options.faceBBs || [], domPIIRegions);
      redactedScreenshot = imgRes?.redactedBase64 || null;
    } catch (err) {
      console.error('[PrivacyClient] Visual blackout failed, withholding screenshot:', err);
      redactedScreenshot = null; // Fail-closed: NEVER return raw unredacted pixels
    }
  }

  const durationMs = Math.round(
    (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime
  );

  return {
    sanitizedDOM: redactResult.sanitizedDOM,
    tokenManifest: redactResult.tokenManifest,
    redactedScreenshot, // Guaranteed redacted or null
    privacyStats: {
      ...redactResult.privacyStats,
      sanitization_time_ms: durationMs,
    },
    telemetry,
    zeroEgressProof,
    clientVault: {
      resolve: (token) => globalVaultStore.resolve(sessionId, token),
      restore: (text) => globalVaultStore.restore(sessionId, text),
    },
  };
}

/**
 * Incrementally sanitize a DOM snapshot during the agent action loop (< 25ms).
 *
 * @param {object} previousDOM - Previous raw DOM snapshot
 * @param {object} newDOM - Newly transitioned raw DOM snapshot
 * @param {string} [sessionId='active_session'] - Active session ID
 * @returns {Promise<object>} Sanitized DOM and updated manifest
 */
export async function redactIncrementalDOMSnapshot(previousDOM, newDOM, sessionId = 'active_session') {
  const result = redactIncrementalDOM(previousDOM, newDOM, scanDOMElements, sessionId);
  globalVaultStore.setSessionData(sessionId, result.redactionMap, result.tokenAudit, null);

  const zeroEgressProof = verifyZeroEgress(result.sanitizedDOM, sessionId);
  const telemetry = computeTelemetry(result, sessionId, zeroEgressProof);
  globalVaultStore.setSessionData(sessionId, result.redactionMap, result.tokenAudit, telemetry);

  return {
    sanitizedDOM: result.sanitizedDOM,
    tokenManifest: result.tokenManifest,
    privacyStats: result.privacyStats,
    incrementalStats: result.incrementalStats,
    telemetry,
    zeroEgressProof,
    clientVault: {
      resolve: (token) => globalVaultStore.resolve(sessionId, token),
      restore: (text) => globalVaultStore.restore(sessionId, text),
    },
  };
}

// ─── Local Action Executor Utilities (Client-Only) ─────────────────────────────

/**
 * Resolve a sanitized token back to its raw plaintext secret strictly on the client.
 * Called by Dev 2 (action executor) when executing TYPE_FROM_VAULT actions.
 *
 * @param {string} token - e.g. "[EMAIL_1]" or "[PASSWORD_FIELD]"
 * @param {string} [sessionId='active_session'] - Active session ID
 * @returns {string|null} The raw secret value, or null if unknown
 */
export function resolveVaultToken(token, sessionId = 'active_session') {
  return globalVaultStore.resolve(sessionId, token);
}

/**
 * Restore all tokens in a text template back to original values locally.
 *
 * @param {string} text - Text containing tokens
 * @param {string} [sessionId='active_session'] - Active session ID
 * @returns {string} Restored text
 */
export function restoreVaultText(text, sessionId = 'active_session') {
  return globalVaultStore.restore(sessionId, text);
}

/**
 * Retrieve current privacy telemetry for UI dashboard rendering.
 *
 * @param {string} [sessionId='active_session'] - Active session ID
 * @returns {object} Live telemetry snapshot
 */
export function getPrivacyTelemetry(sessionId = 'active_session') {
  return globalVaultStore.getTelemetry(sessionId);
}

/**
 * Reset all vault storage and token counters for a session.
 *
 * @param {string} [sessionId='active_session'] - Active session ID
 */
export function resetSessionVault(sessionId = 'active_session') {
  globalVaultStore.reset(sessionId);
}

// ─── Stateful PrivacyClient Class ──────────────────────────────────────────────

export class PrivacyClient {
  constructor(defaultSessionId = 'active_session') {
    this.sessionId = defaultSessionId;
  }

  async sanitize(domSnapshot, screenshot = null, options = {}) {
    return sanitizeDOMSnapshot(domSnapshot, screenshot, {
      ...options,
      sessionId: options.sessionId || this.sessionId,
    });
  }

  async sanitizeIncremental(previousDOM, newDOM) {
    return redactIncrementalDOMSnapshot(previousDOM, newDOM, this.sessionId);
  }

  resolveToken(token) {
    return resolveVaultToken(token, this.sessionId);
  }

  restoreText(text) {
    return restoreVaultText(text, this.sessionId);
  }

  getTelemetry() {
    return getPrivacyTelemetry(this.sessionId);
  }

  verifyZeroEgress(sanitizedDOM) {
    return verifyZeroEgress(sanitizedDOM, this.sessionId);
  }

  reset() {
    resetSessionVault(this.sessionId);
  }
}
