/**
 * privacy-worker.js — Privacy Engine Orchestrator (Web Worker)
 * PrivacyLens Privacy Engine (Dev 3 — R3)
 * 
 * The main Web Worker entry point that orchestrates the 4-stage privacy pipeline:
 *   Stage 1: Regex PII scan (deterministic, ~5ms)
 *   Stage 2: NER contextual scan (ML-based, ~80ms)
 *   Stage 3: OCR text extraction from screenshot (~200ms)
 *   Stage 4: Redaction — token replacement (DOM) + black rectangles (image)
 * 
 * Stages 1 & 2 run in parallel. Stage 3 runs if a screenshot is provided.
 * Stage 4 runs after all detections are merged.
 * 
 * Receives messages from the service worker, returns sanitized payloads.
 * 
 * CRITICAL: The redaction map (token → original value) NEVER leaves this worker
 * except via a dedicated local-only message channel back to the service worker.
 * It is NEVER included in payloads sent to the server.
 * 
 * @module privacy-worker
 */

// ─── Import Modules ─────────────────────────────────────────────────────────────
// In a Web Worker, we use importScripts or dynamic imports
// These modules are co-located in the same workers/ directory

import { scanRegexPII, scanDOMElements } from './regex.js';
import { initNER, scanNER, scanDOMElementsNER, isNERReady } from './ner.js';
import { initOCR, extractText, mapPIIToImageRegions, isOCRReady } from './ocr.js';
import { 
  redactDOM, redactImage, resetCounters, resolveToken, restoreTokens,
  redactIncrementalDOM, getPIICategory
} from './redaction.js';

// ─── Worker State ───────────────────────────────────────────────────────────────

const state = {
  initialized: false,
  modelsLoaded: [],
  modelErrors: [],
  currentSessionId: null,
  /** @type {import('./redaction.js').RedactionMap|null} */
  currentRedactionMap: null,
  /** Full audit history for privacy dashboard */
  currentAudit: [],
  /** Stats across all sanitization calls in this session */
  sessionStats: {
    totalCalls: 0,
    totalPIIDetected: 0,
    totalFacesRedacted: 0,
    avgProcessingTimeMs: 0,
  },
};

// ─── Initialization ─────────────────────────────────────────────────────────────

/**
 * Initialize all privacy models (NER + OCR).
 * Called once when the service worker sends 'INIT'.
 * Models are cached in IndexedDB after first download.
 */
async function initialize() {
  const startTime = performance.now();
  const results = { ner: null, ocr: null };

  // Load NER and OCR in parallel
  const [nerResult, ocrResult] = await Promise.allSettled([
    initNER(),
    initOCR(),
  ]);

  // Process NER result
  if (nerResult.status === 'fulfilled' && nerResult.value.success) {
    state.modelsLoaded.push('ner');
    results.ner = { success: true, loadTime: nerResult.value.loadTime };
  } else {
    const error = nerResult.status === 'rejected' 
      ? nerResult.reason.message 
      : nerResult.value.error;
    state.modelErrors.push({ model: 'ner', error });
    results.ner = { success: false, error };
    console.error('[Privacy Worker] NER init failed:', error);
  }

  // Process OCR result
  if (ocrResult.status === 'fulfilled' && ocrResult.value.success) {
    state.modelsLoaded.push('ocr');
    results.ocr = { success: true, loadTime: ocrResult.value.loadTime };
  } else {
    const error = ocrResult.status === 'rejected' 
      ? ocrResult.reason.message 
      : ocrResult.value.error;
    state.modelErrors.push({ model: 'ocr', error });
    results.ocr = { success: false, error };
    console.error('[Privacy Worker] OCR init failed:', error);
  }

  state.initialized = true;
  const totalLoadTime = Math.round(performance.now() - startTime);

  return {
    modelsLoaded: state.modelsLoaded,
    modelErrors: state.modelErrors,
    loadTime: totalLoadTime,
    results,
  };
}

// ─── Main Sanitization Pipeline ─────────────────────────────────────────────────

