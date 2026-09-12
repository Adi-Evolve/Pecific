// extension/workers/vision-worker.js
importScripts('../lib/ort.min.js'); // use the non-webgpu-specific build; execution providers chosen at runtime

let session = null;
let backend = null;

async function initSession(modelPath) {
  for (const ep of ["webgpu", "wasm"]) {
    try {
      if (ep === "webgpu" && !("gpu" in self.navigator)) continue;
      session = await ort.InferenceSession.create(modelPath, { executionProviders: [ep] });
      backend = ep;
      return;
    } catch (e) {
      console.warn(`vision-worker: ${ep} failed`, e);
    }
  }
  throw new Error("vision-worker: no execution provider available");
}

async function preprocessImage(imageBitmap) {
  const canvas = new OffscreenCanvas(128, 128);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(imageBitmap, 0, 0, 128, 128);
  const { data } = ctx.getImageData(0, 0, 128, 128);

  // RGBA -> [0,1] normalized RGB, HWC -> CHW (this model wants 0..1, not -1..1)
  const float32 = new Float32Array(3 * 128 * 128);
  for (let i = 0; i < 128 * 128; i++) {
    float32[i]                 = data[i * 4]     / 255.0; // R
    float32[128 * 128 + i]     = data[i * 4 + 1] / 255.0; // G
    float32[2 * 128 * 128 + i] = data[i * 4 + 2] / 255.0; // B
  }
  return new ort.Tensor("float32", float32, [1, 3, 128, 128]);
}

async function runInference(imageBitmap, origWidth, origHeight) {
  const imageTensor = await preprocessImage(imageBitmap);
  const feeds = {
    image: imageTensor,
    conf_threshold: new ort.Tensor("float32", [0.5], [1]),
    max_detections: new ort.Tensor("int64", [BigInt(25)], [1]),
    iou_threshold: new ort.Tensor("float32", [0.3], [1])
  };
  const results = await session.run(feeds);
  return decodeFaces(results, origWidth, origHeight);
}

function decodeFaces(results, origWidth, origHeight) {
  const outputNames = session.outputNames; // log this once to confirm order: expect [boxes, scores]
  const boxes = results[outputNames[0]].data;   // flat, 16 floats per detection
  const scores = results[outputNames[1]].data;  // 1 float per detection
  const numDetections = scores.length;

  const faces_detected = [];
  for (let i = 0; i < numDetections; i++) {
    const b = boxes.slice(i * 16, i * 16 + 16);
    const [topY, topX, botY, botX] = b; // normalized 0..1, per model card ordering
    const x1 = topX * origWidth, y1 = topY * origHeight;
    const x2 = botX * origWidth, y2 = botY * origHeight;
    if (x2 - x1 < 5 || y2 - y1 < 5) continue; // matches the card's own filter for degenerate boxes
    faces_detected.push({ bbox: [x1, y1, x2, y2], confidence: scores[i] });
  }
  return faces_detected;
}

self.onmessage = async (e) => {
  const { type, modelPath, imageData } = e.data;
  if (type === "INIT") {
    try {
      await initSession(modelPath);
      self.postMessage({ type: "INIT_OK", backend, outputNames: session.outputNames });
    } catch (err) {
      self.postMessage({ type: "INIT_FAIL", error: err.message });
    }
  }
  if (type === "DETECT") {
    try {
      const bitmap = await createImageBitmap(imageData);
      const faces_detected = await runInference(bitmap, bitmap.width, bitmap.height);
      self.postMessage({ type: "DETECT_OK", faces_detected });
    } catch (err) {
      self.postMessage({ type: "DETECT_FAIL", error: err.message });
    }
  }
};