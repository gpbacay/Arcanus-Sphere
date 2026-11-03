// Whisper base.en (OpenAI, MIT; ONNX build by onnx-community) on ONNX Runtime Web, off the main thread. Speech in as
// 16 kHz mono samples, text out. English only. The encoder stays full precision: an 8-bit Whisper encoder mishears
// badly and often returns nothing. On the GPU when there is one (SmolVLM keeps to the CPU), else on the CPU.
import { pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

const MODEL = "onnx-community/whisper-base.en";
const post = (message: unknown) => self.postMessage(message);

let loading: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

async function hasGpu() {
  try {
    return Boolean(await (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu?.requestAdapter());
  } catch {
    return false;
  }
}

function load() {
  loading ??= (async () => {
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
    const device = (await hasGpu()) ? "webgpu" : "wasm";
    const asr = (await pipeline("automatic-speech-recognition", MODEL, {
      device,
      dtype: { encoder_model: "fp32", decoder_model_merged: device === "webgpu" ? "q4" : "q8" },
      progress_callback,
    })) as unknown as AutomaticSpeechRecognitionPipeline;
    await asr(new Float32Array(16000)); // compiles the GPU shaders now, not on the first thing you say
    post({ type: "ready", device });
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
