// Arcanus's System 1: ARC 1 decides what a message needs in milliseconds, with Hippocampus (remembered examples)
// and Occipital (letter-level recall, for typos) voting alongside it. Time and math are answered here, without the
// language model; questions about Arcanus get recalled knowledge; everything else goes to SmolVLM.
import type { ThoughtStep } from "@/app/components/chain-of-thought";
import { Hippocampus, load } from "./arcane/web.mjs";
import { Occipital } from "./arcane/occipital.mjs";
import { KNOWLEDGE } from "./knowledge";
import { calculate, findExpression, tellTime } from "./tools";

export const ROUTES = ["chat", "about", "time", "math"] as const;
export type Route = (typeof ROUTES)[number] | "look";

const TASK = "Decide what the user's message to the assistant Arcanus needs.";
const DESCRIPTIONS: Record<(typeof ROUTES)[number], string> = {
  chat: "Conversation, writing, advice, or a general question answered from general knowledge",
  about: "A question about Arcanus itself: who it is, what it can do, its models, voice, sphere, memory or privacy",
  time: "Asks for the current time, date, or day of the week",
  math: "Arithmetic to compute",
};
// Below this, ARC 1 + memory aren't sure enough to skip the language model.
const SURE = 0.35;

// Decided examples. Hippocampus votes with these at every request; add a line to teach a new phrasing, no retraining.
const SEEDS: [string, (typeof ROUTES)[number]][] = [
  ["hi there", "chat"],
  ["good morning, how are you", "chat"],
  ["tell me a joke", "chat"],
  ["write a short poem about the sea", "chat"],
  ["what is the capital of france", "chat"],
  ["explain photosynthesis simply", "chat"],
  ["give me ideas for dinner", "chat"],
  ["how do I center a div in css", "chat"],
  ["who are you", "about"],
  ["what can you do", "about"],
  ["what model do you run on", "about"],
  ["how does your voice work", "about"],
  ["are my messages sent to a server", "about"],
  ["what is the sphere", "about"],
  ["how do you remember things", "about"],
  ["what is arc 1", "about"],
  ["what time is it", "time"],
  ["what's today's date", "time"],
  ["what day is it today", "time"],
  ["current time in Asia/Tokyo", "time"],
  ["what is 12 * 7", "math"],
  ["calculate (3 + 4) * 2", "math"],
  ["what's 144 / 12", "math"],
  ["compute 2^10", "math"],
];

export interface Plan {
  route: Route;
  trace: ThoughtStep[];
  /** Set when Arcanus answered without the language model. */
  reply?: string;
  /** Recalled knowledge for the language model. */
  facts?: string[];
}

let brain: Promise<{ router: Hippocampus; memory: Hippocampus }> | null = null;

/** Load ARC 1 (5.5 MB, cached by the browser) and build both memories. Safe to call repeatedly. */
export function loadBrain() {
  brain ??= (async () => {
    const agent = await load({ model: "/arcane/arc1.onnx", config: "/arcane/arc1.json" });
    const router = new Hippocampus(agent, { occipital: new Occipital() });
    for (const [text, route] of SEEDS) router.remember(text, route);
    const memory = new Hippocampus(null, { k: 2, occipital: new Occipital() });
    for (const note of KNOWLEDGE) memory.remember(`${note.title}. ${note.content}`, note.id);
    return { router, memory };
  })().catch((err: unknown) => {
    brain = null;
    throw err;
  });
  return brain;
}

const read = (text: string): ThoughtStep => ({ label: "Read the message", description: text.length > 140 ? `${text.slice(0, 140)}…` : text });

export async function think(text: string, hasImage: boolean): Promise<Plan> {
  if (hasImage) {
    return { route: "look", trace: [read(text), { label: "Image attached", description: "SmolVLM looks at it: no routing needed" }] };
  }
  let decided;
  const t0 = performance.now();
  try {
    const { router } = await loadBrain();
    decided = await router.classify(text, [...ROUTES], { task: TASK, descriptions: DESCRIPTIONS });
  } catch {
    return { route: "chat", trace: [read(text), { label: "ARC 1 unavailable", description: "Sent straight to SmolVLM" }] };
  }
  const ms = Math.round(performance.now() - t0);
  let route = (decided.confidence >= SURE ? decided.label : "chat") as (typeof ROUTES)[number];
  // Digits and operators share no words with remembered examples, so a bare expression is caught here.
  const expression = findExpression(text);
  const bareMath = expression !== null && text.replace(expression, "").split(/\s+/).filter(Boolean).length <= 2;
  if (bareMath) route = "math";
  const voters = decided.neighbors.slice(0, 3);
  const arc: ThoughtStep = {
    label: `ARC 1 · ${decided.label ?? "unsure"}`,
    description: `${Math.round(decided.confidence * 100)}% sure · ${ms} ms${
      bareMath && decided.label !== "math" ? " · arithmetic spotted, so math" : decided.confidence < SURE ? " · too unsure, so chat" : ""
    }`,
    steps: [
      voters.length
        ? { label: "Hippocampus recalled", description: "Word + Occipital letter match", results: voters.map((n) => `${n.label}: ${n.text}`) }
        : { label: "Hippocampus", description: "Nothing similar remembered" },
    ],
  };
  const trace = [read(text), arc];

  if (route === "math") {
    if (expression) {
      const result = calculate(expression);
      trace.push({ label: "Calculated", description: "Answered without the language model", results: [`${expression} = ${result}`] });
      return { route, trace, reply: result.startsWith("Error") ? result : `${expression} = ${result}` };
    }
    route = "chat";
  }
  if (route === "time") {
    const now = tellTime(text);
    trace.push({ label: "Read the clock", description: "Answered without the language model", results: [now.zone] });
    return { route, trace, reply: `It's ${now.text} (${now.zone}).` };
  }
  if (route === "about") {
    const { memory } = await loadBrain();
    const recalled = memory.neighbors(text);
    const notes = recalled.map((n) => KNOWLEDGE.find((k) => k.id === n.label)).filter((k) => k !== undefined);
    if (notes.length) {
      trace.push({ label: "Recalled from memory", results: notes.map((k) => k.title) });
      return { route, trace, facts: notes.map((k) => k.content) };
    }
  }
  return { route: route === "about" ? "chat" : route, trace };
}
