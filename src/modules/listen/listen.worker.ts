// Moonshine tiny (Useful Sensors, MIT; ONNX build by onnx-community, ~51 MB) on the CPU, off the main thread. Speech
// in as 16 kHz mono samples, text out. English only. Whisper encodes 30 s of audio whatever you said; Moonshine encodes
// only what it was given, so a short turn costs a short time. Measured on one thread, the same words from both:
// Whisper tiny took 1.9 s for 1.5 s, 3 s or 6 s of speech; Moonshine tiny took 0.19 s, 0.34 s and 0.57 s. That is
// what lets the words be written while you are still talking (client.ts). The CPU, and one WASM thread, so it never
// shares SmolLM2's GPU. The encoder stays full precision: an 8-bit encoder mishears.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import { MODELS_PATH, ORT_PATH } from "@/shared/served";

const MODEL = "onnx-community/moonshine-tiny-ONNX";
const RATE = 16000;
// Moonshine writes about 6.5 tokens for a second of speech. Capped there, noise can't set it repeating itself.
const TOKENS_A_SECOND = 6.5;
const post = (message: unknown) => self.postMessage(message);

let loading: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function load() {
  loading ??= (async () => {
    // The runtime and, when `npm run models` fetched them, the model files come from Arcanus's own server.
    const onnx = env.backends.onnx as { wasm?: { numThreads?: number; wasmPaths?: string } };
    if (onnx.wasm) onnx.wasm.wasmPaths = ORT_PATH;
    env.allowLocalModels = true;
    env.localModelPath = MODELS_PATH;
    if (onnx.wasm) onnx.wasm.numThreads = 1; // leave the other cores to the sphere, Silero, and Paradee
    const files = new Map<string, { loaded: number; total: number }>();
    const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== "progress" || !p.file) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
      let loaded = 0, total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      post({ type: "progress", loaded, total });
    };
    const asr = (await pipeline("automatic-speech-recognition", MODEL, {
      device: "wasm",
      dtype: { encoder_model: "fp32", decoder_model_merged: "q8" },
      progress_callback,
    })) as unknown as AutomaticSpeechRecognitionPipeline;
    await asr(new Float32Array(16000)); // warms the runtime now, not on the first thing you say
    post({ type: "ready", device: "wasm" });
    return asr;
  })();
  loading.catch((err: unknown) => {
    loading = null;
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  });
  return loading;
}

// Speech models write these for silence and noise: "[BLANK_AUDIO]", "(music)", "*sigh*", and a lone "you".
const NOISE = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g;
const HALLUCINATION = /^(?:you\.?|thanks for watching!?|\W*)$/i;

self.onmessage = async ({ data }: MessageEvent<{ type: string; id?: number; samples?: Float32Array }>) => {
  try {
    if (data.type === "load") await load();
    else if (data.type === "transcribe") {
      const asr = await load();
      const out = await asr(data.samples!, { max_new_tokens: Math.max(8, Math.ceil((data.samples!.length / RATE) * TOKENS_A_SECOND)) });
      const text = (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text).replace(NOISE, " ").replace(/\s+/g, " ").trim();
      post({ type: "text", id: data.id, text: HALLUCINATION.test(text) ? "" : text });
    }
  } catch (err) {
    if (data.type === "transcribe") post({ type: "error", id: data.id, message: err instanceof Error ? err.message : String(err) });
  }
};
