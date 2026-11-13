// Run: npm run eval   (after `npm run models`; Node 22.18+ strips the types)
// Scores what SmolLM2 writes. Each case is a message, built into the very prompt the app sends (harness chatTurns)
// and decoded the way llm.worker.ts decodes (greedy, the same repetition penalty), then checked for what a good
// reply must and must not hold. It is a floor, not a grade: a tiny model fails some of these, and the count is what a
// prompt or model change has to beat. Not part of `npm run check`: it needs the model (~180 MB) and a minute.
// `npm run eval -- HuggingFaceTB/SmolLM2-360M-Instruct` scores another model fetched into public/models.
// ponytail: Node's ONNX runtime, not the browser's WASM one. Same weights and decoding; a word may differ.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AutoModelForCausalLM, AutoTokenizer, env, type Tensor } from "@huggingface/transformers";
// eslint-disable-next-line no-restricted-imports -- Node runs this file and can't resolve "@/"; the harness is pure
import { chatTurns, factsBlock, liveTurns, ONLY_ASKED, type ChatTurn } from "../harness/index.ts";
import { earlier, ReplyPenalty } from "./kv.ts";

type Case = {
  ask: string;
  /** Arcanus's own facts, as a skill hands them to the model. */
  facts?: string[];
  history?: ChatTurn[];
  /** The user's ARCANUS.md, or a section of context (a book's passages), as the chat hands them over. */
  standing?: string;
  context?: string;
  /** Said aloud: built by liveTurns and capped like a spoken reply. */
  live?: boolean;
  /** Every one must be in the reply. */
  good: RegExp[];
  bad?: RegExp[];
  /** Words: a story in four words is not a story. */
  min?: number;
  max?: number;
};