/**
 * Run the full 4-stage privacy sanitization pipeline.
 * 
 * Pipeline:
 *   Phase A: Parallel DOM scanning (Regex + NER)
 *   Phase B: OCR text extraction (if screenshot provided & canvas_heavy)
 *   Phase C: Scan OCR text for PII (Regex + NER on OCR output)
 *   Phase D: Merge + deduplicate all matches
 *   Phase E: Parallel redaction (DOM tokens + image blackout)
 * 
 * @param {object} params
 * @param {object} params.domSnapshot - Raw DOM snapshot from content script
 * @param {ImageBitmap|string|null} params.screenshot - Raw screenshot (ImageBitmap or base64)
 * @param {Array<{bbox: number[], confidence?: number}>} params.faceBBs - Face bounding boxes from vision worker
 * @param {string} params.sessionId - Current session ID
 * @param {object} [params.visionContext] - Vision context for deciding OCR necessity
 * @param {boolean} [params.forceOCR=false] - Force OCR even if not canvas_heavy
 * @returns {Promise<SanitizeResult>}
 */
async function sanitize(params) {
  const { 
    domSnapshot, screenshot, faceBBs = [], sessionId = '',
    visionContext = {}, forceOCR = false,
  } = params;

  const startTime = performance.now();
  
  // Reset counters if session changed
  if (state.currentSessionId !== sessionId) {
    resetCounters(sessionId);
    state.currentSessionId = sessionId;
  }

  // ── Phase A: Parallel DOM Scanning (Regex + NER) ──────────────────────
  const phaseAStart = performance.now();

  // Extract all text from DOM elements for scanning
  const elements = (domSnapshot?.elements || []).map(el => ({
    id: el.id,
    text: el.text || '',
    placeholder: el.placeholder || '',
    value: el.value || '',
    tag: el.tag || '',
    type: el.type || '',
    parentTag: el.parentTag || '',
    parentClass: el.parentClass || '',
    parentId: el.parentId || '',
    nearbyLabels: el.nearbyLabels || el.placeholder || '',
    autocomplete: el.autocomplete || '',
  }));

  // Run Regex and NER in parallel on DOM elements
  const [regexResults, nerResults] = await Promise.allSettled([
    Promise.resolve(scanDOMElements(elements)),
    isNERReady() ? scanDOMElementsNER(elements) : Promise.resolve([]),
  ]);

  const regexMatches = regexResults.status === 'fulfilled' ? regexResults.value : [];
  const nerMatches = nerResults.status === 'fulfilled' ? nerResults.value : [];

  const phaseATime = Math.round(performance.now() - phaseAStart);

  // ── Phase B: OCR Text Extraction (conditional) ────────────────────────
  let ocrResult = { words: [], lines: [], fullText: '', processingTime: 0 };
  let ocrPIIRegions = [];
  let phaseBTime = 0;

  const shouldOCR = screenshot && (
    forceOCR ||
    visionContext?.layout?.canvas_heavy === true ||
    (domSnapshot?.elements_count || 0) < 3 // Very few DOM elements → likely canvas/image-heavy
  );

  if (shouldOCR && isOCRReady()) {
    const phaseBStart = performance.now();
    
    try {
      // Determine ROIs (regions of interest) for selective OCR
      const rois = buildOCRRegions(domSnapshot, visionContext, faceBBs);
      
      ocrResult = await extractText(screenshot, rois);
      
      // ── Phase C: Scan OCR text for PII ────────────────────────────────
      if (ocrResult.fullText.length > 0) {
        const [ocrRegexMatches, ocrNerMatches] = await Promise.allSettled([
          Promise.resolve(scanRegexPII(ocrResult.fullText, {})),
          isNERReady() ? scanNER(ocrResult.fullText, {}) : Promise.resolve([]),
        ]);

        const ocrRegex = ocrRegexMatches.status === 'fulfilled' ? ocrRegexMatches.value : [];
        const ocrNer = ocrNerMatches.status === 'fulfilled' ? ocrNerMatches.value : [];

        // Tag OCR matches with their detection method
        ocrRegex.forEach(m => { m.method = 'OCR_REGEX'; });
        ocrNer.forEach(m => { m.method = 'OCR_NER'; });

        const allOCRPII = [...ocrRegex, ...ocrNer];

        // Map OCR PII back to image bounding boxes
        ocrPIIRegions = mapPIIToImageRegions(allOCRPII, ocrResult.lines);
      }
    } catch (error) {
      console.error('[Privacy Worker] OCR pipeline error:', error);
    }

    phaseBTime = Math.round(performance.now() - phaseBStart);
  }

  // ── Phase D: Merge + Deduplicate all DOM matches ──────────────────────
  const mergedElementMatches = mergeElementMatches(regexMatches, nerMatches);

  // ── Phase E: Redaction (DOM + Image) ─────────────────────────────────
  const phaseEStart = performance.now();

  let domResult;
  try {
    domResult = redactDOM(domSnapshot, mergedElementMatches, sessionId);
  } catch (err) {
    console.error('[Privacy Worker] redactDOM error:', err);
    domResult = {
      sanitizedDOM: domSnapshot,
      redactionMap: { tokens: {} },
      privacyStats: { pii_tokens_masked: 0, dom_masked_fields: 0 },
      tokenManifest: { tokens_used: [], total_tokens: 0 },
    };
  }

  // Extract DOM element bounding boxes that contain redacted PII to blackout on screenshot
  const domPIIRegions = (domResult.sanitizedDOM?.elements || [])
    .filter(el => el.is_redacted && Array.isArray(el.coordinates) && el.coordinates.length === 4)
    .map(el => ({
      bbox: el.coordinates,
      type: (el.redacted_types && el.redacted_types[0]) || 'DOM_PII',
      elementId: el.id,
    }));

  const allImagePIIRegions = [...ocrPIIRegions, ...domPIIRegions];

  let imageResult = { redactedBase64: null, facesRedacted: 0, regionsRedacted: 0 };
  if (screenshot) {
    try {
      imageResult = await redactImage(screenshot, faceBBs, allImagePIIRegions);
    } catch (err) {
      console.error('[Privacy Worker] redactImage error:', err);
    }
  }

  const phaseETime = Math.round(performance.now() - phaseEStart);

  // ── Finalize ──────────────────────────────────────────────────────────
  const totalTime = Math.round(performance.now() - startTime);

  // Update session stats
  state.sessionStats.totalCalls++;
  state.sessionStats.totalPIIDetected += domResult.privacyStats.pii_tokens_masked;
  state.sessionStats.totalFacesRedacted += imageResult.facesRedacted;
  state.sessionStats.avgProcessingTimeMs = Math.round(
    (state.sessionStats.avgProcessingTimeMs * (state.sessionStats.totalCalls - 1) + totalTime) / 
    state.sessionStats.totalCalls
  );

  // Store the redaction map & audit locally (NEVER sent to server)
  state.currentRedactionMap = domResult.redactionMap;
  state.currentAudit = domResult.tokenAudit || [];

  // Merge privacy stats
  const finalStats = {
    ...domResult.privacyStats,
    faces_redacted: imageResult.facesRedacted,
    ocr_regions_redacted: imageResult.regionsRedacted,
  };

  return {
    sanitizedDOM: domResult.sanitizedDOM,
    redactedScreenshot: imageResult.redactedBase64,
    redactionMap: domResult.redactionMap, // Stays on client!
    privacyStats: finalStats,
    tokenManifest: domResult.tokenManifest,
    tokenAudit: domResult.tokenAudit || [],
    processingTime: {
      total: totalTime,
      phaseA_domScan: phaseATime,
      phaseB_ocr: phaseBTime,
      phaseE_redaction: phaseETime,
    },
  };
}

