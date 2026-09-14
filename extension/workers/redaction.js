/**
 * redaction.js — Token Replacement + Image Blackout Engine
 * Pecific Privacy Engine (Dev 3 — R3)
 * 
 * Takes all PII detections from Regex + NER + OCR and performs:
 * 1. DOM Text Redaction: Replace PII strings with numbered tokens ([EMAIL_1], [NAME_1])
 * 2. Image Redaction: Draw black rectangles over face/PII regions via OffscreenCanvas
 * 3. Redaction Map: Client-only lookup table (token → original value)
 * 
 * The Redaction Map NEVER leaves the client — it's used locally when the server
 * sends TYPE_FROM_VAULT or similar actions that need the real values.
 * 
 * @module redaction
 */

// ─── Token Counters ─────────────────────────────────────────────────────────────

/** Per-session token counters (reset when session changes) */
let tokenCounters = {};
let currentSessionId = null;

/** Cache of element PII matches by sessionId and elementId for diff-only incremental scanning */
const sessionElementMatchesCache = new Map();

/** Session-scoped persistent token mappings across incremental action steps */
const sessionVaultTokens = new Map();

/**
 * Reset token counters (call when starting a new session or task)
 */
export function resetCounters(sessionId = null) {
  tokenCounters = {};
  currentSessionId = sessionId;
  if (sessionId) {
    sessionElementMatchesCache.delete(sessionId);
    sessionVaultTokens.delete(sessionId);
  } else {
    sessionElementMatchesCache.clear();
    sessionVaultTokens.clear();
  }
}

/**
 * Get the next token for a given PII type.
 * E.g., first email → [EMAIL_1], second → [EMAIL_2]
 * 
 * @param {string} type - PII type (EMAIL, PHONE, NAME, etc.)
 * @returns {string} Token string like [EMAIL_1]
 */
function getNextToken(type) {
  if (!tokenCounters[type]) {
    tokenCounters[type] = 0;
  }
  tokenCounters[type]++;
  return `[${type}_${tokenCounters[type]}]`;
}

// ─── Redaction Map ──────────────────────────────────────────────────────────────

/**
 * @typedef {Object} RedactionMap
 * @property {Object.<string, string>} tokens - Maps token → original value (e.g., "[EMAIL_1]" → "user@gmail.com")
 * @property {Object.<string, boolean>} vaultMapping - Which data types are available in the vault
 * @property {string} sessionId - Session this map belongs to
 */

/**
 * Create an empty redaction map
 * @param {string} sessionId
 * @returns {RedactionMap}
 */
function createRedactionMap(sessionId) {
  return {
    tokens: {},
    vaultMapping: {},
    sessionId,
  };
}

// ─── DOM Text Redaction ─────────────────────────────────────────────────────────

/**
 * Redact PII from DOM text elements, producing sanitized DOM + redaction map.
 * 
 * Strategy:
 * 1. Collect all PII matches across all elements
 * 2. For each element, replace PII values with tokens (longest-match-first)
 * 3. Build the redaction map (token → original value)
 * 4. Compute privacy stats
 * 
 * @param {object} domSnapshot - Raw DOM snapshot from content script (matches dom_snapshot.schema.json)
 * @param {Array<{elementId: string, matches: Array<{type: string, value: string, start: number, end: number, confidence: number, method: string}>}>} elementMatches - PII matches grouped by element
 * @param {string} [sessionId=''] - Current session ID
 * @returns {RedactedDOMResult}
 */
