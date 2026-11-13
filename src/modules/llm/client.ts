"use client";

// SmolLM2 runs in its own Web Worker (llm.worker.ts). This is the main-thread side: load state, streaming, stop,
// and a cache of finished replies.
import { Lru } from "@/shared/lru";
import { Store, IDLE, startWorker, type Engine, type LoadState } from "@/shared/store";

export type Turn = { role: "system" | "user" | "assistant"; content: string };
/** `prompted`: the prompt's length in tokens; `reused`: how many of them came from the last reply's KV cache. */
export type Written = { text: string; tokens: number; firstMs: number; perSecond: number; prompted?: number; reused?: number; cached?: boolean };
type Pending = { onToken: (text: string) => void; resolve: (r: Written) => void; reject: (e: Error) => void };

// The two sizes of SmolLM2. Scored by `npm run eval` on the same 26 messages: 135M passed 19 and 360M passed 24,
// the difference being the user's own files (ARCANUS.md, a book's passage) and follow-up questions, which 135M
// gets wrong. In the browser on the dev laptop (i5-1240P) 135M wrote about 5 tokens a second and 360M 1.3, and 360M
// is twice the download. So 135M is what loads unless the larger one is chosen in Settings.
export const MODELS = {
  small: { id: "HuggingFaceTB/SmolLM2-135M-Instruct", label: "SmolLM2-135M", detail: "135M Q4 · on the CPU (~180 MB)" },
  large: { id: "HuggingFaceTB/SmolLM2-360M-Instruct", label: "SmolLM2-360M", detail: "360M Q4 · on the CPU (~390 MB)" },
};
export type ModelSize = keyof typeof MODELS;
const MODEL_KEY = "arcanus_model_v1";

/** The size chosen in Settings: a choice for this device, like the voice. */
export function modelSize(): ModelSize {
  try {
    return localStorage.getItem(MODEL_KEY) === "large" ? "large" : "small";
  } catch {
    return "small"; // storage blocked, or no browser yet
  }
}

/** Choose a size. The page loads again: the model in memory is the one the worker was started with. */
export function setModelSize(size: ModelSize) {
  localStorage.setItem(MODEL_KEY, size);
  location.reload();
}

class Llm {
  state = new Store<LoadState>(IDLE);
  private worker: Promise<Worker> | null = null;
  private pending = new Map<number, Pending>();
  private seq = 0;
  private stopped = 0;
  // Decoding is greedy (do_sample: false), so the same prompt always writes the same reply. A text prompt seen before
  // (a retry, an edit resent unchanged) is answered from here at once instead of running the model again.
  private replies = new Lru<string, Written>(32);
  // The worker writes one thing at a time: a reply asked for while the boot greeting is written waits for it.
  private turn: Promise<unknown> = Promise.resolve();

  start() {
    // Its own worker, started with the sphere, not after it. The render loop never waits on this download.
    this.worker ??= startWorker(this.state, () => new Worker(new URL("./llm.worker.ts", import.meta.url), { type: "module", name: MODELS[modelSize()].id }), (data) => {
      const job = this.pending.get(data.id as number);
      if (!job) return;
      if (data.type === "token") job.onToken(data.text as string);
      else if (data.type === "done") job.resolve(data as never);
      else if (data.type === "error") job.reject(new Error(String(data.message)));
      if (data.type !== "token") this.pending.delete(data.id as number);
    });
    this.worker.catch(() => (this.worker = null));
    return this.worker;
  }

  /** Write a reply, streaming each piece to `onToken`. Rejects when the model can't load: callers degrade from there. */
  async generate(
    turns: Turn[],
    onToken: (text: string) => void,
    opts?: { maxNewTokens?: number; fresh?: boolean; sample?: boolean; prefix?: string },
  ): Promise<Written> {
    const key = opts?.fresh || opts?.sample ? null : JSON.stringify(turns);
    const hit = key ? this.replies.get(key) : undefined;
    if (hit) {
      onToken(hit.text);
      return { ...hit, cached: true };
    }
    const worker = await this.start();
    let id = 0;
    const job = this.turn.then(
      () =>
        new Promise<Written>((resolve, reject) => {
          id = ++this.seq;
          this.pending.set(id, { onToken, resolve, reject });
          worker.postMessage({ type: "generate", id, turns, maxNewTokens: opts?.maxNewTokens, sample: opts?.sample, prefix: opts?.prefix });
        }),
    );
    this.turn = job.catch(() => undefined);
    const written = await job;
    // A stopped reply is cut short: keep only replies that ran to the end.
    if (key && this.stopped < id && written.text) this.replies.set(key, written);
    return written;
  }

  /** Stop what is being written now. */
  stop() {
    this.stopped = this.seq;
    void this.worker?.then((w) => w.postMessage({ type: "stop" }), () => undefined);
  }
}

export const llm = new Llm();

export const llmEngine: Engine = {
  name: "SmolLM2",
  get detail() {
    return MODELS[modelSize()].detail;
  },
  state: llm.state,
  start: () => void llm.start().catch(() => undefined),
};
