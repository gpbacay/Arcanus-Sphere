// Arcanus's System 1. Hippocampus (remembered phrasings) with Occipital (letter-level recall, for typos) decides which
// skill a message needs, in well under a millisecond (routes.ts). Skills (skills.ts) answer what they can without the
// language model, with ARC 1 reading their arguments (arc1.ts, loaded on first use); everything else
// goes to SmolLM2.
//
// Hippocampus learns as it is used: from claims (a link, a sum: certain, so worth remembering how they were worded)
// and from /teach, a correction. What it learned is kept in .arcanus/routing.json, which you can read and edit.
import type { ThoughtStep } from "@/shared/ui/chain-of-thought";
import { Store, IDLE, errorText, type Engine, type LoadState } from "@/shared/store";
import { HOME, readFile, writeFile } from "@/modules/workspace";
import { Hippocampus, type Example } from "./arcane/hippocampus.mjs";
import { Occipital } from "./arcane/occipital.mjs";
import { decide, routerMemory } from "./routes";
import { CHAT, SKILLS, selfNotes } from "./skills";

export interface Plan {
  /** A skill's route, or "chat". */
  route: string;
  trace: ThoughtStep[];
  /** Set when Arcanus answered without the language model. */
  reply?: string;
  /** Recalled knowledge for the language model. */
  facts?: string[];
  /** Where `facts` came from, when not Arcanus's own notes. */
  source?: string;
}

const LEARNED = `${HOME}/routing.json`;
const norm = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
const SEEDS = new Set(SKILLS.flatMap((s) => s.seeds.map(norm)));

let router: Promise<Hippocampus> | null = null;

/** What Hippocampus learned before, from .arcanus/routing.json. Never waits long on the workspace, never throws. */
async function learned(): Promise<Example[]> {
  try {
    const text = await Promise.race([readFile(LEARNED), new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500))]);
    const data: unknown = JSON.parse(text ?? "[]");
    return Array.isArray(data) ? data.filter((e): e is Example => typeof e?.text === "string" && typeof e?.label === "string") : [];
  } catch {
    return [];
  }
}

/** The router memory: every skill's seeds and what it learned. Built once; it needs no model. */
function loadRouter() {
  router ??= learned().then((examples) => routerMemory(SKILLS, examples));
  return router;
}

/** Keep what Hippocampus learned (not the seeds, which live in routes.ts) in .arcanus/routing.json. */
async function save(memory: Hippocampus) {
  const kept = memory.toJSON().filter((e) => !SEEDS.has(norm(e.text)));
  await writeFile(LEARNED, `${JSON.stringify(kept, null, 2)}\n`).catch(() => undefined);
}

/** Teach Hippocampus that `text` needed `route`: a correction, kept for good. Returns false for an unknown route. */
export async function teach(text: string, route: string) {
  if (!SKILLS.some((s) => s.route === route)) return false;
  const memory = await loadRouter();
  memory.remember(text, route);
  await save(memory);
  return true;
}

/** The routes /teach accepts. */
export const routeNames = () => SKILLS.map((s) => s.route);

const state = new Store<LoadState>(IDLE);

// The boot log shows Hippocampus: it decides every message and needs no model. ARC 1 (5.5 MB) only reads arguments
// (a city, an MCP tool's fields), so it loads the first time a message needs it rather than at every boot.
export const brainEngine: Engine = {
  name: "Hippocampus",
  detail: "decides what a message needs",
  state,
  start() {
    if (state.state.status !== "idle" && state.state.status !== "error") return;
    state.set({ status: "loading", error: undefined });
    loadRouter().then(
      () => state.set({ status: "ready" }),
      (err) => state.set({ status: "error", error: errorText(err) })
    );
  },
};

const read = (text: string): ThoughtStep => ({ label: "Read the message", description: text.length > 140 ? `${text.slice(0, 140)}…` : text });

/** Decide what `text` needs. Never throws: if a skill fails, the message goes to the language model. */
export async function think(text: string): Promise<Plan> {
  const t0 = performance.now();
  const memory = await loadRouter();
  const decided = await decide(memory, text, SKILLS);
  const ms = Math.max(0, Math.round(performance.now() - t0));
  const skill = SKILLS.find((s) => s.route === decided.route) ?? CHAT;
  // A claim is certain: remember how it was worded, so similar requests are routed without one. Not math: its claims
  // are bare expressions, whose only words are numbers, and numbers would vote math for any message holding them.
  if (decided.claimed && decided.route !== "math") void memory.observe(text, decided.route).then((id) => (id ? save(memory) : undefined), () => undefined);
  const voters = decided.neighbors.slice(0, 3);
  const why = decided.claimed
    ? ` · ${decided.claimed}, so ${decided.route}`
    : decided.label && decided.route !== decided.label
      ? " · too unsure, so chat"
      : !decided.label
        ? " · nothing similar, so chat"
        : "";
  const trace: ThoughtStep[] = [
    read(text),
    {
      label: `Hippocampus · ${decided.route}`,
      description: `${Math.round(decided.confidence * 100)}% of the vote · ${ms} ms${why}`,
      steps: [
        voters.length
          ? { label: "Remembered phrasings voted", description: "Word + Occipital letter match", results: voters.map((n) => `${n.label}: ${n.text}`) }
          : { label: "Nothing similar remembered", description: "/teach <route> after a reply teaches it" },
      ],
    },
  ];
  let outcome = null;
  try {
    outcome = (await skill.run?.(text)) ?? null;
  } catch (err) {
    trace.push({ label: `The ${skill.route} skill failed`, description: errorText(err) });
  }
  if (outcome) {
    trace.push(outcome.step);
    return { route: skill.route, trace, reply: outcome.reply, facts: outcome.facts, source: outcome.source };
  }
  // Answered as chat. A question about Arcanus that missed the "about" route is still grounded in its own notes, so
  // the model answers from them instead of inventing a self.
  if (decided.aboutSelf || skill.route === "about") {
    const notes = selfNotes(text);
    trace.push({ label: "About Arcanus: grounded in its notes", results: notes.map((k) => k.title) });
    return { route: "chat", trace, facts: notes.map((k) => k.content) };
  }
  return { route: "chat", trace };
}

let notes: { key: string; memory: Hippocampus } | null = null;

/** The `k` notes most like `text`, by words and letters (Hippocampus + Occipital). Nothing when none share a word. */
export function recallNotes<T extends { id: string; text: string }>(text: string, all: T[], k = 2): T[] {
  const key = JSON.stringify(all);
  if (notes?.key !== key) {
    const memory = new Hippocampus(null, { k, occipital: new Occipital() });
    for (const note of all) memory.remember(note.text, note.id);
    notes = { key, memory };
  }
  return notes.memory.neighbors(text).flatMap((n) => all.filter((note) => note.id === n.label));
}
