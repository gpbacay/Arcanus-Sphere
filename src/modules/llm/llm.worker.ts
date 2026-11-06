// SmolLM2-Instruct (Hugging Face, Apache-2.0) on ONNX Runtime Web, off the main thread so the sphere keeps its frame
// rate. Text only. 360M on WebGPU (q4f16, ~270 MB); on the CPU the 135M (q4, ~180 MB), since every parameter there
// costs time. q4, not int8: int8 wrote at about half the speed on the CPU.
import {
  AutoModelForCausalLM,
  AutoTokenizer,
  InterruptableStoppingCriteria,
  TextStreamer,
  type PreTrainedModel,
  type PreTrainedTokenizer,
  type Tensor,
} from "@huggingface/transformers";

const post = (message: unknown) => self.postMessage(message);
const stopping = new InterruptableStoppingCriteria();

let loading: Promise<{ tokenizer: PreTrainedTokenizer; model: PreTrainedModel }> | null = null;

async function hasGpu() {
  try {
    return Boolean(await (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu?.requestAdapter());
  } catch {
    return false;
  }
}

function load() {
  loading ??= (async () => {
    // ponytail: SmolVLM's Q4 decoder once wrote garbage on WebGPU. If SmolLM2 ever does, force "wasm" here.
    const device = (await hasGpu()) ? "webgpu" : "wasm";
    const name = `HuggingFaceTB/SmolLM2-${device === "webgpu" ? "360M" : "135M"}-Instruct`;
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
      dtype: device === "webgpu" ? "q4f16" : "q4",
      progress_callback,
    });
    await model.generate({ ...tokenizer("Hi"), max_new_tokens: 1 }); // compiles the GPU shaders now, not on the first reply
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
  const output = (await model.generate({
    ...inputs,
    max_new_tokens: maxNewTokens || 384,
    do_sample: Boolean(sample),
    // ponytail: sampling is only for the boot greeting. Chat stays greedy, so retries stay cacheable.
    ...(sample ? { temperature: 0.5, top_k: 20 } : {}),
    repetition_penalty: 1.15,
    streamer,
    stopping_criteria: stopping,
    // The generation options (repetition_penalty, one stopping criterion) are real but missing from the types.
  } as never)) as Tensor;
  const prompted = inputs.input_ids.dims.at(-1)!;
  const [text] = tokenizer.batch_decode(output.slice(null, [prompted, output.dims.at(-1)!]), { skip_special_tokens: true });
  // Speed after the first token; the wait before it (reading the prompt) is reported on its own.
  const after = (performance.now() - firstAt) / 1000;
  post({
    type: "done",
    id,
    text: text.trim(),
    tokens,
    firstMs: (firstAt || performance.now()) - started,
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
