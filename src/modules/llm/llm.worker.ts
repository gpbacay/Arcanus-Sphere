// SmolLM2-Instruct Q4 (Hugging Face, Apache-2.0) on ONNX Runtime Web, off the main thread so the sphere keeps its
// frame rate. Text only, on the CPU: 135M (~180 MB), or 360M (~390 MB) when chosen in Settings; client.ts names the
// one to load as this worker's name. q4, not int8: int8 wrote at about half the speed.
import {
  AutoModelForCausalLM,
  AutoTokenizer,
  env,
  InterruptableStoppingCriteria,
  TextStreamer,
  type PreTrainedModel,
  type PreTrainedTokenizer,
  type Tensor,
} from "@huggingface/transformers";
import { MODELS_PATH, ORT_PATH } from "@/shared/served";
import { crop, earlier, onCpu, ReplyPenalty, shared, type Past } from "./kv";

const post = (message: unknown) => self.postMessage(message);
const stopping = new InterruptableStoppingCriteria();

// The last prompt and reply, and the model's KV cache for them. The next prompt starts the same way (the system
// prompt, then the conversation so far), so the model reads only from where it differs: the first word comes sooner.
let memory: { ids: BigInt64Array; past: Past } | null = null;
const MIN_REUSE = 16; // tokens; under this, cropping costs about what it saves

let loading: Promise<{ tokenizer: PreTrainedTokenizer; model: PreTrainedModel }> | null = null;

function load() {
  loading ??= (async () => {
    const cores = navigator.hardwareConcurrency || 2;
    // This worker loads and runs the model on several threads at once. Two cores stay out of that pool: one for the
    // sphere's render loop, one for the voice worker, so those keep going while the weights come in.
    // The runtime and, when `npm run models` fetched them, the model files come from Arcanus's own server.
    const onnx = env.backends.onnx as { wasm?: { numThreads?: number; wasmPaths?: string } };
    if (onnx.wasm) onnx.wasm.wasmPaths = ORT_PATH;
    env.allowLocalModels = true;
    env.localModelPath = MODELS_PATH;
    if (onnx.wasm) onnx.wasm.numThreads = Math.max(1, Math.min(4, cores - 2));
    const device = "wasm";
    const name = self.name || "HuggingFaceTB/SmolLM2-135M-Instruct";
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
    const tokenizer = await AutoTokenizer.from_pretrained(name, { progress_callback });
    const model = await AutoModelForCausalLM.from_pretrained(name, {
      device,
      dtype: "q4",
      progress_callback,
    });
    await model.generate({ ...tokenizer("Hi"), max_new_tokens: 1 }); // warms the runtime now, not on the first reply
    post({ type: "ready", device });
    return { tokenizer, model };
  })();
  loading.catch((err: unknown) => {
    loading = null;
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  });
  return loading;
}

type Turn = { role: "system" | "user" | "assistant"; content: string };

/** `prefix`: the reply starts with these words already written, and the model only finishes it (the boot greeting
 *  starts "Good morning, I'm Arcanus", so a small model can't forget its own name). Not part of the returned text. */
async function generate(id: number, turns: Turn[], maxNewTokens?: number, sample?: boolean, prefix?: string) {
  const { tokenizer, model } = await load();
  const inputs = (
    prefix
      ? tokenizer(tokenizer.apply_chat_template(turns, { add_generation_prompt: true, tokenize: false }) + prefix, { add_special_tokens: false })
      : tokenizer.apply_chat_template(turns, { add_generation_prompt: true, return_dict: true })
  ) as Record<string, Tensor>;
  let tokens = 0;
  let firstAt = 0;
  const started = performance.now();
  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text: string) => post({ type: "token", id, text }),
    token_callback_function: () => {
      if (!tokens++) firstAt = performance.now();
    },
  });
  stopping.reset();
  const ids = inputs.input_ids.data as BigInt64Array;
  const reuse = memory ? shared(memory.ids, ids) : 0;
  const past = memory && reuse >= MIN_REUSE ? crop(memory.past, reuse) : undefined;
  memory = null;
  const output = (await model.generate({
    ...inputs,
    past_key_values: past,
    return_dict_in_generate: true,
    max_new_tokens: maxNewTokens || 384,
    do_sample: Boolean(sample),
    // ponytail: sampling is only for the boot greeting. Chat stays greedy, so retries stay cacheable.
    ...(sample ? { temperature: 0.5, top_k: 20 } : {}),
    logits_processor: [new ReplyPenalty(1.15, ids.length, earlier(turns, (text) => tokenizer.encode(text, { add_special_tokens: false })))],
    streamer,
    stopping_criteria: stopping,
    // The generation options (one stopping criterion, the cache) are real but missing from the types.
  } as never)) as { sequences: Tensor; past_key_values: Past };
  const { sequences } = output;
  const kept = await onCpu(output.past_key_values);
  const cached = Object.values(kept)[0]?.dims.at(-2) ?? 0;
  memory = { ids: (sequences.data as BigInt64Array).slice(0, cached), past: kept };
  const prompted = inputs.input_ids.dims.at(-1)!;
  const [text] = tokenizer.batch_decode(sequences.slice(null, [prompted, sequences.dims.at(-1)!]), { skip_special_tokens: true });
  // Speed after the first token; the wait before it (reading the prompt) is reported on its own.
  const after = (performance.now() - firstAt) / 1000;
  post({
    type: "done",
    id,
    text: text.trim(),
    tokens,
    firstMs: (firstAt || performance.now()) - started,
    reused: past ? reuse : 0,
    prompted,
    perSecond: tokens > 1 ? (tokens - 1) / Math.max(after, 0.001) : 0,
  });
}

self.onmessage = ({ data }: MessageEvent) => {
  if (data.type === "load") void load();
  else if (data.type === "stop") stopping.interrupt();
  else if (data.type === "generate")
    generate(data.id, data.turns, data.maxNewTokens, data.sample, data.prefix).catch((err: unknown) =>
      post({ type: "error", id: data.id, message: err instanceof Error ? err.message : String(err) })
    );
};
