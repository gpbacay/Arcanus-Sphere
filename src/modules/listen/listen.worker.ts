// Whisper tiny.en (OpenAI, MIT; ONNX build by onnx-community) on ONNX Runtime Web, off the main thread. Speech in as
// 16 kHz mono samples, text out. English only, about 41 MB at 8-bit.
// ponytail: tiny.en for the small download. Swap MODEL for "onnx-community/whisper-base.en" (~80 MB) if it mishears.
import { pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

const MODEL = "onnx-community/whisper-tiny.en";
const post = (message: unknown) => self.postMessage(message);

let loading: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

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
    // CPU (WASM): like SmolVLM, which leaves the GPU alone. Whisper tiny is quick enough there.
    const asr = (await pipeline("automatic-speech-recognition", MODEL, { dtype: "q8", device: "wasm", progress_callback })) as unknown as AutomaticSpeechRecognitionPipeline;
    post({ type: "ready", device: "wasm" });
    return asr;
  })();
  loading.catch((err: unknown) => {
    loading = null;
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  });
  return loading;
}

// Whisper writes these for silence and noise: "[BLANK_AUDIO]", "(music)", "*sigh*".
const NOISE = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g;

self.onmessage = async ({ data }: MessageEvent<{ type: string; id?: number; samples?: Float32Array }>) => {
  try {
    if (data.type === "load") await load();
    else if (data.type === "transcribe") {
      const asr = await load();
      const out = await asr(data.samples!, { chunk_length_s: 30, stride_length_s: 5 });
      const text = (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text).replace(NOISE, " ").replace(/\s+/g, " ").trim();
      post({ type: "text", id: data.id, text });
    }
  } catch (err) {
    if (data.type === "transcribe") post({ type: "error", id: data.id, message: err instanceof Error ? err.message : String(err) });
  }
};