// ─── Helper Functions ───────────────────────────────────────────────────────────

/**
 * Merge regex and NER matches for the same DOM elements.
 * Deduplicates overlapping matches (keeps higher-confidence one).
 * 
 * @param {Array<{elementId: string, matches: Array}>} regexResults
 * @param {Array<{elementId: string, matches: Array}>} nerResults
 * @returns {Array<{elementId: string, matches: Array}>}
 */
function mergeElementMatches(regexResults, nerResults) {
  const byElement = new Map();

  // Add regex matches
  for (const result of regexResults) {
    if (!byElement.has(result.elementId)) {
      byElement.set(result.elementId, []);
    }
    byElement.get(result.elementId).push(...result.matches);
  }

  // Add NER matches (with overlap check)
  for (const result of nerResults) {
    if (!byElement.has(result.elementId)) {
      byElement.set(result.elementId, []);
    }
    
    const existing = byElement.get(result.elementId);
    
    for (const nerMatch of result.matches) {
      // Check if this NER match overlaps with an existing regex match
      const overlapping = existing.find(
        e => nerMatch.start < e.end && nerMatch.end > e.start
      );

      if (overlapping) {
        // Keep the one with higher confidence (regex is always 1.0, so it wins for overlaps)
        // But if NER found something regex didn't, keep it
        if (nerMatch.confidence > overlapping.confidence) {
          const idx = existing.indexOf(overlapping);
          existing[idx] = nerMatch;
        }
        // Otherwise skip the NER match (regex already caught it)
      } else {
        existing.push(nerMatch);
      }
    }
  }

  // Convert map back to array
  return Array.from(byElement.entries()).map(([elementId, matches]) => ({
    elementId,
    matches: matches.sort((a, b) => a.start - b.start),
  }));
}

