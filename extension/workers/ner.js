/**
 * ner.js — Contextual Named Entity Recognition via Transformers.js
 * Pecific Privacy Engine (Dev 3 — R3)
 * 
 * Runs Xenova/bert-base-NER (ONNX INT8, ~65MB) inside the Web Worker.
 * Catches contextual PII that regex cannot: person names, addresses, organizations.
 * Applies smart post-filtering to distinguish personal names from brand names,
 * personal addresses from navigation locations, etc.
 * 
 * @module ner
 */

// ─── State ──────────────────────────────────────────────────────────────────────

let nerPipeline = null;
let isInitialized = false;
let isInitializing = false;

// ─── Configuration ──────────────────────────────────────────────────────────────

const NER_CONFIG = {
  // Model to use — Xenova/bert-base-NER is the best accuracy/size tradeoff for browser
  // Fallback: Xenova/distilbert-NER (~40% smaller, ~30% faster, slightly less accurate)
  model: 'Xenova/bert-base-NER',
  
  // Maximum tokens per chunk (BERT max is 512, we use 400 to leave room for special tokens)
  maxChunkTokens: 400,
  
  // Overlap tokens between chunks to catch entities at boundaries
  chunkOverlap: 50,
  
  // Minimum confidence threshold for accepting an entity
  minConfidence: 0.75,
  
  // Quantization options for ONNX Runtime Web
  quantized: true,
};

// ─── Entity Type Mapping ────────────────────────────────────────────────────────

/** Map NER model labels to our PII types */
const ENTITY_TYPE_MAP = {
  'PER': 'NAME',
  'B-PER': 'NAME',
  'I-PER': 'NAME',
  'LOC': 'ADDRESS',
  'B-LOC': 'ADDRESS',
  'I-LOC': 'ADDRESS',
  'ORG': 'ORGANIZATION',
  'B-ORG': 'ORGANIZATION',
  'I-ORG': 'ORGANIZATION',
  'MISC': 'MISC',
  'B-MISC': 'MISC',
  'I-MISC': 'MISC',
};

// ─── Context-Aware Post-Processing Filters ──────────────────────────────────────

/**
 * Well-known brand/product names that should NEVER be redacted as person names.
 * This list is intentionally conservative — better to miss a brand than redact a real name.
 */
const BRAND_NAMES = new Set([
  // Tech companies
  'amazon', 'flipkart', 'google', 'apple', 'microsoft', 'samsung', 'sony',
  'dell', 'hp', 'lenovo', 'asus', 'acer', 'nokia', 'motorola', 'xiaomi',
  'oneplus', 'oppo', 'vivo', 'realme', 'poco', 'redmi', 'huawei',
  'meta', 'facebook', 'instagram', 'whatsapp', 'twitter', 'linkedin',
  'youtube', 'netflix', 'spotify', 'adobe', 'oracle', 'ibm', 'intel',
  'nvidia', 'amd', 'qualcomm', 'uber', 'ola', 'zomato', 'swiggy',
  // Indian brands/services
  'paytm', 'phonepe', 'razorpay', 'hdfc', 'icici', 'sbi', 'axis',
  'kotak', 'bajaj', 'reliance', 'jio', 'airtel', 'vodafone', 'tata',
  'infosys', 'wipro', 'hcl', 'mahindra', 'byju', 'unacademy',
  // E-commerce/brands
  'boat', 'jbl', 'bose', 'sennheiser', 'skullcandy', 'zebronics',
  'nike', 'adidas', 'puma', 'reebok', 'levi', 'zara', 'h&m',
  // Common navigation words mistaken for names
  'home', 'about', 'login', 'signup', 'cart', 'checkout', 'profile',
  'settings', 'search', 'menu', 'help', 'contact', 'privacy',
]);

/**
 * DOM contexts where person names ARE personal PII (require redaction)
 */
const PERSONAL_NAME_CONTEXTS = new Set([
  'profile', 'account', 'user', 'greeting', 'welcome',
  'form', 'input', 'address', 'shipping', 'billing',
  'review-author', 'reviewer', 'author',
  'my-account', 'my-profile', 'dashboard',
  'recipient', 'sender', 'contact',
]);

/**
 * DOM contexts where addresses ARE personal PII (require redaction)
 */
