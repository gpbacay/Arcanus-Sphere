// The model's short-term memory between replies, and a repetition penalty that leaves the facts alone. Pure helpers
// for llm.worker.ts, apart so kv.check.ts can run them in Node.
import { LogitsProcessor, Tensor } from "@huggingface/transformers";

/** The KV cache: one key and one value tensor per layer, [batch, heads, tokens, head size]. */
export type Past = Record<string, Tensor>;

/** How many tokens two prompts start with in common. Capped one short of `next`: the model must read at least one
 *  token of it to have something to answer from. */
export function shared(last: ArrayLike<bigint>, next: ArrayLike<bigint>): number {
  const most = Math.min(last.length, next.length - 1);
  let n = 0;
  while (n < most && last[n] === next[n]) n++;
  return n;
}

/** The cache for the first `n` tokens only. */
export function crop(past: Past, n: number): Past {
  return Object.fromEntries(Object.entries(past).map(([name, t]) => [name, t.slice(null, null, [0, n], null)]));
}

/** The cache moved off the GPU, so it can be cropped and kept between replies without holding GPU memory.
 *  ponytail: a copy each reply (~40 KB a token on the 360M). Keep it on the GPU if that copy ever shows in timings. */
export async function onCpu(past: Past): Promise<Past> {
  const out: Past = {};
  for (const [name, t] of Object.entries(past)) {
    const ort = (t as unknown as { ort_tensor: { location: string; getData(release?: boolean): Promise<Tensor["data"]> } }).ort_tensor;
    out[name] = ort.location === "gpu-buffer" ? new Tensor(t.type, await ort.getData(true), t.dims) : t;
  }
  return out;
}

/**
 * The tokens of Arcanus's earlier replies that neither the system prompt nor the user wrote: what ReplyPenalty
 * holds against copying an old reply, without touching a word of the facts it was given.
 */
export function earlier(turns: { role: string; content: string }[], encode: (text: string) => number[]): Set<bigint> {
  const given = new Set(turns.filter((t) => t.role !== "assistant").flatMap((t) => encode(t.content)));
  return new Set(turns.filter((t) => t.role === "assistant").flatMap((t) => encode(t.content)).filter((id) => !given.has(id)).map(BigInt));
}

/**
 * A repetition penalty on the reply's own tokens and those `earlier()` found, and on nothing else. transformers.js's
 * repetition_penalty counts every token of the prompt, so a name, number or word from the facts the model was given
 * is the one thing it is pushed not to write, and an invented one is not: a nudge toward making things up. Measured
 * on SmolLM2-135M: that penalty answered "331 meters" from "330 metres" and "Burkina Fois"; this one copied both.
 */
export class ReplyPenalty extends LogitsProcessor {
  penalty: number;
  /** Tokens before this index are the prompt. */
  start: number;
  before: Set<bigint>;
  constructor(penalty: number, start: number, before: Set<bigint> = new Set()) {
    super();
    this.penalty = penalty;
    this.start = start;
    this.before = before;
  }
  _call(ids: bigint[][], logits: Tensor) {
    ids.forEach((row, i) => {
      const scores = (logits as unknown as Tensor[])[i].data as Float32Array;
      for (const id of new Set([...this.before, ...row.slice(this.start)])) {
        const t = Number(id);
        scores[t] = scores[t] < 0 ? scores[t] * this.penalty : scores[t] / this.penalty;
      }
    });
    return logits;
  }
}