export function redactDOM(domSnapshot, elementMatches, sessionId = '') {
  if (currentSessionId !== sessionId) {
    resetCounters(sessionId);
  }

  const redactionMap = createRedactionMap(sessionId);

  // Retrieve or initialize persistent session vault mapping to prevent token churn across incremental runs
  let sessionVault = sessionVaultTokens.get(sessionId);
  if (!sessionVault) {
    sessionVault = { tokens: {}, valueToToken: new Map() };
    if (sessionId) sessionVaultTokens.set(sessionId, sessionVault);
  }
  // Inherit existing tokens so incremental calls preserve previously assigned tokens
  Object.assign(redactionMap.tokens, sessionVault.tokens);

  /** @type {Object.<string, number>} PII type → count breakdown */
  const piiBreakdown = {
    emails: 0,
    phones: 0,
    names: 0,
    addresses: 0,
    aadhaar: 0,
    pan: 0,
    cards: 0,
    dob: 0,
    upi: 0,
    other: 0,
  };

  /** @type {Object.<string, number>} Detection method → count */
  const detectionMethods = {
    regex: 0,
    ner: 0,
    ocr_regex: 0,
    ocr_ner: 0,
    dom_attribute: 0,
  };

  let totalTokensMasked = 0;
  let domMaskedFields = 0;

  // Build a lookup: elementId → matches
  const matchesByElement = {};
  for (const em of elementMatches) {
    matchesByElement[em.elementId] = em.matches;
  }

  // Update session element matches cache for diff-only incremental retrieval (caches all elements, even with 0 matches)
  let sessionCache = sessionElementMatchesCache.get(sessionId);
  if (!sessionCache) {
    sessionCache = new Map();
    if (sessionId) sessionElementMatchesCache.set(sessionId, sessionCache);
  }
  if (domSnapshot?.elements && Array.isArray(domSnapshot.elements)) {
    for (const el of domSnapshot.elements) {
      sessionCache.set(el.id, matchesByElement[el.id] || []);
    }
  } else {
    for (const em of elementMatches) {
      sessionCache.set(em.elementId, em.matches);
    }
  }

  // Deep clone the DOM snapshot so we don't modify the original
  const sanitizedDOM = JSON.parse(JSON.stringify(domSnapshot));

  // Shared across all elements in this DOM snapshot to ensure consistent token reuse
  // Seed with session-scoped valueToToken mappings
  const valueToToken = new Map(sessionVault.valueToToken);
  const tokenAudit = [];

  // Process each element
  if (sanitizedDOM.elements && Array.isArray(sanitizedDOM.elements)) {
    for (const element of sanitizedDOM.elements) {
      const matches = matchesByElement[element.id] || [];
      if (matches.length === 0 && element.type !== 'password') {
        element.is_redacted = false;
        continue;
      }

      let elementModified = false;
      const elementRedactedTypes = new Set();
      const elementRedactedTokens = new Set();

      // Process text content
      if (element.text) {
        const result = replaceTextWithTokens(element.text, matches, redactionMap, valueToToken, tokenAudit, element.id);
        if (result.modified) {
          element.text = result.text;
          elementModified = true;
          totalTokensMasked += result.tokensCreated;
          result.types.forEach(t => elementRedactedTypes.add(t));
          result.tokens.forEach(t => elementRedactedTokens.add(t));
          updateBreakdown(piiBreakdown, matches);
          updateDetectionMethods(detectionMethods, matches);
        }
      }

      // Process input value (for form inputs containing PII)
      if (element.value && element.type !== 'password') {
        const result = replaceTextWithTokens(element.value, matches, redactionMap, valueToToken, tokenAudit, element.id);
        if (result.modified) {
          element.value = result.text;
          elementModified = true;
          totalTokensMasked += result.tokensCreated;
          result.types.forEach(t => elementRedactedTypes.add(t));
          result.tokens.forEach(t => elementRedactedTokens.add(t));
          updateBreakdown(piiBreakdown, matches);
          updateDetectionMethods(detectionMethods, matches);
        }
      }

      // Process placeholder (less common, but can contain PII hints)
      if (element.placeholder) {
        const result = replaceTextWithTokens(element.placeholder, matches, redactionMap, valueToToken, tokenAudit, element.id);
        if (result.modified) {
          element.placeholder = result.text;
          elementModified = true;
          result.types.forEach(t => elementRedactedTypes.add(t));
          result.tokens.forEach(t => elementRedactedTokens.add(t));
        }
      }

      // Process href (URLs can contain email/phone in query params)
      if (element.href) {
        const result = replaceTextWithTokens(element.href, matches, redactionMap, valueToToken, tokenAudit, element.id);
        if (result.modified) {
          element.href = result.text;
          elementModified = true;
          result.types.forEach(t => elementRedactedTypes.add(t));
          result.tokens.forEach(t => elementRedactedTokens.add(t));
        }
      }

      // Handle password fields — mark as redacted, don't send any value
      if (element.type === 'password') {
        element.text = '[PASSWORD_FIELD]';
        element.value = '[PASSWORD_FIELD]';
        elementModified = true;
        totalTokensMasked++;
        elementRedactedTypes.add('PASSWORD_FIELD');
        elementRedactedTokens.add('[PASSWORD_FIELD]');
        piiBreakdown.other++;
        detectionMethods.dom_attribute++;
        tokenAudit.push({
          token: '[PASSWORD_FIELD]',
          type: 'PASSWORD_FIELD',
          method: 'DOM_ATTRIBUTE',
          confidence: 1.0,
          category: 'SPII',
          elementId: element.id,
          timestamp: Date.now(),
        });
      }

      if (elementModified) {
        domMaskedFields++;
        element.is_redacted = true;
        element.redacted_types = Array.from(elementRedactedTypes);
        element.redacted_tokens = Array.from(elementRedactedTokens);
      } else {
        element.is_redacted = false;
      }
    }
  }

  // Process forms — redact any sensitive field values
  if (sanitizedDOM.forms && Array.isArray(sanitizedDOM.forms)) {
    for (const form of sanitizedDOM.forms) {
      // The form structure itself (field names) is safe to send
      // But mark which fields have vault data available
      // (This is coordinated with vault-manager.js by Dev 4)
    }
  }

  // Build token_types mapping, collect all tokens used, and build redacted_elements summary
  const tokenTypes = {};
  const allTokensUsedSet = new Set();
  const redactedElements = [];

  for (const [token, _] of Object.entries(redactionMap.tokens)) {
    allTokensUsedSet.add(token);
    const typeMatch = token.match(/^\[([A-Z_]+)(?:_\d+)?\]$/);
    if (typeMatch) {
      tokenTypes[token] = typeMatch[1];
    }
  }

  if (sanitizedDOM.elements && Array.isArray(sanitizedDOM.elements)) {
    for (const el of sanitizedDOM.elements) {
      if (el.is_redacted) {
        (el.redacted_tokens || []).forEach(t => {
          allTokensUsedSet.add(t);
          if (!tokenTypes[t]) {
            const typeMatch = t.match(/^\[([A-Z_]+)(?:_\d+)?\]$/);
            if (typeMatch) tokenTypes[t] = typeMatch[1];
          }
        });
        redactedElements.push({
          element_id: el.id,
          tag: el.tag,
          selector: el.selector || '',
          types: el.redacted_types || [],
          tokens: el.redacted_tokens || [],
        });
      }
    }
  }

  const tokensUsed = Array.from(allTokensUsedSet);

  // Synchronize newly created tokens and value mappings back to session vault
  if (sessionVault) {
    Object.assign(sessionVault.tokens, redactionMap.tokens);
    valueToToken.forEach((tok, val) => sessionVault.valueToToken.set(val, tok));
  }

  return {
    sanitizedDOM,
    redactionMap,
    privacyStats: {
      faces_redacted: 0, // Set by image redaction
      pii_tokens_masked: totalTokensMasked,
      dom_masked_fields: domMaskedFields,
      pii_breakdown: piiBreakdown,
      detection_methods: detectionMethods,
    },
    tokenManifest: {
      tokens_used: tokensUsed,
      total_tokens: tokensUsed.length,
      token_types: tokenTypes,
      redacted_elements: redactedElements,
    },
    tokenAudit,
  };
}