/**
 * Build Regions of Interest for selective OCR.
 * Only OCR areas that are likely to contain PII, not the entire screenshot.
 * 
 * @param {object} domSnapshot - DOM snapshot
 * @param {object} visionContext - Vision context from vision worker
 * @param {Array<{bbox: number[]}>} faceBBs - Face bounding boxes
 * @returns {Array<{bbox: number[], label: string}>}
 */
function buildOCRRegions(domSnapshot, visionContext, faceBBs) {
  const rois = [];

  // If canvas_heavy, OCR the entire visible area (no DOM to guide us)
  if (visionContext?.layout?.canvas_heavy) {
    return []; // Empty = full-image OCR
  }

  // Add regions around detected faces (names might be near faces)
  for (const face of faceBBs) {
    if (!face.bbox || face.bbox.length < 4) continue;
    const [x, y, w, h] = face.bbox;
    
    // Expand the region below/beside the face (likely name text)
    rois.push({
      bbox: [
        Math.max(0, x - w),
        y,
        w * 3,
        h * 2.5,
      ],
      label: 'face_vicinity',
    });
  }

  // Add regions for form-like areas detected by vision
  const formRegions = (visionContext?.detected_regions || [])
    .filter(r => ['auth_card', 'form_area', 'profile_section'].includes(r.type));
  
  for (const region of formRegions) {
    rois.push({
      bbox: region.bbox,
      label: region.type,
    });
  }

  // If no specific ROIs found, return empty (triggers full-image OCR)
  return rois;
}

// ─── Token Resolution (Client-Side Only) ────────────────────────────────────────

/**
 * Resolve a single token back to its original value.
 * Called by the service worker when executing local actions.
 * 
 * @param {string} token - Token like "[EMAIL_1]"
 * @returns {string|null} Original value or null
 */
function resolveTokenLocal(token) {
  if (!state.currentRedactionMap) return null;
  return resolveToken(state.currentRedactionMap, token);
}

/**
 * Restore all tokens in a text string to their original values.
 * Called for local-only operations (e.g., filling forms from vault).
 * 
 * @param {string} text - Text with tokens
 * @returns {string} Text with original values
 */
function restoreTokensLocal(text) {
  if (!state.currentRedactionMap) return text;
  return restoreTokens(text, state.currentRedactionMap);
}

// ─── Message Handler ────────────────────────────────────────────────────────────

/**
 * Handle messages from the service worker.
 */
