// Silero VAD v5 (snakers4, MIT; 2.2 MB ONNX, in /public/vad so it is cached for offline use): the chance, per 32 ms
// frame, that the frame holds speech. It runs here, off the main thread and apart from Whisper's worker, so a long
// transcription never holds up the next frame's score. One WASM thread: ~1 ms a frame, 3% of one core.
import * as ort from "onnxruntime-web/wasm";

ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/dist/";
ort.env.wasm.numThreads = 1;

const FRAME = 512; // samples at 16 kHz; v5 only accepts this size
const CONTEXT = 64; // the model also wants the last 64 samples of the frame before: without them it scores far less sharply
const post = (message: unknown) => self.postMessage(message);

const input = new Float32Array(CONTEXT + FRAME);
const inputTensor = new ort.Tensor("float32", input, [1, input.length]);
const sr = new ort.Tensor("int64", BigInt64Array.of(16000n), []);
const fresh = () => new ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
let state = fresh();
let sid = -1; // the listening session whose frames the state belongs to

let loading: Promise<ort.InferenceSession> | null = null;
function load() {
  loading ??= (async () => {
    const response = await fetch("/vad/silero_vad.onnx");
    if (!response.ok) throw new Error(`The voice detector didn't load (HTTP ${response.status}).`);
    const session = await ort.InferenceSession.create(new Uint8Array(await response.arrayBuffer()), { executionProviders: ["wasm"] });
    await session.run({ input: inputTensor, state, sr }); // warm up now, not on the first word
    return session;
  })();
  loading.catch(() => (loading = null));
  return loading;
}

let queue: Promise<unknown> = Promise.resolve(); // run() calls share `state`, so one frame at a time, in order

self.onmessage = ({ data }: MessageEvent<{ type: string; sid: number; samples?: Float32Array }>) => {
  if (data.type === "load") {
    queue = queue.then(() => load()).then(() => post({ type: "ready" }), (e: unknown) => post({ type: "error", message: e instanceof Error ? e.message : String(e) }));
  } else if (data.type === "frame" && data.samples?.length === FRAME) {
    const samples = data.samples;
    queue = queue.then(async () => {
      if (data.sid !== sid) {
        sid = data.sid; // a new session starts from silence, not from where the last one left off
        state = fresh();
        input.fill(0);
      }
      try {
        const session = await load();
        input.copyWithin(0, FRAME, FRAME + CONTEXT); // the last 64 samples of the previous frame become the context
        input.set(samples, CONTEXT);
        const out = await session.run({ input: inputTensor, state, sr });
        state = out.stateN as typeof state;
        post({ type: "p", sid: data.sid, p: (out.output.data as Float32Array)[0] });
      } catch {
        post({ type: "p", sid: data.sid, p: -1 }); // -1: no score; the caller falls back to loudness for this frame
      }
    });
  }
};
