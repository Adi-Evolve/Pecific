importScripts('../lib/ort/ort.webgpu.min.js');

const workerUrl = self.location.href;
const extensionRoot = workerUrl.substring(0, workerUrl.indexOf('/workers/'));
ort.env.wasm.wasmPaths = `${extensionRoot}/lib/ort/`;

const sessions = {};
let backend = null;

async function initSession(name, modelPath) {
  for (const ep of ["webgpu", "wasm"]) {
    try {
      if (ep === "webgpu" && !("gpu" in self.navigator)) continue;
      sessions[name] = await ort.InferenceSession.create(modelPath, { executionProviders: [ep] });
      backend = ep;
      return;
    } catch (e) {
      console.warn(`vision-worker: ${name}/${ep} failed`, e);
    }
  }
  throw new Error(`vision-worker: no execution provider available for ${name}`);
}

async function preprocessImage(imageBitmap) {
  const canvas = new OffscreenCanvas(128, 128);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(imageBitmap, 0, 0, 128, 128);
  const { data } = ctx.getImageData(0, 0, 128, 128);
  const float32 = new Float32Array(3 * 128 * 128);
  for (let i = 0; i < 128 * 128; i++) {
    float32[i]                 = data[i * 4]     / 255.0;
    float32[128 * 128 + i]     = data[i * 4 + 1] / 255.0;
    float32[2 * 128 * 128 + i] = data[i * 4 + 2] / 255.0;
  }
  return new ort.Tensor("float32", float32, [1, 3, 128, 128]);
}

function decodeFaces(results, origWidth, origHeight) {
  const outputTensor = results[sessions.face.outputNames[0]];
  const dims = outputTensor.dims;
  const flatData = outputTensor.data;

  let numDetections;
  if (dims.length === 3) numDetections = dims[1];       // normal case: [1, N, 16]
  else if (dims.length === 2) numDetections = 1;        // observed quirk: single detection collapses to [1, 16]
  else numDetections = Math.floor(flatData.length / 16); // safety fallback

  const faces_detected = [];
  for (let i = 0; i < numDetections; i++) {
    const b = flatData.slice(i * 16, i * 16 + 16);
    const [topY, topX, botY, botX] = b;
    const x1 = topX * origWidth, y1 = topY * origHeight;
    const x2 = botX * origWidth, y2 = botY * origHeight;
    if (x2 - x1 < 5 || y2 - y1 < 5) continue;
    faces_detected.push({ bbox: [x1, y1, x2, y2], confidence: null });
  }
  return faces_detected;
}

async function runInference(imageBitmap, origWidth, origHeight) {
  const imageTensor = await preprocessImage(imageBitmap);
  const feeds = {
    image: imageTensor,
    conf_threshold: new ort.Tensor("float32", [0.5], [1]),
    max_detections: new ort.Tensor("int64", [BigInt(25)], [1]),
    iou_threshold: new ort.Tensor("float32", [0.3], [1])
  };
  const results = await sessions.face.run(feeds);
  return decodeFaces(results, origWidth, origHeight);
}

async function preprocessForMobileViT(imageBitmap) {
  const canvas = new OffscreenCanvas(256, 256);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(imageBitmap, 0, 0, 256, 256);
  const { data } = ctx.getImageData(0, 0, 256, 256);
  const HW = 256 * 256;
  const float32 = new Float32Array(3 * HW);
  for (let i = 0; i < HW; i++) {
    float32[i]          = data[i * 4 + 2] / 255.0;
    float32[HW + i]      = data[i * 4 + 1] / 255.0;
    float32[2 * HW + i] = data[i * 4]     / 255.0;
  }
  return new ort.Tensor("float32", float32, [1, 3, 256, 256]);
}

function softmax(logits) {
  const max = Math.max(...logits);
  const exps = logits.map(v => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(v => v / sum);
}

async function classifyScreen(imageBitmap) {
  const inputTensor = await preprocessForMobileViT(imageBitmap);
  const inputName = sessions.screen.inputNames[0];
  const results = await sessions.screen.run({ [inputName]: inputTensor });
  const outputName = sessions.screen.outputNames[0];
  const logits = Array.from(results[outputName].data);
  const probs = softmax(logits);
  let bestIdx = 0;
  for (let i = 1; i < probs.length; i++) if (probs[i] > probs[bestIdx]) bestIdx = i;
  return {
    // The MobileViT checkpoint does not contain a screen-label vocabulary.
    // Preserve the model's winning class without pretending it maps to a
    // semantic page type.
    screen_type: `model_class_${bestIdx}`,
    confidence: probs[bestIdx],
    confidence_basis: "mobilevit_image_class",
    predicted_class: bestIdx,
    model_output: logits
  };
}

function mergeVisionContext({
  faces_detected,
  screen_type,
  confidence,
  confidence_basis,
  backend,
  processing_ms,
  textPiiRegions = []
}) {
  const pii_regions = [
    ...faces_detected.map(f => ({ type: "face", bbox: f.bbox })),
    ...textPiiRegions.map(r => ({ type: "text_pii", bbox: r.bbox, label: r.label }))
  ];
  return {
    screen_type,
    confidence,
    confidence_basis,
    faces_detected,
    pii_regions,
    visual_pii_regions: pii_regions,
    backend,
    processing_ms
  };
}

self.onmessage = async (e) => {
  const { type } = e.data;

  // extension/workers/vision-worker.js — add this branch inside self.onmessage, anywhere alongside the others
if (type === "DEBUG_NAMES") {
  self.postMessage({
    type: "DEBUG_NAMES_OK",
    face: { inputs: sessions.face.inputNames, outputs: sessions.face.outputNames },
    screen: { inputs: sessions.screen.inputNames, outputs: sessions.screen.outputNames }
  });
}

  if (type === "INIT") {
    try {
      await initSession("face", e.data.faceModelPath);
      await initSession("screen", e.data.screenModelPath);
      self.postMessage({ type: "INIT_OK", backend });
    } catch (err) {
      self.postMessage({ type: "INIT_FAIL", error: err.message });
    }
  }

  if (typeof self !== "undefined") {
    self.__visionWorkerTestHooks = { classifyScreen, softmax };
  }

  if (type === "DETECT") {
    try {
      const bitmap = await createImageBitmap(e.data.imageData);
      const faces_detected = await runInference(bitmap, bitmap.width, bitmap.height);
      self.postMessage({ type: "DETECT_OK", faces_detected, source: e.data.source });
    } catch (err) {
      self.postMessage({ type: "DETECT_FAIL", error: err.message, source: e.data.source });
    }
  }

  if (type === "ANALYZE_SCREEN") {
    try {
      const start = performance.now();
      const bitmap = await createImageBitmap(e.data.imageData);
      const faces_detected = await runInference(bitmap, bitmap.width, bitmap.height);
      const {
        screen_type,
        confidence,
        confidence_basis,
        predicted_class,
        model_output
      } = await classifyScreen(bitmap);
      const processing_ms = Math.round(performance.now() - start);
      const vision_context = {
        ...mergeVisionContext({
          faces_detected,
          screen_type,
          confidence,
          confidence_basis,
          backend,
          processing_ms
        }),
        predicted_class,
        model_output
      };
      self.postMessage({ type: "ANALYZE_SCREEN_OK", vision_context, source: e.data.source });
    } catch (err) {
      self.postMessage({ type: "ANALYZE_SCREEN_FAIL", error: err.message, source: e.data.source });
    }
  }
};