// Paradee-8M v1.2 (Sahil Mahendrakar, Apache-2.0): a 7.9M-parameter distillation of Kokoro-82M, one 8.5 MB int8 ONNX
// file, about 60x faster than real time on a single CPU thread. One sentence in, one buffer of 24 kHz audio out, in order.
// Text -> eSpeak NG phonemes (the `phonemizer` package) -> misaki spelling -> Kokoro token ids -> ONNX Runtime Web.
import * as ort from "onnxruntime-web/wasm";
import { phonemize } from "phonemizer";
import { toMisaki } from "./misaki";

const REPO = "https://huggingface.co/sahilmahendrakar/Paradee-8M-v1.2/resolve/v1.2";
const VOICES = ["af_heart", "bf_isabella", "am_puck", "bm_fable"]; // the model's own order (config.json)
// The British male voice: the closest of Paradee's four to a JARVIS-style assistant.
const VOICE = "bm_fable";
// Deepens the voice toward JARVIS: the audio plays back at this fraction of its sample rate (pitch drops by the same
// fraction, 0.88 ≈ 2 semitones), and the model speaks 1/DEEPEN faster so the pace stays natural. 1 = the voice as is.
const DEEPEN = 0.88;
const BRITISH = VOICE.startsWith("b");
const MAX_PHONEMES = 510;
const post = (message: unknown, transfer: Transferable[] = []) => self.postMessage(message, { transfer });

// The same runtime build package.json pins, from the CDN the service worker caches for offline use.
ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/dist/";
// Two threads: about 5x faster than real time here, while leaving most cores to SmolVLM, which writes at the same time.
ort.env.wasm.numThreads = 2;

type Engine = { session: ort.InferenceSession; vocab: Record<string, number> };
let loading: Promise<Engine> | null = null;
let queue = Promise.resolve();
let latest = 0; // sentences queued under an older generation were cancelled

/** A model file, from this worker's own Cache Storage when it has it, so the voice works offline after one visit. */
async function cached(url: string) {
  const cache = await caches.open("paradee-v1.2");
  let response = await cache.match(url);
  if (!response) {
    response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    await cache.put(url, response.clone());
  }
  return response;
}

// Kokoro's text front end (kokoro-js), which Paradee's misaki table expects as input: punctuation kept as is,
// everything between it phonemized by eSpeak NG.
// ponytail: only the commonest text normalization (quotes, titles, digit grouping). Port kokoro-js's money, year and
// decimal rules if replies start reading those wrong.
const PUNCTUATION = /(\s*[;:,.!?¡¿—…"«»“”(){}[\]]+\s*)+/g;

async function toPhonemes(text: string) {
  const clean = text
    .replace(/[‘’]/g, "'")
    .replace(/[«»“”]/g, '"')
    .replace(/\bDr\.(?= [A-Z])/g, "Doctor")
    .replace(/\bMr\.(?= [A-Z])/g, "Mister")
    .replace(/\bMrs\.(?= [A-Z])/g, "Missus")
    .replace(/\bMs\.(?= [A-Z])/g, "Miss")
    .replace(/(?<=\d),(?=\d)/g, "")
    .trim();
  const language = BRITISH ? "en" : "en-us";
  const say = async (words: string) => (words.trim() ? (await phonemize(words, language)).join(" ") : words);
  let out = "";
  let at = 0;
  for (const match of clean.matchAll(PUNCTUATION)) {
    out += (await say(clean.slice(at, match.index))) + match[0];
    at = match.index + match[0].length;
  }
  out += await say(clean.slice(at));
  out = out
    .replace(/ʲ/g, "j")
    .replace(/r/g, "ɹ")
    .replace(/x/g, "k")
    .replace(/ɬ/g, "l")
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, " ")
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, "z");
  if (!BRITISH) out = out.replace(/(?<=nˈaɪn)ti(?!ː)/g, "di");
  return toMisaki(out.trim(), BRITISH);
}

async function synthesize({ session, vocab }: Engine, text: string) {
  const ids = [...(await toPhonemes(text))].map((c) => vocab[c]).filter((id) => id !== undefined).slice(0, MAX_PHONEMES);
  const tokens = [0, ...ids, 0];
  const output = await session.run({
    input_ids: new ort.Tensor("int64", BigInt64Array.from(tokens, BigInt), [1, tokens.length]),
    speed: new ort.Tensor("float32", Float32Array.of(1 / DEEPEN), [1]),
    voice: new ort.Tensor("int64", BigInt64Array.of(BigInt(VOICES.indexOf(VOICE))), [1]),
  });
  return output.waveform.data as Float32Array;
}

function load() {
  loading ??= (async () => {
    const [model, config] = await Promise.all([cached(`${REPO}/onnx/paradee_int8.onnx`), cached(`${REPO}/config.json`)]);
    const engine: Engine = {
      session: await ort.InferenceSession.create(new Uint8Array(await model.arrayBuffer()), { executionProviders: ["wasm"] }),
      vocab: (await config.json()).vocab,
    };
    await synthesize(engine, "Ready."); // warm the session before the first real sentence
    post({ type: "ready", device: "wasm" });
    return engine;
  })();
  loading.catch((err: unknown) => {
    loading = null;
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  });
  return loading;
}

self.onmessage = ({ data }: MessageEvent) => {
  if (data.type === "load") void load().catch(() => undefined);
  else if (data.type === "cancel") latest = data.gen;
  else if (data.type === "speak") {
    latest = Math.max(latest, data.gen);
    queue = queue.then(async () => {
      if (data.gen !== latest) return;
      try {
        const engine = await load();
        if (data.gen !== latest) return;
        const samples = await synthesize(engine, data.text);
        post({ type: "audio", gen: data.gen, text: data.text, samples, rate: Math.round(24000 * DEEPEN) }, [samples.buffer]);
      } catch {
        /* one sentence failed to synthesize: skip it and keep the rest of the reply */
      }
    });
  }
};