/**
 * Merge and deduplicate element matches from multiple detection sources (Regex + NER).
 *
 * @param {Array<{elementId: string, matches: Array<object>}>} regexResults
 * @param {Array<{elementId: string, matches: Array<object>}>} nerResults
 * @returns {Array<{elementId: string, matches: Array<object>}>}
 */
export function mergeElementMatches(regexResults = [], nerResults = []) {
  const byElement = new Map();

  // Add regex matches (highest confidence)
  for (const result of regexResults || []) {
    if (!byElement.has(result.elementId)) {
      byElement.set(result.elementId, []);
    }
    byElement.get(result.elementId).push(...result.matches);
  }

  // Add NER matches (with overlap check)
  for (const result of nerResults || []) {
    if (!byElement.has(result.elementId)) {
      byElement.set(result.elementId, []);
    }

    const existing = byElement.get(result.elementId);

    for (const nerMatch of result.matches) {
      const overlapping = existing.find(
        e => nerMatch.start < e.end && nerMatch.end > e.start
      );

      if (overlapping) {
        if (nerMatch.confidence > overlapping.confidence) {
          const idx = existing.indexOf(overlapping);
          existing[idx] = nerMatch;
        }
      } else {
        existing.push(nerMatch);
      }
    }
  }

  return Array.from(byElement.entries()).map(([elementId, matches]) => ({
    elementId,
    matches: matches.sort((a, b) => a.start - b.start),
  }));
}