self.onmessage = async function(event) {
  const { type, ...data } = event.data;

  try {
    switch (type) {
      case 'INIT': {
        const result = await initialize();
        self.postMessage({
          type: 'INIT_COMPLETE',
          ...result,
        });
        break;
      }

      case 'SANITIZE': {
        const result = await sanitize({
          domSnapshot: data.domSnapshot,
          screenshot: data.screenshot,
          faceBBs: data.faceBBs || [],
          sessionId: data.sessionId || '',
          visionContext: data.visionContext,
          forceOCR: data.forceOCR || false,
        });

        // Send the sanitized result back to service worker
        // NOTE: redactionMap is included here for the service worker to store locally
        // The service worker MUST strip it before sending to the server
        self.postMessage({
          type: 'SANITIZE_RESULT',
          sanitizedDOM: result.sanitizedDOM,
          redactedScreenshot: result.redactedScreenshot,
          redactionMap: result.redactionMap, // Client-only — SW must NOT forward to server
          privacyStats: result.privacyStats,
          tokenManifest: result.tokenManifest,
          tokenAudit: result.tokenAudit,
          processingTime: result.processingTime,
        });
        break;
      }

      case 'SANITIZE_INCREMENTAL': {
        const result = redactIncrementalDOM(
          data.previousDOM,
          data.newDOM,
          scanDOMElements,
          data.sessionId || state.currentSessionId || ''
        );

        state.currentRedactionMap = result.redactionMap;
        state.currentAudit = result.tokenAudit || [];

        self.postMessage({
          type: 'SANITIZE_RESULT',
          sanitizedDOM: result.sanitizedDOM,
          redactedScreenshot: null, // Incremental scans prioritize DOM action speed
          redactionMap: result.redactionMap,
          privacyStats: result.privacyStats,
          tokenManifest: result.tokenManifest,
          tokenAudit: result.tokenAudit,
          incrementalStats: result.incrementalStats,
        });
        break;
      }

      case 'GET_AUDIT': {
        self.postMessage({
          type: 'AUDIT_RESULT',
          audit: state.currentAudit,
          sessionStats: state.sessionStats,
          tokensCount: state.currentRedactionMap 
            ? Object.keys(state.currentRedactionMap.tokens).length 
            : 0,
        });
        break;
      }

      case 'RESOLVE_TOKEN': {
        const value = resolveTokenLocal(data.token);
        self.postMessage({
          type: 'TOKEN_RESOLVED',
          token: data.token,
          value, // This stays local — used for TYPE_FROM_VAULT actions
          requestId: data.requestId,
        });
        break;
      }

      case 'RESTORE_TEXT': {
        const restored = restoreTokensLocal(data.text);
        self.postMessage({
          type: 'TEXT_RESTORED',
          originalText: data.text,
          restoredText: restored,
          requestId: data.requestId,
        });
        break;
      }

      case 'GET_STATS': {
        self.postMessage({
          type: 'STATS',
          sessionStats: state.sessionStats,
          modelsLoaded: state.modelsLoaded,
          modelErrors: state.modelErrors,
          redactionMapSize: state.currentRedactionMap 
            ? Object.keys(state.currentRedactionMap.tokens).length 
            : 0,
        });
        break;
      }

      case 'RESET': {
        resetCounters(data.sessionId);
        state.currentRedactionMap = null;
        state.currentSessionId = data.sessionId || null;
        state.sessionStats = {
          totalCalls: 0,
          totalPIIDetected: 0,
          totalFacesRedacted: 0,
          avgProcessingTimeMs: 0,
        };
        self.postMessage({ type: 'RESET_COMPLETE' });
        break;
      }

      default:
        console.warn('[Privacy Worker] Unknown message type:', type);
        self.postMessage({
          type: 'ERROR',
          error: `Unknown message type: ${type}`,
        });
    }
  } catch (error) {
    console.error('[Privacy Worker] Error handling message:', error);
    self.postMessage({
      type: 'ERROR',
      error: error.message,
      stack: error.stack,
      originalType: type,
    });
  }
};

// ─── Worker Ready Signal ────────────────────────────────────────────────────────

self.postMessage({ type: 'WORKER_READY' });