const PERSONAL_ADDRESS_CONTEXTS = new Set([
  'address', 'delivery', 'shipping', 'billing',
  'profile', 'residence', 'home-address', 'office-address',
  'pickup', 'dropoff', 'destination',
  'form', 'input',
]);

/**
 * DOM contexts where addresses are NOT personal (navigation/filtering)
 */
const NON_PERSONAL_LOCATION_CONTEXTS = new Set([
  'filter', 'navigation', 'breadcrumb', 'nav',
  'search-result', 'search', 'store-locator',
  'footer', 'header', 'menu', 'sidebar',
  'city-selector', 'location-picker', 'pin-code',
]);

// ─── Text Chunking ──────────────────────────────────────────────────────────────

/**
 * Split text into chunks suitable for BERT processing.
 * Uses simple word-based splitting with overlap for boundary entities.
 * 
 * @param {string} text - Full text to chunk
 * @param {number} maxTokens - Max tokens per chunk (approximate — uses word count as proxy)
 * @param {number} overlap - Number of words to overlap between chunks
 * @returns {Array<{text: string, startOffset: number, endOffset: number}>}
 */
function chunkText(text, maxTokens = NER_CONFIG.maxChunkTokens, overlap = NER_CONFIG.chunkOverlap) {
  if (!text || text.length === 0) return [];
  
  // Simple word-based chunking (BERT tokenizer averages ~1.3 tokens per word)
  const words = text.split(/\s+/);
  const wordsPerChunk = Math.floor(maxTokens / 1.3);
  
  if (words.length <= wordsPerChunk) {
    return [{ text, startOffset: 0, endOffset: text.length }];
  }

  const chunks = [];
  let wordIndex = 0;

  while (wordIndex < words.length) {
    const chunkWords = words.slice(wordIndex, wordIndex + wordsPerChunk);
    const chunkText = chunkWords.join(' ');
    
    // Calculate character offsets
    const startOffset = wordIndex === 0 ? 0 : text.indexOf(chunkWords[0], 
      chunks.length > 0 ? chunks[chunks.length - 1].startOffset + 1 : 0);
    const endOffset = startOffset + chunkText.length;
    
    chunks.push({
      text: chunkText,
      startOffset,
      endOffset,
    });

    wordIndex += wordsPerChunk - overlap;
  }

  return chunks;
}

// ─── Initialization ─────────────────────────────────────────────────────────────

/**
 * Initialize the NER model. Downloads and caches in IndexedDB on first run.
 * Subsequent calls use the cached model (~65MB first download, then instant).
 * 
 * @returns {Promise<{success: boolean, loadTime: number, error?: string}>}
 */
export async function initNER() {
  if (isInitialized) return { success: true, loadTime: 0 };
  if (isInitializing) {
    // Wait for ongoing initialization
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (isInitialized) {
          clearInterval(check);
          resolve({ success: true, loadTime: 0 });
        }
      }, 100);
    });
  }

  isInitializing = true;
  const startTime = performance.now();

  try {
    // Dynamically import Transformers.js
    // In the extension, this is loaded from extension/lib/transformers.min.js
    // The importScripts path depends on the worker setup
    const { pipeline } = await import('../lib/transformers.min.js');

    nerPipeline = await pipeline('token-classification', NER_CONFIG.model, {
      quantized: NER_CONFIG.quantized,
      // Use WebGPU backend if available, fallback to WASM
      device: 'auto',
    });

    isInitialized = true;
    isInitializing = false;
    const loadTime = Math.round(performance.now() - startTime);
    
    return { success: true, loadTime };
  } catch (error) {
    isInitializing = false;
    console.error('[NER] Model initialization failed:', error);
    return { success: false, loadTime: 0, error: error.message };
  }
}

/**
 * Check if the NER model is ready for inference
 * @returns {boolean}
 */
export function isNERReady() {
  return isInitialized && nerPipeline !== null;
}

// ─── Post-Processing ────────────────────────────────────────────────────────────

/**
 * Merge sub-word tokens from BERT into complete entities.
 * BERT tokenizes "Aditya" as ["Ad", "##itya"] — we need to merge these.
 * 
 * @param {Array} rawEntities - Raw entities from Transformers.js pipeline
 * @returns {Array<{word: string, entity: string, score: number, start: number, end: number}>}
 */
