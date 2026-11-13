// Arcanus's live Graph of Thought: what it perceives, recalls, decides, writes, checks and says, as it happens, across
// the whole session. The chat's chain of thought explains one reply after the fact; this is the mind running.
// This is the reasoning, and the reply is not in it: a thought says what was done ("Wrote the reply"), and the reply's
// own words belong to the chat and the voice. So the reasoning and the response are two displays, and only the
// response is read aloud.
//
// Thoughts follow ARCANE's Graph of Thought (gpbacay_arcane/got.py): each is a vertex with an id ("t12"), an
// operation and its content, and its `parents` are its edges. ARCANE's operations are used where Arcanus really does
// them: retrieve (a recall or a search), keep_best (Hippocampus's vote keeps the best route), aggregate (many sources
// merged into one context), generate (SmolLM2 writes) and refine (the reply checked against its evidence). wake,
// load, perceive, execute, speak and learn are Arcanus's own.
import { Store } from "@/shared/store";

export type Operation =
  | "wake"
  | "load"
  | "perceive"
  | "retrieve"
  | "keep_best"
  | "aggregate"
  | "generate"
  | "refine"
  | "execute"
  | "speak"
  | "learn";

export type Thought = {
  id: string;
  operation: Operation;
  content: string;
  /** The thoughts this one came from: its edges. */
  parents: string[];
  status: "active" | "complete" | "failed";
  at: number;
  /** How long it took, once settled. */
  ms?: number;
  detail?: string;
  results?: string[];
};

type Patch = Partial<Pick<Thought, "content" | "detail" | "results">>;

const MAX = 300; // ponytail: the oldest thoughts fall off; keep a session log in .arcanus/ if they're ever needed

export const mind = new Store<{ thoughts: Thought[] }>({ thoughts: [] });
let count = 0;

const change = (id: string | null | undefined, patch: (t: Thought) => Partial<Thought>) => {
  if (!id) return;
  mind.set({ thoughts: mind.state.thoughts.map((t) => (t.id === id ? { ...t, ...patch(t) } : t)) });
};

/** Record a thought. `active` keeps it running until settle(). Returns its id, for its children's `parents`. */
export function thought(operation: Operation, content: string, { parents = [], active = false, ...patch }: Patch & { parents?: (string | null | undefined)[]; active?: boolean } = {}) {
  const t: Thought = {
    id: `t${++count}`,
    operation,
    content: content.replace(/\s+/g, " ").trim(),
    parents: parents.filter((p): p is string => !!p),
    status: active ? "active" : "complete",
    at: Date.now(),
    ...patch,
  };
  mind.set({ thoughts: [...mind.state.thoughts, t].slice(-MAX) });
  return t.id;
}

/** Change a running thought as it goes: the words SmolLM2 has written so far. */
export const revise = (id: string | null | undefined, patch: Patch) => change(id, () => patch);

/** Finish a running thought. Settling one twice keeps the first time. */
export const settle = (id: string | null | undefined, patch: Patch & { failed?: boolean } = {}) => {
  const { failed, ...rest } = patch;
  change(id, (t) => (t.status === "active" ? { ...rest, status: failed ? "failed" : "complete", ms: Date.now() - t.at } : rest));
};

/** Settle every running thought but waking and loading: what an interruption (a new message, Stop) cut short. */
export const interrupted = () =>
  mind.state.thoughts.forEach((t) => t.status === "active" && t.operation !== "wake" && t.operation !== "load" && settle(t.id, { detail: [t.detail, "interrupted"].filter(Boolean).join(" · ") }));

export const clearMind = () => mind.set({ thoughts: [] });
