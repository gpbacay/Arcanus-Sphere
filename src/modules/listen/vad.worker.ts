// Silero VAD v5 (Silero Team, MIT; public/silero_vad.onnx, 2.3 MB): says how likely each 32 ms of audio is speech.
// Frames of 512 samples at 16 kHz go in, one probability per frame comes out, in order. The model is stateful: it
// carries a hidden state and the last 64 samples of the previous frame, so a frame is judged in its context.
import * as ort from "onnxruntime-web/wasm";

// The same runtime build package.json pins, from the CDN the service worker caches for offline use.
ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/dist/";
ort.env.wasm.numThreads = 1; // a tiny model: one thread leaves the cores to Whisper and SmolVLM

const FRAME = 512;
const CONTEXT = 64;
const post = (message: unknown) => self.postMessage(message);

let session: Promise<ort.InferenceSession> | null = null;
let state: ort.Tensor = new ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
let context = new Float32Array(CONTEXT);
let queue = Promise.resolve(); // frames must run in order: each one's state feeds the next
const sr = new ort.Tensor("int64", BigInt64Array.from([16000n]), []);

let model = "";
const load = () => (session ??= ort.InferenceSession.create(model));

self.onmessage = ({ data }: MessageEvent<{ type: string; model?: string; i?: number; samples?: Float32Array }>) => {
  if (data.type === "load") {
    model = data.model!; // an absolute URL: a bundled worker lives at a blob: address, where "/x" means nothing
    load().then(
      () => post({ type: "ready" }),
      (err: unknown) => {
        session = null;
        post({ type: "error", message: err instanceof Error ? err.message : String(err) });
      },
    );
  } else if (data.type === "reset") {
    queue = queue.then(() => {
      state = new ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
      context = new Float32Array(CONTEXT);
    });
  } else if (data.type === "frame") {
    const { i, samples } = data;
    queue = queue.then(async () => {
      const input = new Float32Array(CONTEXT + FRAME);
      input.set(context);
      input.set(samples!, CONTEXT);
      context = samples!.slice(FRAME - CONTEXT);
      const out = await (await load()).run({ input: new ort.Tensor("float32", input, [1, input.length]), state, sr });
      state = out.stateN;
      post({ type: "prob", i, p: out.output.data[0] as number });
    });
  }
};
