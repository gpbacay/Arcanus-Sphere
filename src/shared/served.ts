// Where Arcanus's own server keeps what the models need, so nothing is fetched from another service at run time.
// Whole addresses, not paths: ONNX Runtime and Transformers.js both refuse a bare "/ort/…" ("Invalid URL"), and a
// worker has no page to resolve one against. `location` is the page's in a window and the script's in a worker;
// both are this server.
const origin = globalThis.location?.origin ?? "";

/** ONNX Runtime Web's .wasm files, copied out of node_modules by scripts/copy-ort.mjs after every install. The folder
 *  is named for the version, so the service worker's cached copy can never be an old runtime under a new build.
 *  Keep it in step with onnxruntime-web in package.json: a mismatch is a 404 at boot, not a silent wrong runtime. */
export const ORT_PATH = `${origin}/ort/1.22.0-dev.20250409-89f8206ba4/`;

/** Model files fetched by `npm run models` (scripts/fetch-models.mjs), laid out as <repo>/<file>. When a file is not
 *  there, the model is downloaded from Hugging Face instead, as it always was. */
export const MODELS_PATH = `${origin}/models/`;