/**
 * Classify PII into severity tiers for the privacy dashboard UI:
 * - SPII (Strict PII): Critical identifiers (Aadhaar, PAN, Card, Passwords)
 * - PII: Standard personal identifiers (Email, Phone, Name, UPI)
 * - CONTEXTUAL: Secondary personal info (DOB, Address, Passport, IFSC, IP)
 * 
 * @param {string} type - PII type string
 * @returns {'SPII'|'PII'|'CONTEXTUAL'}
 */
export function getPIICategory(type) {
  switch (type) {
    case 'AADHAAR':
    case 'PAN':
    case 'CARD':
    case 'PASSWORD_FIELD':
    case 'OTP':
    case 'VOTER_ID':
    case 'DL':
    case 'EPFO_UAN':
    case 'BANK_ACCOUNT':
      return 'SPII';
    case 'EMAIL':
    case 'PHONE':
    case 'NAME':
    case 'UPI':
    case 'AVATAR':
    case 'VEHICLE_RC':
      return 'PII';
    default:
      return 'CONTEXTUAL';
  }
}

/**
 * Replace PII values in text with tokens, using longest-match-first strategy.
 * 
 * @param {string} text - Original text
 * @param {Array<{type: string, value: string, start: number, end: number, confidence?: number, method?: string}>} matches - PII matches
 * @param {RedactionMap} redactionMap - Map to populate with token → value pairs
 * @param {Map<string, string>} [valueToToken=new Map()] - Shared value → token map for deduplication
 * @param {Array<object>} [tokenAudit=[]] - Audit trail for UI dashboard
 * @param {string} [elementId=''] - Associated DOM element ID
 * @returns {{text: string, modified: boolean, tokensCreated: number}}
 */
function replaceTextWithTokens(text, matches, redactionMap, valueToToken = new Map(), tokenAudit = [], elementId = '') {
  if (!text || !matches || matches.length === 0) {
    return { text, modified: false, tokensCreated: 0 };
  }

  // Sort matches by value length (longest first) to prevent partial replacements
  // e.g., "aditya@gmail.com" should be replaced before "aditya"
  const sortedMatches = [...matches]
    .filter(m => m.value && m.value.length > 0 && m.value !== '[hidden]')
    .sort((a, b) => b.value.length - a.value.length);

  let resultText = text;
  let tokensCreated = 0;
  const typesUsed = new Set();
  const tokensUsed = new Set();

  for (const match of sortedMatches) {
    const value = match.value;
    
    // Check if we already have a token for this exact value (dedup)
    let token;
    if (valueToToken.has(value)) {
      token = valueToToken.get(value);
    } else {
      token = getNextToken(match.type);
      valueToToken.set(value, token);
      redactionMap.tokens[token] = value;
      tokensCreated++;

      tokenAudit.push({
        token,
        type: match.type,
        method: match.method || 'REGEX',
        confidence: match.confidence !== undefined ? match.confidence : 1.0,
        category: getPIICategory(match.type),
        elementId,
        timestamp: Date.now(),
      });
    }

    // Replace all occurrences of this value in the text
    // Use a simple string replace (not regex) to avoid special character issues
    let idx = resultText.indexOf(value);
    let valueReplaced = false;
    while (idx !== -1) {
      resultText = resultText.substring(0, idx) + token + resultText.substring(idx + value.length);
      idx = resultText.indexOf(value, idx + token.length);
      valueReplaced = true;
    }

    if (valueReplaced) {
      typesUsed.add(match.type);
      tokensUsed.add(token);
    }
  }

  return {
    text: resultText,
    modified: resultText !== text,
    tokensCreated,
    types: Array.from(typesUsed),
    tokens: Array.from(tokensUsed),
  };
}

