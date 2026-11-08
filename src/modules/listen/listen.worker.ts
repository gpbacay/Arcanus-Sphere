// Whisper tiny.en (OpenAI, MIT; ONNX build by onnx-community) on the CPU, off the main thread. Speech in as
// 16 kHz mono samples, text out. English only. The CPU, and one WASM thread, so it never shares SmolLM2's GPU:
// that compile is what froze the tab when live voice turned on. The encoder stays full precision: an 8-bit encoder mishears.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

const MODEL = "onnx-community/whisper-tiny.en";
const post = (message: unknown) => self.postMessage(message);

let loading: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function load() {
  loading ??= (async () => {
    const wasm = (env.backends.onnx as { wasm?: { numThreads?: number } }).wasm;
    if (wasm) wasm.numThreads = 1; // leave the other cores to the sphere, Silero, and Paradee
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

// Whisper writes these for silence and noise: "[BLANK_AUDIO]", "(music)", "*sigh*", and a lone "you".
const NOISE = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g;
const HALLUCINATION = /^(?:you\.?|thanks for watching!?|\W*)$/i;

self.onmessage = async ({ data }: MessageEvent<{ type: string; id?: number; samples?: Float32Array }>) => {
  try {
    if (data.type === "load") await load();
    else if (data.type === "transcribe") {
      const asr = await load();
      const out = await asr(data.samples!);
      const text = (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text).replace(NOISE, " ").replace(/\s+/g, " ").trim();
      post({ type: "text", id: data.id, text: HALLUCINATION.test(text) ? "" : text });
    }
  } catch (err) {
    if (data.type === "transcribe") post({ type: "error", id: data.id, message: err instanceof Error ? err.message : String(err) });
  }
};
