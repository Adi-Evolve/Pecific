/**
 * ocr.js — Screenshot Text Extraction via Tesseract.js
 * PrivacyLens Privacy Engine (Dev 3 — R3)
 * 
 * Extracts visible text from screenshots so we can run Regex + NER on text
 * rendered as images (Canvas, SVG, images with baked text).
 * Provides bounding box coordinates for each text region so the redaction
 * engine knows WHERE on the image to black out PII.
 * 
 * Uses selective Region-of-Interest (ROI) cropping to reduce latency.
 * 
 * @module ocr
 */

// ─── State ──────────────────────────────────────────────────────────────────────

let tesseractWorker = null;
let isInitialized = false;
let isInitializing = false;

// ─── Configuration ──────────────────────────────────────────────────────────────

const OCR_CONFIG = {
  // Languages to recognize (English primary, Hindi optional)
  languages: 'eng',
  
  // Tesseract.js CDN path for WASM and language data
  // In extension context, these are bundled locally
  workerPath: null,   // Will use bundled worker
  corePath: null,     // Will use bundled core
  langPath: null,     // Will use bundled language data
  
  // Downscale factor for faster OCR (0.5 = half resolution)
  scaleFactor: 1.0,
  
  // Minimum confidence to include a word in results
  minWordConfidence: 40,
  
  // PSM (Page Segmentation Mode)
  // 3 = Fully automatic, 6 = Assume single block, 11 = Sparse text
  pageSegMode: '3',
  
  // OEM (OCR Engine Mode)
  // 1 = LSTM only (faster, more accurate for modern text)
  ocrEngineMode: '1',
};

// ─── Initialization ─────────────────────────────────────────────────────────────

/**
 * Initialize the Tesseract.js WASM worker.
 * Downloads language data (~15MB) on first run, cached in IndexedDB afterward.
 * 
 * @returns {Promise<{success: boolean, loadTime: number, error?: string}>}
 */
export async function initOCR() {
  if (isInitialized) return { success: true, loadTime: 0 };
  if (isInitializing) {
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
    // In a Web Worker context, we use Tesseract.js createWorker
    // The library is loaded via importScripts in the privacy worker
    const Tesseract = self.Tesseract || (await import('../lib/tesseract.min.js')).default;

    tesseractWorker = await Tesseract.createWorker(OCR_CONFIG.languages, OCR_CONFIG.ocrEngineMode, {
      // Use cached data from IndexedDB when available
      cacheMethod: 'readOnly',
      // Logger for debugging (disable in production)
      logger: (m) => {
        if (m.status === 'recognizing text') {
          // Progress tracking — can be sent to UI if needed
        }
      },
    });

    // Set Tesseract parameters for optimal accuracy/speed tradeoff
    await tesseractWorker.setParameters({
      tessedit_pageseg_mode: OCR_CONFIG.pageSegMode,
      preserve_interword_spaces: '1',
    });

    isInitialized = true;
    isInitializing = false;
    const loadTime = Math.round(performance.now() - startTime);

    return { success: true, loadTime };
  } catch (error) {
    isInitializing = false;
    console.error('[OCR] Initialization failed:', error);
    return { success: false, loadTime: 0, error: error.message };
  }
}

/**
 * Check if the OCR engine is ready for inference
 * @returns {boolean}
 */
export function isOCRReady() {
  return isInitialized && tesseractWorker !== null;
}

/**
 * Terminate the OCR worker and free resources
 * @returns {Promise<void>}
 */
export async function terminateOCR() {
  if (tesseractWorker) {
    await tesseractWorker.terminate();
    tesseractWorker = null;
    isInitialized = false;
  }
}

// ─── Image Utilities ────────────────────────────────────────────────────────────

/**
 * Crop a region from an image using OffscreenCanvas.
 * 
 * @param {ImageBitmap|ImageData} image - Source image
 * @param {number[]} bbox - [x, y, width, height] region to crop
 * @returns {ImageData} Cropped image data
 */
function cropRegion(image, bbox) {
  const [x, y, w, h] = bbox;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  
  if (image instanceof ImageBitmap) {
    ctx.drawImage(image, x, y, w, h, 0, 0, w, h);
  } else if (image instanceof ImageData) {
    // Create a temporary canvas with the full image, then crop
    const tempCanvas = new OffscreenCanvas(image.width, image.height);
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.putImageData(image, 0, 0);
    ctx.drawImage(tempCanvas, x, y, w, h, 0, 0, w, h);
  }
  
  return ctx.getImageData(0, 0, w, h);
}

