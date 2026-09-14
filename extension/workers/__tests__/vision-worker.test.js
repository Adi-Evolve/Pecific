import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import ort from '../../lib/ort/ort.bundle.min.mjs';

const root = new URL('../../..', import.meta.url);
const workerSource = await fs.readFile(new URL('../vision-worker.js', import.meta.url), 'utf8');
const posted = [];
const ortDist = fileURLToPath(new URL('../../lib/ort/', import.meta.url));
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = { mjs: path.join(ortDist, 'ort-wasm-simd-threaded.mjs') };
ort.env.wasm.wasmBinary = await fs.readFile(path.join(ortDist, 'ort-wasm-simd-threaded.wasm'));
const originalCreate = ort.InferenceSession.create;
ort.InferenceSession.create = async (modelPath, options) => {
  const modelBytes = await fs.readFile(modelPath);
  return originalCreate.call(ort.InferenceSession, modelBytes, options);
};
const context = vm.createContext({
  console,
  performance,
  Float32Array,
  Uint8ClampedArray,
  Uint8Array,
  ArrayBuffer,
  navigator: {},
  self: {
    location: { href: 'file:///extension/workers/vision-worker.js' },
    navigator: {},
    postMessage: (message) => posted.push(message)
  },
  importScripts: () => {},
  OffscreenCanvas: class {
    getContext() {
      return {
        drawImage() {},
        getImageData() { return { data: new Uint8ClampedArray(256 * 256 * 4) }; }
      };
    }
  },
  ort,
  createImageBitmap: async (blob) => ({ width: blob.width, height: blob.height })
});
vm.runInContext(workerSource, context);

const faceImage = await fs.readFile(new URL('../../../extension/fixtures/images/sample_face_page.jpg', import.meta.url));
const cleanImage = await fs.readFile(new URL('../../../extension/fixtures/images/sample_no_face_page.jpg', import.meta.url));
const faceModel = fileURLToPath(new URL('../../../extension/workers/models/blazeface.onnx', import.meta.url));
const screenModel = fileURLToPath(new URL('../../../extension/workers/models/mobilevit_xxs.onnx', import.meta.url));

await context.self.onmessage({ data: {
  type: 'INIT',
  faceModelPath: faceModel,
  screenModelPath: screenModel
}});
if (posted.at(-1)?.type !== 'INIT_OK') throw new Error(`model initialization failed: ${JSON.stringify(posted.at(-1))}`);

for (const [name, bytes] of [['face fixture', faceImage], ['clean fixture', cleanImage]]) {
  const blob = { width: 1280, height: 720, bytes };
  await context.self.onmessage({ data: { type: 'ANALYZE_SCREEN', imageData: blob, source: name } });
  const result = posted.at(-1);
  if (result.type !== 'ANALYZE_SCREEN_OK') throw new Error(`${name} inference failed: ${result.error}`);
  if (!/^model_class_[0-9]+$/.test(result.vision_context.screen_type)) {
    throw new Error(`${name} returned an ungrounded screen type`);
  }
  if (result.vision_context.backend !== 'wasm') throw new Error(`${name} did not report its backend`);
  console.log(`  PASS ${name}: ${result.vision_context.screen_type}`);
}
console.log('Vision worker inference tests passed');