const CLOCK = ["The current time is 3:42 PM.", "Today's date is Friday, November 13, 2026.", "The time zone is Asia/Manila."];
const CASES: Case[] = [
  { ask: "hello!", good: [/\b(hello|hi|hey|greetings|good)\b/i], bad: [/Gianne|created/i], max: 40 },
  { ask: "Thanks, that helped", good: [/welcome|glad|happy|pleasure|anytime/i], max: 40 },
  { ask: "Tell me a story about a dragon and a knight.", good: [/dragon/i, /knight/i], min: 25 },
  { ask: "Explain how rain forms, step by step.", good: [/cloud|vapou?r|evaporat|condens/i], min: 15 },
  { ask: "Why is the sky blue?", good: [/light|scatter|sun|atmospher/i], min: 6 },
  { ask: "How do plants grow?", good: [/water|sun|light|soil|seed|root/i], min: 6 },
  { ask: "Write a haiku about the sea", good: [/\b(sea|ocean|waves?|tide|shore)\b/i], max: 45 },
  { ask: "Tell me a joke", good: [/./], min: 5 },
  { ask: "What is the capital of France?", good: [/Paris/] },
  { ask: "What should I cook tonight?", good: [/./], bad: [/\bI will cook\b|\bI can't cook\b|\bI am Arcanus\b/i], min: 5 },
  // Advice and comfort are about the user. A small model told to say "I" starts telling its own made-up life.
  { ask: "What makes a good friend?", good: [/friend|trust|listen|support|kind|honest/i], bad: [/\bI have\b|\bmy (?:deepest|life|own)\b/i], min: 8 },
  { ask: "I'm feeling sad today", good: [/./], bad: [/\bmy friend\b|\bI was\b|\bglad\b/i], min: 5 },
  { ask: "Give me three tips to sleep better.", good: [/sleep|bed|screen|caffeine|routine|dark/i], min: 12 },
  { ask: "Translate thank you into Spanish.", good: [/gracias/i] },
  { ask: "And of Italy?", history: [{ role: "user", content: "What is the capital of France?" }, { role: "assistant", content: "The capital of France is Paris." }], good: [/Rome/] },
  // The user's own files.
  { ask: "What's my name?", standing: "Your user's standing instructions (ARCANUS.md):\nMy name is Sam.\nAnswer in British English.", good: [/Sam/] },
  {
    ask: "What did Ishmael decide to do?",
    context: "From your user's books (moby.txt):\n[moby.txt] Call me Ishmael. Some years ago, having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world.\n\nIf these answer the question, answer from them and name the book.",
    good: [/sail|sea|water/i],
  },
  // Grounded in its own facts: the one that answers, in the first person, and nothing it wasn't asked.
  { ask: "Who made you?", facts: ["Gianne Bacay created me in 2025 to put his AI library, ARCANE, to work."], good: [/Gianne/], bad: [/\bArcanus (is|was)\b/] },
  { ask: "What time is it?", facts: CLOCK, good: [/3:42/], bad: [/November|Manila/] },
  { ask: "What's the date today?", facts: CLOCK, good: [/November 13/], bad: [/3:42/] },
  // Said aloud: a sentence or two.
  { live: true, ask: "why is the sky blue", good: [/light|scatter|sun|atmospher/i], min: 5 },
  { live: true, ask: "what should i cook tonight", good: [/./], bad: [/\bI will cook\b|\bI can't cook\b|\bI am Arcanus\b/i], min: 4 },
  { live: true, ask: "tell me a joke", good: [/./], min: 4 },
  { live: true, ask: "who made you", facts: ["Gianne Bacay created me in 2025 to put his AI library, ARCANE, to work."], good: [/Gianne/] },
  { live: true, ask: "what time is it", facts: CLOCK, good: [/3:42/], bad: [/November|Manila/] },
  { live: true, ask: "what's the date today", facts: CLOCK, good: [/November 13/], bad: [/3:42/] },
];
// What no reply may be: empty, the "I was the one who…" a small model falls into when told to speak as "I", or its
// own instructions said back.
const NEVER = [/^\W*$/, /^I,? (?:was |am )?the one\b/i, /\bleave the rest\b|\bthe user\b|\bdo not (?:assume|invent|introduce|add|use the date)\b|\bno other (?:details|information)\b/i];
// SmolLM2-135M passed 19 of these when this was written (12 with the prompts before it: one long system prompt, and
// an instruction after every message). One less is allowed for another machine's runtime. Raise it when a change beats it.
const FLOOR = 18;
const DEFAULT = "HuggingFaceTB/SmolLM2-135M-Instruct"; // what llm.worker.ts loads

const name = process.argv[2] ?? DEFAULT;
const local = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "public", "models");
if (!existsSync(join(local, name, "onnx", "model_q4.onnx"))) {
  console.error(`${name} is not in public/models. Run: npm run models`);
  process.exit(1);
}
env.localModelPath = `${local}/`;
env.allowRemoteModels = false;
const tokenizer = await AutoTokenizer.from_pretrained(name);
const model = await AutoModelForCausalLM.from_pretrained(name, { dtype: "q4" });

/** The turns the app would send for this case. */
function turnsFor(c: Case): ChatTurn[] {
  // As conversation.ts builds them: buildLive for something said, buildTurns for something typed.
  if (c.live) return liveTurns(c.history ?? [], c.ask, [{ label: "Facts you may use", text: c.facts ? `${c.facts.map((f) => `- ${f}`).join("\n")}\n\n${ONLY_ASKED}` : "", priority: 0 }]).turns;
  const facts = factsBlock(c.facts ?? []);
  return chatTurns([facts && `Facts you may use:\n${facts}`, c.context, c.ask].filter(Boolean).join("\n\n"), { history: c.history, standing: c.standing, grounded: Boolean(c.facts || c.context) });
}

async function write(turns: ChatTurn[], cap = 160) {
  const inputs = tokenizer.apply_chat_template(turns, { add_generation_prompt: true, return_dict: true }) as Record<string, Tensor>;
  const prompted = inputs.input_ids.dims.at(-1)!;
  const started = performance.now();
  const sequences = (await model.generate({
    ...inputs,
    max_new_tokens: cap,
    do_sample: false,
    logits_processor: [new ReplyPenalty(1.15, prompted, earlier(turns, (text) => tokenizer.encode(text, { add_special_tokens: false })))],
  } as never)) as Tensor;
  const written = sequences.dims.at(-1)! - prompted;
  const [text] = tokenizer.batch_decode(sequences.slice(null, [prompted, sequences.dims.at(-1)!]), { skip_special_tokens: true });
  return { text: text.trim(), perSecond: written / ((performance.now() - started) / 1000) };
}

let passed = 0;
let speed = 0;
for (const c of CASES) {
  const { text, perSecond } = await write(turnsFor(c), c.live ? 48 : 160);
  const words = text.split(/\s+/).filter(Boolean).length;
  const why = [
    ...c.good.filter((g) => !g.test(text)).map((g) => `missing ${g}`),
    ...[...NEVER, ...(c.bad ?? [])].filter((b) => b.test(text)).map((b) => `has ${b}`),
    ...(words < (c.min ?? 1) ? [`only ${words} words`] : []),
    ...(words > (c.max ?? Infinity) ? [`${words} words`] : []),
  ];
  passed += Number(!why.length);
  speed += perSecond;
  console.log(`${why.length ? "FAIL" : "ok  "} ${c.live ? "(said) " : ""}${c.ask}\n     ${text.replace(/\s+/g, " ").slice(0, 300)}${why.length ? `\n     -> ${why.join(" · ")}` : ""}`);
}
console.log(`${name}: ${passed}/${CASES.length} replies pass · ${(speed / CASES.length).toFixed(0)} tok/s in Node`);
if (name === DEFAULT) assert.ok(passed >= FLOOR, `reply quality fell below ${FLOOR}/${CASES.length}`);
