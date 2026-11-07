"use client";

// SmolLM2 runs in its own Web Worker (llm.worker.ts). This is the main-thread side: load state, streaming, stop,
// and a cache of finished replies.
import { Lru } from "@/shared/lru";
import { afterGpu } from "@/shared/boot";
import { Store, IDLE, startWorker, type Engine, type LoadState } from "@/shared/store";

export type Turn = { role: "system" | "user" | "assistant"; content: string };
/** `prompted`: the prompt's length in tokens; `reused`: how many of them came from the last reply's KV cache. */
export type Written = { text: string; tokens: number; firstMs: number; perSecond: number; prompted?: number; reused?: number; cached?: boolean };
type Pending = { onToken: (text: string) => void; resolve: (r: Written) => void; reject: (e: Error) => void };

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
    this.worker ??= afterGpu(() => startWorker(this.state, () => new Worker(new URL("./llm.worker.ts", import.meta.url), { type: "module" }), (data) => {
      const job = this.pending.get(data.id as number);
      if (!job) return;
      if (data.type === "token") job.onToken(data.text as string);
      else if (data.type === "done") job.resolve(data as never);
      else if (data.type === "error") job.reject(new Error(String(data.message)));
      if (data.type !== "token") this.pending.delete(data.id as number);
    }));
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
  detail: "360M on WebGPU (~270 MB) · 135M on CPU (~180 MB)",
  state: llm.state,
  start: () => void llm.start().catch(() => undefined),
};