/**
 * Update PII breakdown counts
 */
function updateBreakdown(breakdown, matches) {
  for (const m of matches) {
    switch (m.type) {
      case 'EMAIL': breakdown.emails++; break;
      case 'PHONE': breakdown.phones++; break;
      case 'NAME': breakdown.names++; break;
      case 'ADDRESS': breakdown.addresses++; break;
      case 'AADHAAR': breakdown.aadhaar++; break;
      case 'PAN': breakdown.pan++; break;
      case 'CARD': breakdown.cards++; break;
      case 'DOB': breakdown.dob++; break;
      case 'UPI': breakdown.upi++; break;
      case 'VOTER_ID': breakdown.voter_id = (breakdown.voter_id || 0) + 1; break;
      case 'DL': breakdown.dl = (breakdown.dl || 0) + 1; break;
      case 'EPFO_UAN': breakdown.uan = (breakdown.uan || 0) + 1; break;
      case 'BANK_ACCOUNT': breakdown.bank_account = (breakdown.bank_account || 0) + 1; break;
      case 'VEHICLE_RC': breakdown.vehicle_rc = (breakdown.vehicle_rc || 0) + 1; break;
      default: breakdown.other++; break;
    }
  }
}

/**
 * Update detection method counts
 */
function updateDetectionMethods(methods, matches) {
  for (const m of matches) {
    switch (m.method) {
      case 'REGEX': methods.regex++; break;
      case 'NER': methods.ner++; break;
      case 'OCR_REGEX': methods.ocr_regex++; break;
      case 'OCR_NER': methods.ocr_ner++; break;
      case 'DOM_ATTRIBUTE': methods.dom_attribute++; break;
      default: methods.regex++; break;
    }
  }
}

// ─── Image Redaction ────────────────────────────────────────────────────────────

/**
 * Redact PII from a screenshot image using OffscreenCanvas.
 * Draws solid black rectangles over face bounding boxes and PII text regions.
 * 
 * Why black rectangles instead of blur:
 * - Faster to render (simple fillRect vs convolution filter)
 * - Guaranteed privacy (blur can sometimes be reversed with deblurring algorithms)
 * - Clearly visible as redacted (important for demo/evaluation)
 * - Smaller output file size
 * 
 * @param {ImageBitmap|null} screenshot - Original screenshot
 * @param {Array<{bbox: number[], confidence?: number}>} faceBBs - Face bounding boxes from vision worker (BlazeFace)
 * @param {Array<{type: string, bbox: number[], value?: string}>} textPIIRegions - PII text regions from OCR
 * @param {object} [options={}] - Redaction options
 * @param {number} [options.facePadding=0.1] - Percentage padding around face boxes (0.1 = 10%)
 * @param {number} [options.textPadding=2] - Pixel padding around text PII boxes
 * @param {number} [options.jpegQuality=0.85] - JPEG output quality (0-1)
 * @returns {Promise<{redactedBase64: string|null, facesRedacted: number, regionsRedacted: number}>}
 */