function mergeSubwordEntities(rawEntities) {
  if (!rawEntities || rawEntities.length === 0) return [];

  const merged = [];
  let current = null;

  for (const entity of rawEntities) {
    const isSubword = entity.word.startsWith('##');
    const entityType = entity.entity.replace(/^[BI]-/, '');
    const isContinuation = entity.entity.startsWith('I-');

    if (isSubword && current) {
      // Merge sub-word into current entity
      current.word += entity.word.replace('##', '');
      current.end = entity.end;
      current.score = Math.min(current.score, entity.score); // Use minimum confidence
    } else if (isContinuation && current && entityType === current.entity) {
      // Continue multi-word entity (e.g., "Aditya Sharma")
      current.word += ' ' + entity.word;
      current.end = entity.end;
      current.score = Math.min(current.score, entity.score);
    } else {
      // Start new entity
      if (current) merged.push(current);
      current = {
        word: entity.word,
        entity: entityType,
        score: entity.score,
        start: entity.start,
        end: entity.end,
      };
    }
  }

  if (current) merged.push(current);
  return merged;
}

/**
 * Apply context-aware filtering to remove non-personal entities.
 * 
 * @param {Array} entities - Merged entities from mergeSubwordEntities
 * @param {object} context - DOM structural context
 * @returns {Array} Filtered entities that are actual PII
 */
function filterEntities(entities, context = {}) {
  const contextClasses = (context.parentClass || '').toLowerCase();
  const contextId = (context.parentId || '').toLowerCase();
  const contextTag = (context.parentTag || '').toLowerCase();
  const nearbyLabels = (context.nearbyLabels || '').toLowerCase();

  // Build a set of applicable context keywords
  const contextKeywords = new Set();
  const allContextText = `${contextClasses} ${contextId} ${contextTag} ${nearbyLabels}`;
  allContextText.split(/[\s\-_]+/).forEach(word => {
    if (word.length > 0) contextKeywords.add(word);
  });

  return entities.filter(entity => {
    const entityLower = entity.word.toLowerCase().trim();
    
    // Skip very short entities (likely noise)
    if (entityLower.length < 2) return false;

    switch (entity.entity) {
      case 'PER': {
        // Skip if it's a known brand name
        if (BRAND_NAMES.has(entityLower)) return false;
        
        // Skip single common English words mistaken for names
        if (['the', 'mr', 'mrs', 'ms', 'dr', 'sir', 'no', 'yes', 'new', 'old', 'buy', 'sell', 'add', 'get', 'top', 'best', 'free'].includes(entityLower)) return false;

        // Check confidence threshold
        if (entity.score < NER_CONFIG.minConfidence) return false;

        // In non-personal contexts (nav, footer), require higher confidence
        const isPersonalContext = [...PERSONAL_NAME_CONTEXTS].some(ctx => contextKeywords.has(ctx));
        if (!isPersonalContext && entity.score < 0.90) return false;

        return true;
      }

      case 'LOC': {
        // Skip very common location words that are usually navigation
        if (['india', 'usa', 'uk', 'us'].includes(entityLower)) {
          // These are too generic — only redact if clearly in an address context
          const isAddressContext = [...PERSONAL_ADDRESS_CONTEXTS].some(ctx => contextKeywords.has(ctx));
          if (!isAddressContext) return false;
        }

        // Skip if in a non-personal location context (filters, navigation)
        const isNonPersonal = [...NON_PERSONAL_LOCATION_CONTEXTS].some(ctx => contextKeywords.has(ctx));
        if (isNonPersonal) return false;

        // Check confidence
        if (entity.score < 0.80) return false;

        return true;
      }

      case 'ORG': {
        // Organizations are almost never personal PII on e-commerce/general browsing
        // Only redact if clearly the user's personal org (employer, etc.)
        const isPersonalOrgContext = contextKeywords.has('employer') || 
                                     contextKeywords.has('company') || 
                                     contextKeywords.has('workplace') ||
                                     contextKeywords.has('organization');
        
        if (!isPersonalOrgContext) return false;
        if (entity.score < 0.90) return false;
        if (BRAND_NAMES.has(entityLower)) return false;

        return true;
      }

      case 'MISC':
        // MISC entities are rarely PII — skip
        return false;

      default:
        return false;
    }
  });
}