/**
 * Convert ImageBitmap to a format Tesseract.js can process.
 * Tesseract.js accepts: Canvas, Image element, ImageData, Buffer, or base64 string.
 * In a Web Worker, we use OffscreenCanvas to produce a Blob.
 * 
 * @param {ImageBitmap|ImageData|string} image - Input image
 * @returns {Promise<Blob>} Image as a Blob
 */
async function imageToBlob(image) {
  if (typeof image === 'string') {
    // It's already a base64 string or data URL
    if (image.startsWith('data:')) {
      const response = await fetch(image);
      return response.blob();
    }
    // Raw base64
    const byteString = atob(image);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: 'image/png' });
  }

  if (image instanceof ImageBitmap) {
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return canvas.convertToBlob({ type: 'image/png' });
  }

  if (image instanceof ImageData) {
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.putImageData(image, 0, 0);
    return canvas.convertToBlob({ type: 'image/png' });
  }

  throw new Error('[OCR] Unsupported image format');
}

// ─── Main OCR Functions ─────────────────────────────────────────────────────────

/**
 * @typedef {Object} OCRWord
 * @property {string} text - The recognized word
 * @property {number[]} bbox - [x, y, width, height] in image coordinates
 * @property {number} confidence - OCR confidence (0-100)
 * @property {number} lineNum - Line number this word belongs to
 */

/**
 * @typedef {Object} OCRLine
 * @property {string} text - Full line text
 * @property {number[]} bbox - [x, y, width, height] of the line
 * @property {OCRWord[]} words - Words in this line
 */

/**
 * @typedef {Object} OCRResult
 * @property {OCRWord[]} words - Individual words with positions
 * @property {OCRLine[]} lines - Lines of text with positions
 * @property {string} fullText - Concatenated text for NER/Regex scanning
 * @property {number} processingTime - Time taken in ms
 * @property {object} dimensions - Image dimensions used for OCR
 */

/**
 * Extract text with bounding boxes from an image.
 * 
 * @param {ImageBitmap|ImageData|string} image - Screenshot (ImageBitmap, ImageData, or base64)
 * @param {Array<{bbox: number[], label?: string}>} [regionsOfInterest=[]] - Optional ROIs to limit OCR scope
 * @returns {Promise<OCRResult>}
 */
export async function extractText(image, regionsOfInterest = []) {
  if (!isInitialized || !tesseractWorker) {
    console.warn('[OCR] Not initialized. Call initOCR() first.');
    return { words: [], lines: [], fullText: '', processingTime: 0, dimensions: {} };
  }

  const startTime = performance.now();

  try {
    let imagesToProcess = [];

    if (regionsOfInterest.length > 0) {
      // Selective OCR: only process specific regions
      for (const roi of regionsOfInterest) {
        try {
          const cropped = cropRegion(image, roi.bbox);
          imagesToProcess.push({
            image: cropped,
            offsetX: roi.bbox[0],
            offsetY: roi.bbox[1],
            label: roi.label || 'roi',
          });
        } catch (e) {
          console.warn('[OCR] Failed to crop ROI:', roi, e);
        }
      }
    } else {
      // Full image OCR
      imagesToProcess.push({
        image: image,
        offsetX: 0,
        offsetY: 0,
        label: 'full',
      });
    }

    /** @type {OCRWord[]} */
    const allWords = [];
    /** @type {OCRLine[]} */
    const allLines = [];
    const textParts = [];
    let imageDimensions = {};

    for (const item of imagesToProcess) {
      const blob = await imageToBlob(item.image);
      
      const result = await tesseractWorker.recognize(blob);
      const data = result.data;

      // Store dimensions
      if (item.label === 'full') {
        imageDimensions = {
          width: data.width || (image instanceof ImageBitmap ? image.width : image.width),
          height: data.height || (image instanceof ImageBitmap ? image.height : image.height),
        };
      }

      // Process words
      if (data.words) {
        for (const word of data.words) {
          if (word.confidence < OCR_CONFIG.minWordConfidence) continue;
          if (!word.text || word.text.trim().length === 0) continue;

          const bbox = [
            (word.bbox?.x0 || 0) + item.offsetX,
            (word.bbox?.y0 || 0) + item.offsetY,
            (word.bbox?.x1 || 0) - (word.bbox?.x0 || 0),  // width
            (word.bbox?.y1 || 0) - (word.bbox?.y0 || 0),   // height
          ];

          allWords.push({
            text: word.text.trim(),
            bbox,
            confidence: word.confidence,
            lineNum: word.line?.baseline?.y0 || 0,
          });
        }
      }

      // Process lines
      if (data.lines) {
        for (const line of data.lines) {
          if (!line.text || line.text.trim().length === 0) continue;

          const bbox = [
            (line.bbox?.x0 || 0) + item.offsetX,
            (line.bbox?.y0 || 0) + item.offsetY,
            (line.bbox?.x1 || 0) - (line.bbox?.x0 || 0),
            (line.bbox?.y1 || 0) - (line.bbox?.y0 || 0),
          ];

          const lineWords = (line.words || [])
            .filter(w => w.confidence >= OCR_CONFIG.minWordConfidence)
            .map(w => ({
              text: w.text.trim(),
              bbox: [
                (w.bbox?.x0 || 0) + item.offsetX,
                (w.bbox?.y0 || 0) + item.offsetY,
                (w.bbox?.x1 || 0) - (w.bbox?.x0 || 0),
                (w.bbox?.y1 || 0) - (w.bbox?.y0 || 0),
              ],
              confidence: w.confidence,
            }));

          allLines.push({
            text: line.text.trim(),
            bbox,
            words: lineWords,
          });

          textParts.push(line.text.trim());
        }
      }
    }

    const processingTime = Math.round(performance.now() - startTime);

    return {
      words: allWords,
      lines: allLines,
      fullText: textParts.join('\n'),
      processingTime,
      dimensions: imageDimensions,
    };
  } catch (error) {
    console.error('[OCR] Text extraction failed:', error);
    return {
      words: [],
      lines: [],
      fullText: '',
      processingTime: Math.round(performance.now() - startTime),
      dimensions: {},
    };
  }
}