export async function redactImage(screenshot, faceBBs = [], textPIIRegions = [], options = {}) {
  if (!screenshot) {
    return { redactedBase64: null, facesRedacted: 0, regionsRedacted: 0 };
  }

  const {
    facePadding = 0.1,
    textPadding = 2,
    jpegQuality = 0.85,
  } = options;

  try {
    // Get image dimensions
    let width, height;
    if (screenshot instanceof ImageBitmap) {
      width = screenshot.width;
      height = screenshot.height;
    } else if (screenshot.width && screenshot.height) {
      width = screenshot.width;
      height = screenshot.height;
    } else {
      console.error('[REDACT] Cannot determine image dimensions');
      return { redactedBase64: null, facesRedacted: 0, regionsRedacted: 0 };
    }

    // Create OffscreenCanvas and draw the original image
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');

    if (screenshot instanceof ImageBitmap) {
      ctx.drawImage(screenshot, 0, 0);
    } else if (screenshot instanceof ImageData) {
      ctx.putImageData(screenshot, 0, 0);
    }

    let facesRedacted = 0;
    let regionsRedacted = 0;

    // ── Redact faces (solid black rectangles with padding) ────────────────
    ctx.fillStyle = '#000000';

    for (const face of faceBBs) {
      if (!face.bbox || face.bbox.length < 4) continue;

      const [x, y, w, h] = face.bbox;

      // Add padding around the face
      const padX = w * facePadding;
      const padY = h * facePadding;

      const rx = Math.max(0, Math.round(x - padX));
      const ry = Math.max(0, Math.round(y - padY));
      const rw = Math.min(width - rx, Math.round(w + 2 * padX));
      const rh = Math.min(height - ry, Math.round(h + 2 * padY));

      ctx.fillRect(rx, ry, rw, rh);
      facesRedacted++;
    }

    // ── Redact text PII regions (solid black rectangles) ─────────────────
    for (const region of textPIIRegions) {
      if (!region.bbox || region.bbox.length < 4) continue;

      const [x, y, w, h] = region.bbox;

      const rx = Math.max(0, Math.round(x - textPadding));
      const ry = Math.max(0, Math.round(y - textPadding));
      const rw = Math.min(width - rx, Math.round(w + 2 * textPadding));
      const rh = Math.min(height - ry, Math.round(h + 2 * textPadding));

      ctx.fillRect(rx, ry, rw, rh);
      regionsRedacted++;
    }

    // ── Encode to JPEG base64 ────────────────────────────────────────────
    const blob = await canvas.convertToBlob({
      type: 'image/jpeg',
      quality: jpegQuality,
    });

    const base64 = await blobToBase64(blob);

    return {
      redactedBase64: `data:image/jpeg;base64,${base64}`,
      facesRedacted,
      regionsRedacted,
    };
  } catch (error) {
    console.error('[REDACT] Image redaction failed:', error);
    return { redactedBase64: null, facesRedacted: 0, regionsRedacted: 0 };
  }
}

/**
 * Convert a Blob to base64 string.
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ─── Restore Utilities (Client-Only) ────────────────────────────────────────────

/**
 * Look up the original value for a redaction token.
 * Used by the extension when executing TYPE_FROM_VAULT or similar actions.
 * This function NEVER sends data to the server.
 * 
 * @param {RedactionMap} redactionMap - The client-only redaction map
 * @param {string} token - Token to look up (e.g., "[EMAIL_1]")
 * @returns {string|null} Original value or null if not found
 */
export function resolveToken(redactionMap, token) {
  if (!redactionMap || !redactionMap.tokens) return null;
  return redactionMap.tokens[token] || null;
}

/**
 * Restore all tokens in a text string back to their original values.
 * Used for local operations only — NEVER called before sending data to server.
 * 
 * @param {string} text - Text with tokens
 * @param {RedactionMap} redactionMap - Client-only redaction map
 * @returns {string} Text with original values restored
 */
export function restoreTokens(text, redactionMap) {
  if (!text || !redactionMap || !redactionMap.tokens) return text;

  let restored = text;
  for (const [token, value] of Object.entries(redactionMap.tokens)) {
    // Use simple string replace to avoid regex special char issues
    while (restored.includes(token)) {
      restored = restored.replace(token, value);
    }
  }

  return restored;
}

// ─── Incremental Scanning (Agentic Loop Support) ──────────────────────────────

/**
 * Incrementally redact a DOM snapshot during the agentic action loop.
 * Detects differences between previous DOM snapshot and current DOM snapshot,
 * re-scanning only modified or newly added elements to achieve < 25ms sanitization latency.
 * 
 * @param {object} previousRawDOM - Previous raw DOM snapshot
 * @param {object} newRawDOM - New raw DOM snapshot from page transition
 * @param {function} scanFn - Function to scan elements for PII (e.g. scanDOMElements)
 * @param {string} [sessionId=''] - Current session ID
 * @returns {RedactedDOMResult & { incrementalStats: { total: number, unchanged: number, changed: number, timeMs: number } }}
 */
