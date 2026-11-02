// SmolVLM-256M-Instruct (Q4) on ONNX Runtime Web, off the main thread so the sphere keeps its frame rate.
import {
  AutoModelForVision2Seq,
  AutoProcessor,
  InterruptableStoppingCriteria,
  RawImage,
  TextStreamer,
  type PreTrainedModel,
  type Processor,
  type Tensor,
} from "@huggingface/transformers";

const MODEL = "HuggingFaceTB/SmolVLM-256M-Instruct";
const post = (message: unknown) => self.postMessage(message);
const stopping = new InterruptableStoppingCriteria();

let loading: Promise<{ processor: Processor; model: PreTrainedModel }> | null = null;

function load() {
  loading ??= (async () => {
    // ponytail: CPU (WASM) only. SmolVLM's Q4 decoder produced garbage tokens on WebGPU in Chrome with this
    // onnxruntime-web build, while the same weights are correct on CPU. Retest WebGPU when transformers.js/ORT update.
    const device = "wasm";
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
    const processor = await AutoProcessor.from_pretrained(MODEL, { progress_callback });
    const model = await AutoModelForVision2Seq.from_pretrained(MODEL, {
      device,
      // Q4 weights for the language model and vision encoder. The token-embedding table is a lookup, not a
      // matmul, so its "q4" file is full fp32 (108 MB); q8 is the same table at a quarter of the size.
      dtype: { decoder_model_merged: "q4", vision_encoder: "q4", embed_tokens: "q8" },
      progress_callback,
    });
    post({ type: "ready", device });
    return { processor, model };
  })();
  loading.catch((err: unknown) => {
    loading = null;
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  });
  return loading;
}

type Turn = { role: "system" | "user" | "assistant"; content: string };

async function generate(id: number, turns: Turn[], image?: string, maxNewTokens?: number) {
  const { processor, model } = await load();
  const last = turns.length - 1;
  const chat = turns.map((turn, i) => ({
    role: turn.role,
    content: [...(image && i === last ? [{ type: "image" }] : []), { type: "text", text: turn.content }],
  }));
  const prompt = processor.apply_chat_template(chat as never, { add_generation_prompt: true }) as string;
  // Idefics3Processor needs an image; a text-only turn goes straight to its tokenizer.
  const inputs = image ? await processor(prompt, [await RawImage.fromURL(image)]) : processor.tokenizer!(prompt);
  let tokens = 0;
  let firstAt = 0;
  const started = performance.now();
  const streamer = new TextStreamer(processor.tokenizer!, {
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
    do_sample: false,
    repetition_penalty: 1.15,
    streamer,
    stopping_criteria: stopping,
  })) as Tensor;
  const prompted = (inputs.input_ids as Tensor).dims.at(-1)!;
  const [text] = processor.batch_decode(output.slice(null, [prompted, output.dims.at(-1)!]), { skip_special_tokens: true });
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
    generate(data.id, data.turns, data.image, data.maxNewTokens).catch((err: unknown) =>
      post({ type: "error", id: data.id, message: err instanceof Error ? err.message : String(err) })
    );
};
