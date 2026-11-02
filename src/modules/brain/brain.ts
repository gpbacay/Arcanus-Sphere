// Arcanus's System 1: ARC 1 decides which skill a message needs in milliseconds, with Hippocampus (remembered
// examples) and Occipital (letter-level recall, for typos) voting alongside it. Skills (skills.ts) answer what they
// can without the language model; everything else goes to SmolVLM.
import type { ThoughtStep } from "@/shared/ui/chain-of-thought";
import { Store, IDLE, errorText, type Engine, type LoadState } from "@/shared/store";
import { Hippocampus, load } from "./arcane/web.mjs";
import { Occipital } from "./arcane/occipital.mjs";
import { CHAT, SKILLS } from "./skills";

const TASK = "Decide what the user's message to the assistant Arcanus needs.";
const ROUTES = SKILLS.map((s) => s.route);
const DESCRIPTIONS = Object.fromEntries(SKILLS.map((s) => [s.route, s.description]));
// Below this, ARC 1 + memory aren't sure enough to skip the language model.
const SURE = 0.35;

export interface Plan {
  /** A skill's route, "chat", or "look" for an image. */
  route: string;
  trace: ThoughtStep[];
  /** Set when Arcanus answered without the language model. */
  reply?: string;
  /** Recalled knowledge for the language model. */
  facts?: string[];
}

let router: Promise<Hippocampus> | null = null;

/** Load ARC 1 (5.5 MB, cached by the service worker) and remember every skill's seeds. Safe to call repeatedly. */
function loadRouter() {
  router ??= (async () => {
    const agent = await load({ model: "/arcane/arc1.onnx", config: "/arcane/arc1.json" });
    const memory = new Hippocampus(agent, { occipital: new Occipital() });
    for (const skill of SKILLS) for (const seed of skill.seeds) memory.remember(seed, skill.route);
    return memory;
  })().catch((err: unknown) => {
    router = null;
    throw err;
  });
  return router;
}

const state = new Store<LoadState>(IDLE);

export const brainEngine: Engine = {
  name: "ARC 1",
  detail: "decides · 5.5 MB",
  state,
  start() {
    if (state.state.status !== "idle" && state.state.status !== "error") return;
    state.set({ status: "loading", error: undefined });
    loadRouter().then(
      () => state.set({ status: "ready", device: "wasm" }),
      (err) => state.set({ status: "error", error: errorText(err) })
    );
  },
};

const read = (text: string): ThoughtStep => ({ label: "Read the message", description: text.length > 140 ? `${text.slice(0, 140)}…` : text });

/** Decide what `text` needs. Never throws: if ARC 1 or a skill fails, the message goes to the language model. */
export async function think(text: string, hasImage: boolean): Promise<Plan> {
  if (hasImage) {
    return { route: "look", trace: [read(text), { label: "Image attached", description: "SmolVLM looks at it: no routing needed" }] };
  }
  let decided;
  const t0 = performance.now();
  try {
    decided = await (await loadRouter()).classify(text, ROUTES, { task: TASK, descriptions: DESCRIPTIONS });
  } catch {
    return { route: "chat", trace: [read(text), { label: "ARC 1 unavailable", description: "Sent straight to SmolVLM" }] };
  }
  const ms = Math.round(performance.now() - t0);
  const claim = SKILLS.map((s) => ({ skill: s, why: s.claim?.(text) })).find((c) => c.why);
  const claimed = claim?.skill;
  const why = claim?.why;
  const skill = claimed ??(decided.confidence >= SURE ? SKILLS.find((s) => s.route === decided.label) : undefined) ?? CHAT;
  const voters = decided.neighbors.slice(0, 3);
  const trace: ThoughtStep[] = [
    read(text),
    {
      label: `ARC 1 · ${decided.label ?? "unsure"}`,
      description: `${Math.round(decided.confidence * 100)}% sure · ${ms} ms${
        claimed && decided.label !== skill.route ? ` · ${why}, so ${skill.route}` : !claimed && decided.confidence < SURE ? " · too unsure, so chat" : ""
      }`,
      steps: [
        voters.length
          ? { label: "Hippocampus recalled", description: "Word + Occipital letter match", results: voters.map((n) => `${n.label}: ${n.text}`) }
          : { label: "Hippocampus", description: "Nothing similar remembered" },
      ],
    },
  ];
  let outcome = null;
  try {
    outcome = (await skill.run?.(text)) ?? null;
  } catch (err) {
    trace.push({ label: `The ${skill.route} skill failed`, description: errorText(err) });
  }
  if (!outcome) return { route: "chat", trace };
  trace.push(outcome.step);
  return { route: skill.route, trace, reply: outcome.reply, facts: outcome.facts };
}