export function redactIncrementalDOM(previousRawDOM, newRawDOM, scanFn, sessionId = '') {
  const startTime = performance.now();

  // If no previous DOM, fall back to full scan
  if (!previousRawDOM || !previousRawDOM.elements) {
    const matches = scanFn(newRawDOM.elements);
    const fullResult = redactDOM(newRawDOM, matches, sessionId);
    return {
      ...fullResult,
      incrementalStats: {
        total: newRawDOM.elements?.length || 0,
        unchanged: 0,
        changed: newRawDOM.elements?.length || 0,
        timeMs: Math.round(performance.now() - startTime),
      }
    };
  }

  // Index previous elements by ID
  const prevElementsById = new Map();
  for (const el of previousRawDOM.elements) {
    prevElementsById.set(el.id, el);
  }

  // Find changed or new elements
  const changedElements = [];
  const unchangedElementIds = new Set();

  for (const el of (newRawDOM.elements || [])) {
    const prev = prevElementsById.get(el.id);
    if (!prev) {
      // Brand new element
      changedElements.push(el);
    } else if (
      prev.text !== el.text ||
      prev.placeholder !== el.placeholder ||
      prev.href !== el.href ||
      prev.value !== el.value ||
      prev.type !== el.type
    ) {
      // Modified element
      changedElements.push(el);
    } else {
      // Unchanged element
      unchangedElementIds.add(el.id);
    }
  }

  // 1. Scan strictly the changed elements (diff-only execution)
  const changedMatches = changedElements.length > 0 ? scanFn(changedElements) : [];

  // 2. Retrieve previous matches for unchanged elements from session cache without re-scanning
  let sessionCache = sessionElementMatchesCache.get(sessionId);
  if (!sessionCache) {
    sessionCache = new Map();
    if (sessionId) sessionElementMatchesCache.set(sessionId, sessionCache);
  }

  const unchangedMatches = [];
  const uncachedUnchangedElements = [];

  for (const elId of unchangedElementIds) {
    if (sessionCache.has(elId)) {
      unchangedMatches.push({
        elementId: elId,
        matches: sessionCache.get(elId),
      });
    } else {
      const el = prevElementsById.get(elId);
      if (el) uncachedUnchangedElements.push(el);
    }
  }

  // If any unchanged element was not yet in cache (e.g. initial test without prior redactDOM call),
  // seed cache for those elements only once
  if (uncachedUnchangedElements.length > 0) {
    const scannedUncached = scanFn(uncachedUnchangedElements);
    const uncachedMap = {};
    for (const em of scannedUncached) {
      uncachedMap[em.elementId] = em.matches;
      unchangedMatches.push(em);
    }
    for (const el of uncachedUnchangedElements) {
      sessionCache.set(el.id, uncachedMap[el.id] || []);
    }
  }

  // Update session cache with new/changed element matches
  const changedMap = {};
  for (const em of changedMatches) {
    changedMap[em.elementId] = em.matches;
  }
  for (const el of changedElements) {
    sessionCache.set(el.id, changedMap[el.id] || []);
  }

  const allMatches = [...unchangedMatches, ...changedMatches];
  const result = redactDOM(newRawDOM, allMatches, sessionId);

  return {
    ...result,
    incrementalStats: {
      total: newRawDOM.elements?.length || 0,
      unchanged: unchangedElementIds.size,
      changed: changedElements.length,
      timeMs: Math.round(performance.now() - startTime),
    }
  };
}

// ─── Exported Types ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} RedactedDOMResult
 * @property {object} sanitizedDOM - DOM snapshot with PII replaced by tokens
 * @property {RedactionMap} redactionMap - Token → original value mapping (NEVER SENT TO SERVER)
 * @property {object} privacyStats - { faces_redacted, pii_tokens_masked, dom_masked_fields, pii_breakdown, detection_methods }
 * @property {object} tokenManifest - { tokens_used: string[], total_tokens: number }
 */