/**
 * Map PII matches found in OCR text back to image bounding boxes.
 * Given a PII match (with character offsets in fullText) and the OCR words,
 * find the corresponding bounding boxes in the image.
 * 
 * @param {Array<{type: string, value: string, start: number, end: number}>} piiMatches - PII found in OCR text
 * @param {OCRLine[]} ocrLines - Lines from OCR with bounding boxes
 * @returns {Array<{type: string, bbox: number[], value: string}>} PII regions with image coordinates
 */
export function mapPIIToImageRegions(piiMatches, ocrLines) {
  if (!piiMatches || piiMatches.length === 0) return [];
  if (!ocrLines || ocrLines.length === 0) return [];

  const regions = [];

  // Build a character-offset-to-line-bbox mapping
  let currentOffset = 0;
  const lineOffsets = [];
  for (const line of ocrLines) {
    lineOffsets.push({
      start: currentOffset,
      end: currentOffset + line.text.length,
      bbox: line.bbox,
      words: line.words || [],
    });
    currentOffset += line.text.length + 1; // +1 for the \n we joined with
  }

  for (const match of piiMatches) {
    // Find which line(s) this match spans
    const matchingLines = lineOffsets.filter(
      lo => match.start < lo.end && match.end > lo.start
    );

    if (matchingLines.length === 0) continue;

    // For single-line matches, try to find exact word bounding boxes
    if (matchingLines.length === 1) {
      const line = matchingLines[0];
      
      // Try to find matching words for tighter bounding box
      const matchText = match.value.toLowerCase();
      let wordBBs = [];
      
      for (const word of line.words) {
        if (matchText.includes(word.text.toLowerCase())) {
          wordBBs.push(word.bbox);
        }
      }

      if (wordBBs.length > 0) {
        // Merge word bounding boxes into one tight box
        const minX = Math.min(...wordBBs.map(b => b[0]));
        const minY = Math.min(...wordBBs.map(b => b[1]));
        const maxX = Math.max(...wordBBs.map(b => b[0] + b[2]));
        const maxY = Math.max(...wordBBs.map(b => b[1] + b[3]));
        
        regions.push({
          type: match.type,
          bbox: [minX, minY, maxX - minX, maxY - minY],
          value: match.value,
        });
      } else {
        // Fall back to the full line bounding box
        regions.push({
          type: match.type,
          bbox: [...line.bbox],
          value: match.value,
        });
      }
    } else {
      // Multi-line match — merge all line bounding boxes
      const minX = Math.min(...matchingLines.map(l => l.bbox[0]));
      const minY = Math.min(...matchingLines.map(l => l.bbox[1]));
      const maxX = Math.max(...matchingLines.map(l => l.bbox[0] + l.bbox[2]));
      const maxY = Math.max(...matchingLines.map(l => l.bbox[1] + l.bbox[3]));

      regions.push({
        type: match.type,
        bbox: [minX, minY, maxX - minX, maxY - minY],
        value: match.value,
      });
    }
  }

  return regions;
}