// ─── Main Scanner ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} NERMatch
 * @property {string} type - PII category: 'NAME' | 'ADDRESS' | 'ORGANIZATION'
 * @property {string} value - The matched text
 * @property {number} start - Start index in source text
 * @property {number} end - End index in source text
 * @property {number} confidence - Model confidence (0.0-1.0)
 * @property {string} method - Always 'NER'
 * @property {string} nerLabel - Original NER label (PER/LOC/ORG)
 */

/**
 * Scan text for contextual PII using Named Entity Recognition.
 * 
 * @param {string} text - Text to analyze for named entities
 * @param {object} [context={}] - DOM structural context for smart filtering
 * @param {string} [context.parentTag] - Parent element tag
 * @param {string} [context.parentClass] - Parent element class string
 * @param {string} [context.parentId] - Parent element ID
 * @param {string} [context.nearbyLabels] - Nearby label text
 * @returns {Promise<NERMatch[]>} Array of NER-detected PII
 */
export async function scanNER(text, context = {}) {
  if (!isInitialized || !nerPipeline) {
    console.warn('[NER] Model not initialized. Call initNER() first.');
    return [];
  }

  if (!text || typeof text !== 'string' || text.trim().length === 0) return [];

  try {
    // Chunk the text for BERT processing
    const chunks = chunkText(text);
    
    /** @type {NERMatch[]} */
    const allMatches = [];
    
    // Process each chunk
    for (const chunk of chunks) {
      // Run NER inference
      const rawEntities = await nerPipeline(chunk.text, {
        aggregation_strategy: 'none', // We handle merging ourselves for better control
      });

      // Merge sub-word tokens
      const merged = mergeSubwordEntities(rawEntities);

      // Apply context-aware filtering
      const filtered = filterEntities(merged, context);

      // Convert to PIIMatch format with correct offsets
      for (const entity of filtered) {
        const piiType = ENTITY_TYPE_MAP[entity.entity] || ENTITY_TYPE_MAP[`B-${entity.entity}`];
        if (!piiType || piiType === 'MISC') continue;

        allMatches.push({
          type: piiType,
          value: entity.word,
          start: chunk.startOffset + entity.start,
          end: chunk.startOffset + entity.end,
          confidence: parseFloat(entity.score.toFixed(4)),
          method: 'NER',
          nerLabel: entity.entity,
        });
      }
    }

    // Deduplicate matches from overlapping chunks
    return deduplicateMatches(allMatches);
  } catch (error) {
    console.error('[NER] Inference error:', error);
    return [];
  }
}

/**
 * Deduplicate NER matches that may appear in overlapping chunk regions.
 * Keeps the match with higher confidence when duplicates are found.
 * 
 * @param {NERMatch[]} matches
 * @returns {NERMatch[]}
 */
function deduplicateMatches(matches) {
  if (matches.length <= 1) return matches;

  // Sort by start position
  matches.sort((a, b) => a.start - b.start || a.end - b.end);

  const deduplicated = [];
  for (const match of matches) {
    const lastMatch = deduplicated[deduplicated.length - 1];
    
    if (lastMatch && 
        match.start >= lastMatch.start && 
        match.end <= lastMatch.end + 5 && // Small tolerance for boundary differences
        match.type === lastMatch.type) {
      // Duplicate — keep the one with higher confidence
      if (match.confidence > lastMatch.confidence) {
        deduplicated[deduplicated.length - 1] = match;
      }
    } else {
      deduplicated.push(match);
    }
  }

  return deduplicated;
}

/**
 * Scan an array of DOM elements for NER-based PII.
 * 
 * @param {Array<{id: string, text?: string, parentTag?: string, parentClass?: string, nearbyLabels?: string}>} elements
 * @returns {Promise<Array<{elementId: string, matches: NERMatch[]}>>}
 */
export async function scanDOMElementsNER(elements) {
  if (!Array.isArray(elements) || !isInitialized) return [];

  const results = [];

  for (const el of elements) {
    if (!el.text || el.text.trim().length < 3) continue;

    const context = {
      parentTag: el.parentTag || el.tag || '',
      parentClass: el.parentClass || '',
      parentId: el.parentId || '',
      nearbyLabels: el.nearbyLabels || el.placeholder || '',
    };

    const matches = await scanNER(el.text, context);
    
    if (matches.length > 0) {
      results.push({
        elementId: el.id,
        matches,
      });
    }
  }

  return results;
}
