// Kokoro-82M (hexgrad) on ONNX Runtime Web. One sentence in, one buffer of 24 kHz audio out, in order.
import { KokoroTTS } from "kokoro-js";

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICE = "af_heart";
const post = (message: unknown, transfer: Transferable[] = []) => self.postMessage(message, { transfer });

let loading: Promise<KokoroTTS> | null = null;
let queue = Promise.resolve();
let latest = 0; // sentences queued under an older generation were cancelled

function load() {
  const files = new Map<string, { loaded: number; total: number }>();
  loading ??= KokoroTTS.from_pretrained(MODEL, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (p) => {
      if (p.status !== "progress") return;
      files.set(p.file, { loaded: p.loaded, total: p.total });
      let loaded = 0, total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      post({ type: "progress", loaded, total });
    },
  });
  loading
    // Speak once into nothing: kokoro-js downloads (and caches) the voice on first use, so this makes the voice
    // available offline and warms the session before the first real sentence.
    .then((tts) => tts.generate("Ready.", { voice: VOICE }))
    .then(
    () => post({ type: "ready", device: "wasm" }),
    (err: unknown) => {
      loading = null;
      post({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  );
  return loading;
}

self.onmessage = ({ data }: MessageEvent) => {
  if (data.type === "load") void load();
  else if (data.type === "cancel") latest = data.gen;
  else if (data.type === "speak") {
    latest = Math.max(latest, data.gen);
    queue = queue.then(async () => {
      if (data.gen !== latest) return;
      try {
        const tts = await load();
        if (data.gen !== latest) return;
        const audio = await tts.generate(data.text, { voice: VOICE });
        const samples = audio.audio as Float32Array;
        post({ type: "audio", gen: data.gen, text: data.text, samples, rate: audio.sampling_rate }, [samples.buffer]);
      } catch {
        /* one sentence failed to synthesize: skip it and keep the rest of the reply */
      }
    });
  }
};
