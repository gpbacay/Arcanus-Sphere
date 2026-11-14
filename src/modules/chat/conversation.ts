// Answering a message: brain decides, the language model writes, the voice speaks, each sentence as it is written.
// The user's message and a "thinking" reply appear the moment they send (optimistic); tokens stream into a store of
// their own, so only the reply being written re-renders. When a model is missing, Arcanus answers what it still can.
import { asksForFact, grounding, lookupQuery, recallNotes, recallPassages, routeNames, teach, think, type Plan } from "@/modules/brain";
import { account } from "@/modules/account";
import { addressed, answersCall, asSelf, assemble, keepPronouns, keepYears, CALL_TURNS, chatTurns, factsBlock, greeting, liveTurns, ONLY_ASKED, slug } from "@/modules/harness";
import { listen } from "@/modules/listen";
import { llm, modelSize, MODELS, type Turn } from "@/modules/llm";
import { interrupted, revise, settle, thought, type Operation } from "@/modules/mind";
import { go, SEARCH } from "@/modules/web";
import { isEcho, spokenLine, takeSentences, voice, wholeSentences } from "@/modules/voice";
import { FILE_COMMANDS, HOME, createSkill, fileCommand, guardrails, instructions, linkedNotes, memories, plainLinks, remember, saveArtifact, workspace, type Skill } from "@/modules/workspace";
import { chatLine, openArtifact, openPane, pane } from "@/shared/pane";
import { power, setPower } from "@/shared/power";
import { stageShown, whenShown } from "@/shared/stage";
import { Store, bootInTurn, engineSettled, errorText, useStore, type Engine } from "@/shared/store";
import type { ThoughtStep } from "@/shared/ui/chain-of-thought";
import { MAX, chatStore, currentChat, newChat, push, remove, select, write, type Msg, type Removal } from "./store";

export type Live = { chatId: string; trace: ThoughtStep[]; text: string; /** When the reply began: "Thought 17s" is counted from here. */ begun?: number };

/** The reply being written right now, if any. */
export const live = new Store<{ reply: Live | null }>({ reply: null });
export const useBusy = () => useStore(live, (s) => s.reply !== null);
// While Arcanus is switched off it takes nothing in: the same "no" as while a reply is being written.
const busy = () => live.state.reply !== null || !power.state.on;

// Spoken turns (talk()) are kept short and light: every token the model reads or writes is time before and between words.
const VOICE_TOKENS = 48; // a sentence or two. The first clause is spoken as soon as it is written, so the cap only bounds the end.
const NO_MODEL =
  "My language model couldn't load on this device, so I can't write that reply right now. I can still tell the time, do math and answer questions about myself. Try again once SmolLM2 shows ready.";

let gen = 0;
/** Set by talk() around send(): the message about to be answered was spoken, not typed. */
let viaVoice = false;

// ------------------------------------------------------------------ context
// What the model reads besides the message, most important first, fitted into a character budget (harness assemble):
// the skill being run and the facts a skill found, then ARCANUS.md, then the page or file you handed Arcanus, then
// recalled memory notes. SmolLM2 has 8k tokens of context, but on WebAssembly every token it reads costs time
// before the first word, so the budget stays far below that. Older turns are cut short for the same reason.
// ponytail: characters, not tokens (about 4 to 1 in English). Count tokens if the budget ever needs to be exact.
const BUDGET = 3200;
const HISTORY = 6;
const HISTORY_CHARS = 600;

type Report = ReturnType<typeof assemble>["report"];
/** The last reply's context, for /context. */
let lastContext: { report: Report; used: number; budget: number } | null = null;
/** What a reply is written from: the model's turns, the evidence it should rest on (for the grounding check), and
 *  the Graph of Thought's aggregate thought, which the writing grows from. */
type Built = { turns: Turn[]; step: ThoughtStep | null; evidence: string[]; context: string };

/** The message as the model should read it: a skill's command name taken off. */
const ask = (user: Msg, skill?: Skill) => (skill ? user.text.replace(/^\/\S+\s*/, "") || skill.description : user.text);

/** A reply that is the biography and nothing else. Left in the history, the model copies it onto the next question. */
const recited = (m: Msg) =>
  m.role === "assistant" &&
  ((/^I am Arcanus, a local AI assistant created by Gianne Bacay\b/.test(m.text) && m.text.length < 800) ||
    /^Gianne Bacay created me\b/.test(m.text) ||
    /^I,\s/.test(m.text));

const STANDING = "Your user's standing instructions (ARCANUS.md)";
const GUARD = "Guardrails you must never break (guardrails/rules.md)";

/** The conversation itself: not commands, and not the boot greeting. A reply that only recited the biography is dropped too, or the next reply copies it. */
const conversed = (prior: Msg[]) => prior.filter((m) => !m.kind && m.text && !recited(m));

/**
 * What a spoken reply is written from (harness liveTurns): the conversation so far, then, with the message itself,
 * the notes Hippocampus and Occipital recall for it and what Arcanus knows about itself when the question is about
 * that. Small, and laid out so SmolLM2 reads only the new turn. `from` is the thought the context is built for.
 */
async function buildLive(prior: Msg[], user: Msg, plan: Plan, from: string): Promise<Built> {
  const [notes, guard] = await Promise.all([memories().catch(() => []), guardrails().catch(() => "")]);
  const recalled = recallNotes(user.text, notes);
  const own = plan.facts?.length && !plan.source ? plan.facts : [];
  const ownBlock = own.length ? `${own.map((f) => `- ${f}`).join("\n")}\n\n${ONLY_ASKED}` : "";
  const { turns, report, used, budget } = liveTurns(
    conversed(prior).map((m): Turn => ({ role: m.role, content: m.text })),
    user.text,
    [
      { label: GUARD, text: guard, priority: 0 }, // with the message, not the system prompt, so the KV cache holds
      { label: "Facts you may use", text: ownBlock, priority: 0 },
      { label: "Notes you remembered", text: recalled.map((n) => `- ${n.text}`).join("\n"), priority: 1 },
    ],
  );
  lastContext = { report, used, budget };
  const description = `${turns.length - 2} earlier turns · ${used.toLocaleString()} of ${budget.toLocaleString()} characters of notes`;
  const results = report.map(reportLine);
  const source = recalled.length ? thought("retrieve", `Recalled ${recalled.length} of your notes`, { parents: [from], results: recalled.map((n) => n.id) }) : null;
  const context = thought("aggregate", "Gathered what SmolLM2 will read", { parents: [from, source], detail: description, results });
  // Only its own facts are evidence: a recalled note may have nothing to do with the question.
  return { turns, step: { label: "Context", description, results }, evidence: own, context };
}

/** What a typed reply is written from. `from` is the thought the context is built for. */
async function buildTurns(prior: Msg[], user: Msg, plan: Plan, skill: Skill | undefined, from: string): Promise<Built> {
  const text = ask(user, skill);
  // The user's books, for plain chat only: a skill, Arcanus's own facts or the web already say what to answer from.
  const [guard, rules, notes, passages] = await Promise.all([
    guardrails().catch(() => ""),
    instructions().catch(() => ""),
    memories().catch(() => []),
    !skill && plan.route === "chat" && !plan.facts ? recallPassages(text).catch(() => []) : [],
  ]);
  const pinned = pane.state.pinned;
  const recalled = recallNotes(text, notes);
  // What the notes being read link to ([[links]]), and what links to them: a subject split over small files is read whole.
  const reading = [...(pinned && !pinned.href ? [pinned.label] : []), ...recalled.map((n) => `${HOME}/memory/${n.id}`)];
  const linked = reading.length ? await linkedNotes(reading).catch(() => []) : [];
  const sources = [
    passages.length ? thought("retrieve", `Found ${passages.length} passages in your books`, { parents: [from], results: [...new Set(passages.map((p) => p.book))] }) : null,
    recalled.length ? thought("retrieve", `Recalled ${recalled.length} of your notes`, { parents: [from], results: recalled.map((n) => n.id) }) : null,
    pinned ? thought("retrieve", "Reading what you're showing me", { parents: [from], results: [pinned.label] }) : null,
    linked.length ? thought("retrieve", `Followed [[links]] to ${linked.length} notes`, { parents: [from], results: linked.map((n) => n.path) }) : null,
  ];
  const facts = factsBlock(plan.facts ?? [], plan.source);
  const { sections, report, used } = assemble(
    [
      { label: GUARD, text: guard, priority: 0 },
      { label: STANDING, text: rules, priority: 1 },
      { label: `Instructions for the /${skill?.name} skill`, text: skill?.body ?? "", priority: 0 },
      { label: plan.source ?? "Facts you may use", text: facts, priority: 0 },
      { label: `What the user is showing you: ${pinned?.label}`, text: plainLinks(pinned?.text ?? ""), priority: 2 },
      {
        label: `From your user's books (${[...new Set(passages.map((p) => p.book))].join(", ")})`,
        text: passages.length ? `${passages.map((p) => `[${p.book}] ${p.text}`).join("\n\n")}\n\nIf these answer the question, answer from them and name the book.` : "",
        priority: 2,
      },
      { label: "Notes you remembered", text: recalled.map((n) => `- ${n.text}`).join("\n"), priority: 3 },
      { label: "Linked notes", text: linked.map((n) => `[${n.path.split("/").pop()}]\n${n.text.trim()}`).join("\n\n"), priority: 4 },
    ],
    BUDGET
  );
  lastContext = { report, used, budget: BUDGET };
  // Your guardrails, then ARCANUS.md, ride with the system prompt; the rest goes with the message.
  const standing = sections.filter((s) => s.label === GUARD || s.label === STANDING);
  const quote = user.replyToId ? prior.find((m) => m.id === user.replyToId) : undefined;
  const content = [
    ...sections.filter((s) => !standing.includes(s)).map((s) => `${s.label}:\n${s.text}`),
    quote ? `About this earlier message: "${quote.text.slice(0, 300)}"` : "",
    text,
  ]
    .filter(Boolean)
    .join("\n\n");
  const history = conversed(prior)
    .slice(-HISTORY)
    .map((m): Turn => ({ role: m.role, content: m.text.length > HISTORY_CHARS ? `${m.text.slice(0, HISTORY_CHARS)}…` : m.text }));
  const step: ThoughtStep | null = report.length
    ? { label: "Context", description: `${used.toLocaleString()} of ${BUDGET.toLocaleString()} characters`, results: report.map(reportLine) }
    : null;
  const context = thought("aggregate", "Gathered what SmolLM2 will read", {
    parents: [from, ...sources],
    detail: `${used.toLocaleString()} of ${BUDGET.toLocaleString()} characters`,
    results: report.map(reportLine),
  });
  const evidence = [...(plan.facts ?? []), ...passages.map((p) => p.text), ...(pinned ? [pinned.text] : [])];
  return { turns: chatTurns(content, { history, standing: standing.map((s) => `${s.label}:\n${s.text}`).join("\n\n") || undefined, grounded: sections.some((s) => !standing.includes(s)) || Boolean(quote) }), step, evidence, context };
}

function reportLine(r: Report[number]) {
  const name =
    r.label === STANDING
      ? "ARCANUS.md"
      : r.label === GUARD
        ? "guardrails/rules.md"
      : r.label.startsWith("Notes")
        ? "memory"
        : r.label.startsWith("What the user")
          ? r.label.replace(/^.*?: /, "")
          : r.label.replace(/^Instructions for the /, "");
  return `${name.slice(0, 48)} · ${r.chars === r.of ? r.chars : r.chars ? `${r.chars} of ${r.of}, cut` : "left out"}`;
}

const sayAll = (text: string) => takeSentences(`${text}\n`).sentences.forEach((s) => voice.say(s));
const warmAll = (text: string) => takeSentences(`${text}\n`).sentences.forEach((s) => voice.warm(s));
const lastRole = (messages: Msg[], role: Msg["role"]) => messages.findLastIndex((m) => m.role === role);

// ------------------------------------------------------------------ boot

let engines: Engine[] = [];

/** The boot message whose models are still loading, and their steps as they stand. */
export const booting = new Store<{ id: string | null; steps: ThoughtStep[] }>({ id: null, steps: [] });

/** One model as a step of the boot log: its size as the description, its state as the chip. */
function engineStep({ name, detail, later, state: { state: s } }: Engine): ThoughtStep {
  const pct = s.total ? Math.min(100, Math.round((s.loaded / s.total) * 100)) : 0;
  if (s.off) return { label: name, description: detail, status: "pending", results: ["off"] };
  if (s.status === "ready") return { label: name, description: detail, results: [s.device === "webgpu" ? "WebGPU" : "ready"] };
  if (s.status === "loading") return { label: name, description: detail, status: "active", results: [s.total ? `${pct}%` : "starting"] };
  if (s.status === "error") return { label: name, description: `${detail} · ${s.error ?? "failed"} · /run retries`, results: ["failed"] };
  if (later) return { label: name, description: detail, status: "pending", results: ["when you talk"] };
  return { label: name, description: detail, status: "pending", results: ["waiting"] };
}
const engineSteps = () => engines.map(engineStep);
const settled = () => engines.every(engineSettled);

let unwatch: (() => void) | null = null;

/** Keep the boot message's log live until every model settles, then write it into the message. */
function watchBoot(chatId: string, id: string) {
  // The Graph of Thought: waking is a root, each model loading a branch of it.
  wakeId = thought("wake", "Waking up", { active: true, detail: `${engines.length} engines` });
  const loads = new Map(engines.map((e) => [e, thought("load", e.name, { parents: [wakeId], active: true, detail: e.detail })]));
  const settleLoads = (stopped = false) => {
    for (const [e, t] of loads) {
      const s = e.state.state;
      const done = engineSettled(e);
      if (!done && !stopped) continue;
      settle(t, {
        failed: s.status === "error",
        detail: s.off ? "off" : s.status === "error" ? s.error : e.later && s.status === "idle" ? "when you talk" : !done ? "boot stopped" : s.device === "webgpu" ? "ready · WebGPU" : "ready",
      });
      loads.delete(e);
    }
  };
  const save = () => {
    settleLoads(true);
    settle(wakeId, { content: "Awake" });
    offs.forEach((off) => off());
    unwatch = null;
    booting.set({ id: null, steps: [] });
    const trace = engineSteps();
    write(chatId, (chat) => ({ ...chat, messages: chat.messages.map((m) => (m.id === id ? { ...m, trace } : m)) }));
  };
  const update = () => {
    settleLoads();
    if (settled()) save();
    else booting.set({ id, steps: engineSteps() });
  };
  const offs = engines.map((engine) => engine.state.subscribe(update));
  unwatch = save;
  update();
}

// ------------------------------------------------------------------ the Graph of Thought (modules/mind)

/** This boot's root thought. */
let wakeId: string | null = null;
/** What the mic just heard, as a thought: the root of the reply to it. */
let heard: string | null = null;

/**
 * A speak thought for Paradee's voice, under `parent`. It runs until the reply is done (the returned end()) and the
 * voice has gone quiet, so a pause between two sentences doesn't end it.
 */
function voiced(parent: string | null, text = "Speaking the reply") {
  if (voice.state.state.off) return () => undefined;
  if (!voice.state.state.analyser) {
    thought("speak", text, { parents: [parent], detail: "waiting for a tap to unlock audio" });
    return () => undefined;
  }
  const id = thought("speak", text, { parents: [parent], active: true, detail: "Paradee-8M" });
  let ended = false;
  let started = false; // the first sentence takes a moment to synthesize: quiet before it is not the end
  const check = () => {
    const { speaking, status } = voice.state.state;
    started ||= speaking || status === "error";
    if (!ended || speaking || !started) return;
    off();
    settle(id);
  };
  const off = voice.state.subscribe(check);
  return () => {
    ended = true;
    check();
  };
}

/** The operation a step of the brain's trace stands for in the Graph of Thought. */
const operationOf = (label: string): Operation => (/recall|search|read a web|grounded|notes/i.test(label) ? "retrieve" : "execute");

let listening = false;
/** This boot's greeting, until it is spoken: its words, and the thought it was composed as. */
let pending: { line: string; said: string } | null = null;
/** Stops waiting for the stage to appear. */
let unstage: (() => void) | null = null;

/**
 * Speak the boot greeting once it can be heard and seen: the browser has let audio play (a tap unlocked it), and the
 * stage is on screen (the sphere's first frame, or AR's camera). The voice is ready long before the scene is, so
 * without the second it spoke over a blank page. Whichever of the two comes last calls this again.
 */
function speakGreeting() {
  const greeting = pending;
  if (!greeting || !power.state.on || voice.state.state.off || !stageShown() || !voice.state.state.analyser) return;
  silence();
  sayAll(greeting.line);
  voiced(greeting.said, "Speaking the greeting")();
}

function onPointer() {
  voice.unlock();
  speakGreeting();
}

function watchGesture() {
  if (listening || voice.state.state.off) return;
  listening = true;
  window.addEventListener("pointerdown", onPointer);
}

/** Nothing is waiting any more: no tap, no stage, no greeting. */
function silence() {
  pending = null;
  unstage?.();
  unstage = null;
  if (!listening) return;
  listening = false;
  window.removeEventListener("pointerdown", onPointer);
}

/** Stop the greeting waiting to be spoken. */
const stopGreeting = silence;

/** Stop a boot in progress: its log is written as it stands, and the greeting is no longer waiting to be spoken. */
export function cancelGreet() {
  stopGreeting();
  unwatch?.();
}

/**
 * Boot: post Arcanus's boot message, its trace the models loading, live until they settle. A boot right after another
 * replaces it, so reloads don't stack them. The greeting is there at once: it waits for no model. It is spoken as
 * the page appears (speakGreeting): not before the sphere is drawn, and not until the browser has let audio play.
 */
export function greet(list = engines) {
  engines = list;
  const chat = currentChat();
  if (!power.state.on || !chat) return;
  unwatch?.();
  stopGreeting();
  const when = moment();
  const name = account.state.user?.name;
  const line = greeting({ when, name, last: lastTopic(chat.id) });
  const intro: Msg = { id: crypto.randomUUID(), role: "assistant", text: line, at: Date.now(), kind: "boot" };
  write(chat.id, (c) => ({ ...c, messages: [...(c.messages.at(-1)?.kind === "boot" ? c.messages.slice(0, -1) : c.messages), intro] }));
  watchBoot(chat.id, intro.id);
  // The Graph of Thought: what the greeting rests on, then the greeting, then the voice.
  const known = thought("retrieve", "Who you are, and when it is", { parents: [wakeId], detail: "what the greeting is made from", results: [...(name ? [name] : []), when] });
  const said = thought("generate", "Composed the greeting", { parents: [known], detail: "from those facts · no language model, so no wait" });
  if (voice.state.state.off) return;
  pending = { line, said };
  warmAll(line); // written now, while the page loads, so it is spoken the moment the page appears
  // Without a tap the browser plays nothing: the greeting waits for one, and the Graph of Thought says so.
  if (!voice.state.state.analyser) {
    thought("speak", "Speaking the greeting", { parents: [said], detail: "waiting for a tap to unlock audio" });
    watchGesture();
  }
  unstage = whenShown(speakGreeting);
}

/** The most recent other chat the user actually wrote in: its title, and when it last moved. */
function lastTopic(exceptId: string) {
  let best: { title: string; at: number } | undefined;
  for (const c of chatStore.state.chats) {
    const at = c.messages.at(-1)?.at ?? 0;
    if (c.id !== exceptId && c.title !== "Untitled" && c.messages.some((m) => m.role === "user" && !m.kind) && at > (best?.at ?? 0)) best = { title: c.title, at };
  }
  return best;
}

/** "Friday evening": when this boot is, in words the greeting can use. */
function moment() {
  const now = new Date();
  const hour = now.getHours();
  return `${now.toLocaleDateString([], { weekday: "long" })} ${hour < 5 ? "night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}`;
}

async function answer(chatId: string, prior: Msg[], user: Msg, skill = agentOf(chatId)) {
  stopGreeting();
  interrupted(); // whatever was still running belonged to the reply this one replaces
  const spoken = viaVoice;
  viaVoice = false;
  const mine = ++gen;
  const stale = () => mine !== gen;
  const begun = Date.now();
  const show = (trace: ThoughtStep[], text = "") => !stale() && live.set({ reply: { chatId, trace, text, begun } });
  const finish = (text: string, trace: ThoughtStep[]) => {
    if (stale()) return;
    push(chatId, { id: crypto.randomUUID(), role: "assistant", text, at: Date.now(), trace, ms: Date.now() - begun });
    live.set({ reply: null });
  };
  voice.cancel();
  write(chatId, (chat) => ({
    ...chat,
    title: chat.title === "Untitled" && !prior.some((m) => m.role === "user") ? user.text.replace(/\s+/g, " ").trim().slice(0, 40) : chat.title,
    messages: [...prior, user],
  }));
  show([
    { label: "Read the message", description: user.text },
    { label: "Hippocampus", description: "Deciding what this needs", status: "active" },
  ]);
  // The Graph of Thought: the message is the root; every thought of this reply grows from it.
  const root = heard ?? thought("perceive", user.text, { detail: "read from the chat" });
  heard = null;
  const decision = skill
    ? thought("execute", `Running /${skill.name}`, { parents: [root], detail: skill.path })
    : thought("keep_best", "Hippocampus is deciding what this needs", { parents: [root], active: true });

  let trace: ThoughtStep[] = [];
  try {
    // Called by name: "hey Arcanus" alone is answered as a call (answerCall); with more ("Arcanus, what time is it?")
    // the name is taken off, so Hippocampus routes what was asked, not a question about Arcanus.
    const call = skill ? null : addressed(user.text);
    if (call?.called && !call.rest) {
      const line = await answerCall(chatId, user, decision, stale);
      if (stale()) return;
      if (line) {
        sayAll(line.text);
        voiced(line.said)();
        finish(line.text, line.trace);
        return;
      }
    }
    const plan: Plan = skill
      ? { route: "skill", trace: [{ label: "Read the message", description: user.text }, { label: `Skill · /${skill.name}`, description: skill.path }] }
      : await think(call?.rest || user.text);
    trace = plan.trace;
    if (!skill) {
      const [, decided, ...rest] = plan.trace;
      settle(decision, { content: `Hippocampus chose ${plan.route}`, detail: decided?.description, results: decided?.steps?.[0]?.results?.slice(0, 3) });
      for (const step of rest) thought(operationOf(step.label), step.label, { parents: [decision], detail: step.description, results: step.results?.slice(0, 4) });
    }
    if (stale()) return;
    if (plan.reply) {
      const said = thought("generate", "Wrote the reply", { parents: [decision], detail: "answered without the language model" });
      sayAll(plan.reply);
      voiced(said)();
      finish(plan.reply, trace);
      return;
    }
    // Fact lookup stays in the books you added. The web is only the web skill (search / look up / a link / go to).
    if (!skill && plan.route === "chat" && !plan.facts?.length && asksForFact(user.text)) {
      const earlier = prior.findLast((m) => m.role === "user" && m.text && !m.kind)?.text ?? "";
      const query = lookupQuery(user.text, earlier);
      const passages = await recallPassages(query).catch(() => []);
      if (stale()) return;
      if (passages[0]) {
        const line = `${spokenLine(passages[0].text)} (${passages[0].book})`;
        const said = thought("generate", "Quoted a passage from your books", { parents: [decision], detail: passages[0].book });
        sayAll(line);
        voiced(said)();
        finish(line, [...trace, { label: "From your books", description: passages[0].book }]);
        return;
      }
      // Books missed: let the language model answer. Do not scrape the internet as a default knowledge base.
    }
    // A tool or a web result is spoken as it is. SmolLM2 rewrites those into something else, so it is not called.
    // A note about Arcanus, including who made it, is written by SmolLM2.
    if (!skill && plan.source && plan.facts?.length) {
      const line = spokenLine(plan.facts[0]);
      const said = thought("generate", "Spoke the result as it is", { parents: [decision], detail: "not rewritten by the language model" });
      sayAll(line);
      voiced(said)();
      finish(line, [...trace, { label: plan.source ?? "ARC 1", description: plan.source ? "Answered from the result, not rewritten" : "Spoke the note that answers it" }]);
      return;
    }

    // An open question in live voice is the only time SmolLM2 is called, and only for a sentence or two, from a
    // context built so it reads almost nothing new (buildLive).
    const liveCall = spoken && !skill;
    const built = liveCall ? await buildLive(prior, user, plan, decision) : await buildTurns(prior, user, plan, skill, decision);
    if (stale()) return;
    if (built.step) trace = [...trace, built.step];
    const writing = (description: string): ThoughtStep => ({ label: liveCall ? "SmolLM2 · spoken" : "SmolLM2", description, status: "active" });
    const ready = llm.state.state.status === "ready";
    show([...trace, writing(ready ? "Writing on this device" : "Waiting for the model to load on this device")]);
    const generating = thought("generate", "Writing the reply", {
      parents: [built.context],
      active: true,
      detail: ready ? "SmolLM2 is writing" : "waiting for SmolLM2 to load",
    });
    // A reply grounded in its own notes is about itself, so it is said by itself (asSelf), whatever the model slipped into.
    // Every reply with facts keeps their years and pronouns: "2015" and "she" from notes that say 2025 and he are put back.
    const strict = Boolean(plan.facts?.length && !plan.source);
    const own = (s: string) => keepPronouns(keepYears(strict ? asSelf(s) : s, built.evidence), built.evidence);
    // About itself, a sentence after the first that its notes don't back is the model inventing a life ("I was trained
    // for two years before she left"): it is not said, and the reply ends there.
    let strayed = false;
    const strays = (line: string) => strict && said.length > 0 && (strayed || grounding(line, built.evidence).unsupported.length > 0);
    let speaking: (() => void) | null = null;
    let shown = "";
    let unspoken = "";
    let spoke = false;
    const said: string[] = []; // every piece handed to the voice, in order
    let result;
    try {
      result = await llm.generate(
        built.turns,
        (piece) => {
          if (stale() || strayed) return;
          // Until the first words are spoken, a clause ending in a comma is enough to start: the voice begins sooner.
          shown += piece;
          const { sentences, rest } = takeSentences(unspoken + piece, spoke ? 80 : 24);
          unspoken = rest;
          spoke ||= sentences.length > 0;
          for (const s of sentences) {
            const line = own(s);
            if (strays(line)) {
              strayed = true;
              llm.stop();
              break;
            }
            said.push(line);
            voice.say(line);
          }
          if (sentences.length) speaking ??= voiced(generating);
          show([...trace, writing("Writing on this device")], strayed ? said.join(" ") : own(shown));
        },
        { maxNewTokens: spoken ? VOICE_TOKENS : undefined }
      );
    } catch (err) {
      settle(generating, { failed: true, detail: errorText(err) });
      // Without SmolLM2, recalled notes are still an answer; anything else gets an honest "not now".
      // Arcanus's own notes are short enough to read out; a web page or search results are not.
      const notes = plan.source ? undefined : plan.facts?.join(" ");
      sayAll(notes ?? NO_MODEL);
      finish(notes ?? NO_MODEL, [
        ...trace,
        { label: "SmolLM2 unavailable", description: errorText(err) },
        ...(notes ? [{ label: "Answered from memory", description: "The recalled notes, read as they are" }] : []),
      ]);
      return;
    }
    if (stale()) return;
    // A spoken reply that hit its token cap ends mid-sentence: don't say, or keep, the broken end.
    const cutOff = spoken && result.tokens >= VOICE_TOKENS;
    if (unspoken.trim() && !cutOff && !strayed) {
      if (strays(own(unspoken))) strayed = true;
      else {
        said.push(own(unspoken));
        voice.say(own(unspoken));
        speaking ??= voiced(generating);
      }
    }
    speaking?.();
    const device = llm.state.state.device === "webgpu" ? "WebGPU" : "WebAssembly";
    const written = own(result.text || shown.trim() || "…");
    // Cut off at the cap, or where it strayed from its notes: keep exactly what was spoken (a clause may have been
    // said past the last full stop).
    // A reply cut after a clause ("I am online,") ends on a full stop, not the comma.
    let text = cutOff || strayed ? said.join(" ").replace(/[\s,;:–—-]+$/, ".") || wholeSentences(written) : written;
    const wrote = result.cached
      ? { label: "Recalled an earlier reply", description: "Same prompt as before, and SmolLM2 writes the same words for it, so it didn't run again" }
      : {
          label: `${MODELS[modelSize()].label} wrote this`,
          description: `First word in ${(result.firstMs / 1000).toFixed(1)} s${result.reused ? ` (read ${result.prompted! - result.reused} new of ${result.prompted} tokens)` : ""} · ${result.tokens} tokens at ${result.perSecond.toFixed(1)} tok/s · ${device}`,
        };
    const grounded = built.evidence.length ? grounding(text, built.evidence) : null;
    if (grounded && grounded.score < 0.5) {
      // The model's words were already being spoken: stop them and say the replacement, so the chat and the voice agree.
      text = spokenLine(built.evidence[0]);
      voice.cancel();
      sayAll(text);
      voiced(generating, "Speaking the corrected reply")();
    }
    settle(generating, { content: "Wrote the reply", detail: result.cached ? "an earlier reply, recalled" : wrote.description });
    const checked = grounded
      ? {
          label: `Checked against its sources: ${Math.round(grounded.score * 100)}% grounded`,
          description: `${grounded.supported} of ${grounded.sentences} sentences backed by the evidence`,
          results: grounded.unsupported.slice(0, 3).map((u) => `not in the sources: ${u.slice(0, 70)}`),
        }
      : null;
    if (checked) thought("refine", checked.label, { parents: [generating, built.context], detail: checked.description, results: checked.results });
    finish(text, [
      ...trace,
      wrote,
      ...(checked ? [checked] : []),
      ...(strayed ? [{ label: "Stopped where it strayed", description: "The next sentence wasn't in my notes, so it wasn't said" }] : []),
      ...(voice.state.state.off ? [] : [{ label: "Paradee-8M spoke it", description: "Sentence by sentence, as it was written" }]),
    ]);
  } catch (err) {
    // Whatever broke, the reply ends here, so Arcanus is never left stuck thinking.
    interrupted();
    thought("execute", "Something failed", { parents: [root], detail: errorText(err) });
    finish("That didn't run. Try it once more.", [...trace, { label: "Something failed", description: errorText(err) }]);
  }
}

/**
 * Answer a bare call of my name, in SmolLM2's own words: it is asked what the call means (harness CALL_TURNS), with
 * sampling on so the answer isn't the same every time, and a draft that doesn't say I'm here is written again.
 * Null (it fell through to an ordinary reply) when no draft answers the call, or the model can't write now.
 */
async function answerCall(chatId: string, user: Msg, decision: string, stale: () => boolean) {
  settle(decision, { content: "Heard my name", detail: "a call for my attention, not a question" });
  const trace: ThoughtStep[] = [
    { label: "Read the message", description: user.text },
    { label: "Called by name", description: 'A call for attention, read as "Are you there? Are you listening?"' },
  ];
  live.set({ reply: { ...live.state.reply, chatId, trace: [...trace, { label: "SmolLM2", description: "Writing on this device", status: "active" }], text: "" } });
  const said = thought("generate", "Answering my name", { parents: [decision], active: true, detail: "SmolLM2, sampled" });
  const drafts: string[] = [];
  try {
    // ponytail: up to 4 drafts. Measured: 12 of 12 calls were answered within 3.
    for (let i = 0; i < 4; i++) {
      const written = await llm.generate(CALL_TURNS, () => undefined, { maxNewTokens: 16, sample: true });
      if (stale()) return null;
      const text = answersCall(written.text);
      if (text) {
        settle(said, { content: "Answered my name", detail: drafts.length ? `${drafts.length + 1} drafts` : "first draft" });
        return { text, said, trace: [...trace, { label: `${MODELS[modelSize()].label} wrote this`, description: `Sampled, so the words differ from call to call${drafts.length ? ` · ${drafts.length} drafts set aside` : ""}` }] };
      }
      drafts.push(written.text);
    }
  } catch (err) {
    drafts.push(errorText(err));
  }
  settle(said, { failed: true, detail: "no draft said I'm here · answered as a message", results: drafts.slice(0, 3).map((d) => d.slice(0, 60)) });
  return null;
}

// ------------------------------------------------------------------ agents
// Every conversation is an agent. One with a role (AGENTS.md) answers as that role, with SKILL.md's brief before it;
// one without is Arcanus itself. /agents <task> makes a conversation per role and runs them in order, each handed the
// work of the one before, then reports back in the conversation that asked.

/** The agent a conversation is, as a skill: its role's instructions after the brief every agent reads. */
function agentOf(chatId: string): Skill | undefined {
  const name = chatStore.state.chats.find((c) => c.id === chatId)?.role;
  const role = name ? workspace.state.agents.find((a) => a.name === name) : undefined;
  return role && { ...role, body: [workspace.state.brief, role.body].filter(Boolean).join("\n\n") };
}

/** How much of an agent's work the next one is handed: a message stays well inside the model's context budget. */
const HANDOFF = 1200;
const roleTitle = (role: string, task: string) => `${role[0].toUpperCase()}${role.slice(1)} · ${task}`.replace(/\s+/g, " ").slice(0, 40);

function roster() {
  const { agents } = workspace.state;
  const working = chatStore.state.chats.filter((c) => c.role);
  return [
    agents.length
      ? `Roles in ${HOME}/AGENTS.md. /agents <task> puts them to work in this order, /role <name> makes this conversation one:\n${agents.map((a) => `${a.name.padEnd(10)} ${a.description}`).join("\n")}`
      : `There are no roles in ${HOME}/AGENTS.md. Add a "## name" section for each.`,
    working.length ? `Agents:\n${working.map((c) => `${c.title} (${c.role}${agents.some((a) => a.name === c.role) ? "" : ", not in AGENTS.md"})`).join("\n")}` : "No conversation has a role yet.",
  ].join("\n\n");
}

/**
 * Put every role in AGENTS.md to work on `task`: a new conversation each, opened while it works, each handed the task
 * and the work of the agent before it. Returns the report for the conversation that asked. A message or /stop sent
 * while they work ends the run there.
 * ponytail: one language model on this device, so the agents take turns. A model per worker would let them run at once.
 */
async function orchestrate(fromId: string, task: string) {
  const team = workspace.state.agents;
  if (!team.length) return roster();
  const quiet = voice.state.state.off;
  voice.state.set({ off: true }); // their work is read, not heard: saying a plan and its code aloud takes longer than writing it
  const done: { role: string; title: string; text: string }[] = [];
  try {
    for (const role of team) {
      const title = roleTitle(role.name, task);
      const id = newChat(title, role.name);
      const handed = done.at(-1);
      const text = `Task: ${task}${handed ? `\n\nFrom the ${handed.role}:\n${handed.text.slice(0, HANDOFF)}` : ""}`.slice(0, MAX);
      const turn = gen;
      await answer(id, [], { id: crypto.randomUUID(), role: "user", text, at: Date.now() });
      if (gen !== turn + 1) break; // something else was answered, or stopped, in the meantime
      const reply = chatStore.state.chats.find((c) => c.id === id)?.messages.findLast((m) => m.role === "assistant");
      done.push({ role: role.name, title, text: reply?.text ?? "" });
    }
  } finally {
    voice.state.set({ off: quiet });
    if (chatStore.state.chats.some((c) => c.id === fromId)) select(fromId);
  }
  const report = done.map((d) => `${d.title}\n${d.text.replace(/\s+/g, " ").slice(0, 240)}`).join("\n\n");
  const last = done.at(-1);
  return [
    `${done.length} of ${team.length} agents worked on "${task}", one conversation each${done.length < team.length ? " (stopped early)" : ""}:`,
    report,
    last ? `The ${last.role} handed back:\n${last.text}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function stop() {
  const reply = live.state.reply;
  gen++;
  llm.stop();
  voice.cancel();
  interrupted();
  live.set({ reply: null });
  if (!reply) return;
  const partial = reply.text.trim();
  push(reply.chatId, {
    id: crypto.randomUUID(),
    role: "assistant",
    text: partial ? `${partial} …` : "Stopped.",
    at: Date.now(),
    ms: reply.begun ? Date.now() - reply.begun : undefined,
    trace: [...reply.trace.map((s) => ({ ...s, status: undefined })), { label: "Stopped", description: "You stopped Arcanus before it finished." }],
  });
}

// ------------------------------------------------------------------ terminal

export const COMMANDS = [
  { name: "/run", hint: "Switch Arcanus on, or retry a model that failed" },
  { name: "/shutdown", hint: "Switch Arcanus off" },
  { name: "/clear", hint: "Start a new conversation" },
  { name: "/browse", hint: "Open a page or search the web: /browse <address or words>" },
  { name: "/files", hint: "Open the Operating System: its files (.arcanus), editor, git and terminal" },
  { name: "/remember", hint: "Keep a note in .arcanus/memory: /remember <note>" },
  { name: "/teach", hint: "Teach Arcanus what your last message needed: /teach <route>" },
  { name: "/skill", hint: "Make a skill: /skill <name> <instructions>" },
  { name: "/save", hint: "Save the last reply to .arcanus/artifacts" },
  { name: "/context", hint: "Show what the last reply read" },
  { name: "/agents", hint: "Put a team of agents to work, a conversation each: /agents <task>. Alone, lists them" },
  { name: "/role", hint: "Make this conversation an agent from AGENTS.md: /role <name>, /role none" },
  ...FILE_COMMANDS, // after the older commands, so /re still completes to /remember and /s to /shutdown
  { name: "/help", hint: "List these commands" },
];

/** Run a terminal command. It interrupts a reply being written, and works while Arcanus is off. */
function command(chatId: string, input: string) {
  const name = input.split(/\s+/)[0].toLowerCase();
  const arg = input.slice(name.length).trim();
  if (live.state.reply) stop();
  chatStore.set({ replyTo: null, editingId: null });
  if (name === "/clear") return newChat();
  // A skill from .arcanus/skills runs as a message: Arcanus answers it with the skill's instructions in context.
  const skill = COMMANDS.some((c) => c.name === name) ? undefined : workspace.state.skills.find((s) => `/${s.name}` === name);
  if (skill && power.state.on) {
    voice.unlock();
    const chat = currentChat();
    if (chat) void answer(chatId, chat.messages, { id: crypto.randomUUID(), role: "user", text: input, at: Date.now() }, skill);
    return;
  }
  // A command in the Graph of Thought: what you typed, then Arcanus carrying it out (learning, for /teach and /remember).
  const doing = thought(/^\/(teach|remember)$/.test(name) ? "learn" : "execute", input, {
    parents: [thought("perceive", input, { detail: "a command" })],
    active: true,
  });
  const out = (text: string, trace?: ThoughtStep[]) => {
    settle(doing, { detail: text.split("\n")[0].slice(0, 120) });
    push(chatId, { id: crypto.randomUUID(), role: "assistant", text, at: Date.now(), kind: "command", trace });
  };
  const later = (run: () => Promise<string>) => void run().then(out, (err: unknown) => out(`That didn't work: ${errorText(err)}`));
  push(chatId, { id: crypto.randomUUID(), role: "user", text: input, at: Date.now(), kind: "command" });

  if (skill) return out("Arcanus is off. /run starts it.");
  if (name === "/help") {
    const skills = workspace.state.skills.map((s) => ({ name: `/${s.name}`, hint: `Skill · ${s.description}` }));
    return out([...COMMANDS, ...skills].map((c) => `${c.name.padEnd(10)} ${c.hint}`).join("\n"));
  }
  if (name === "/files") {
    openPane("os");
    return out(`The Operating System is open. Arcanus keeps its own in ${HOME}/, in ${workspace.state.name || "its home"}.`);
  }
  // Its own files, source and git (workspace/terminal.ts).
  const file = fileCommand(name, arg);
  if (file) return later(file);
  if (name === "/browse") {
    if (!arg) {
      openArtifact(SEARCH);
      return out("The search engine is open. /browse <address or words> goes straight to the web.");
    }
    return later(async () => {
      const view = await go(arg);
      return view.kind === "page" ? `Opened ${view.page.title}.` : `${view.results.length} results from ${view.engine}.`;
    });
  }
  if (name === "/remember") {
    if (!arg) return out("/remember <note> keeps a note. Arcanus recalls it when a message is about it.");
    // The notes most like this one are linked from it: recalling either brings the other into a reply's context.
    return later(async () => `Remembered. Saved to ${await remember(arg, recallNotes(arg, await memories().catch(() => [])).map((n) => n.id))}.`);
  }
  if (name === "/teach") {
    // A correction for Hippocampus: the last thing you asked should have gone to <route>. Kept in .arcanus/routing.json.
    const routes = routeNames().join(", ");
    if (!arg) return out(`/teach <route> teaches Arcanus what your last message needed. Routes: ${routes}.`);
    const last = currentChat()?.messages.findLast((m) => m.role === "user" && !m.kind);
    if (!last) return out("There's no message of yours to teach from yet.");
    const route = arg.toLowerCase();
    return later(async () =>
      (await teach(last.text, route))
        ? `Learned: "${last.text.slice(0, 80)}" needs ${route}. Kept in ${HOME}/routing.json.`
        : `There's no route called ${route}. Routes: ${routes}.`
    );
  }
  if (name === "/skill") {
    const [skillName, ...words] = arg.split(/\s+/);
    if (!skillName || !words.length) return out("/skill <name> <instructions> makes a skill. Run it with /<name> <message>.");
    return later(async () => {
      const made = await createSkill(skillName, words.join(" "));
      return `Made /${made.name}. Its instructions are in ${made.path}: edit them in the Operating System.`;
    });
  }
  if (name === "/save") {
    const chat = currentChat();
    const last = chat?.messages.findLast((m) => m.role === "assistant" && !m.kind);
    if (!chat || !last) return out("There's no reply to save yet.");
    return later(async () => `Saved to ${await saveArtifact(arg || chat.title, `${last.text}\n`)}.`);
  }
  if (name === "/agents") {
    if (!arg) return out(roster());
    if (!power.state.on) return out("Arcanus is off. /run starts it.");
    voice.unlock();
    return later(() => orchestrate(chatId, arg));
  }
  if (name === "/role") {
    const now = chatStore.state.chats.find((c) => c.id === chatId)?.role;
    if (!arg) return out(now ? `This conversation is the ${now} agent. /role none makes it Arcanus again.` : roster());
    if (/^(none|off|arcanus)$/i.test(arg)) {
      write(chatId, (c) => ({ ...c, role: undefined }));
      return out("This conversation is Arcanus itself again.");
    }
    const role = workspace.state.agents.find((a) => a.name === slug(arg));
    if (!role) return out(`There's no ${arg} in ${HOME}/AGENTS.md.\n\n${roster()}`);
    write(chatId, (c) => ({ ...c, role: role.name }));
    return out(`This conversation is now the ${role.name} agent: ${role.description}`);
  }
  if (name === "/context") {
    const where = `Workspace: ${workspace.state.name || "not ready"} · ${workspace.state.skills.length} skills in ${HOME}/skills`;
    if (!lastContext) return out(`${where}\nNo reply has read any context yet.`);
    return out(`${where}\nThe last reply read ${lastContext.used} of ${lastContext.budget} characters of context:\n${lastContext.report.map(reportLine).join("\n")}`);
  }
  if (name === "/shutdown") {
    if (!power.state.on) return out("Already off. /run starts Arcanus.");
    setPower(false);
    return out("Shut down. The models stay in memory, so /run boots again at once.");
  }
  if (name === "/run") {
    if (!power.state.on) return setPower(true); // the boot message that follows is the answer
    const failed = engines.filter((e) => !e.state.state.off && e.state.state.status === "error");
    void bootInTurn(failed);
    return out(failed.length ? `Already running. Retrying ${failed.map((e) => e.name).join(", ")}.` : "Already running.", engineSteps());
  }
  out(`Unknown command ${name}. /help lists them.`);
}

/** Send a message from the composer. Returns false when there is nothing to send or a reply is still being written. */
export function send(text: string) {
  const current = currentChat();
  const trimmed = text.trim().slice(0, MAX);
  if (!current || !trimmed) return false;
  if (/^\/\w/.test(trimmed)) {
    command(current.id, trimmed);
    return true;
  }
  if (!power.state.on) {
    push(current.id, { id: crypto.randomUUID(), role: "user", text: trimmed, at: Date.now(), kind: "command" });
    push(current.id, { id: crypto.randomUUID(), role: "assistant", text: "Arcanus is off. /run starts it.", at: Date.now(), kind: "command" });
    return true;
  }
  if (busy()) return false;
  voice.unlock(); // inside the click/keypress, so the browser lets the voice play
  const { replyTo } = chatStore.state;
  chatStore.set({ replyTo: null, editingId: null });
  void answer(current.id, current.messages, {
    id: crypto.randomUUID(),
    role: "user",
    text: trimmed,
    at: Date.now(),
    replyToId: replyTo?.id,
  });
  return true;
}

chatLine.send = send; // the Operating System's terminal and Run menu hand lines to the chat through this

/** Replace a user message with `text` and answer it again; everything after it is dropped. */
export function resend(id: string, text: string) {
  const current = currentChat();
  const trimmed = text.trim().slice(0, MAX);
  const index = current?.messages.findIndex((m) => m.id === id) ?? -1;
  if (!current || !trimmed || busy() || index < 0 || current.messages[index].role !== "user") return;
  voice.unlock();
  chatStore.set({ replyTo: null, editingId: null });
  void answer(current.id, current.messages.slice(0, index), { ...current.messages[index], text: trimmed, at: Date.now() });
}

export function retry() {
  const current = currentChat();
  if (!current || busy()) return;
  const kept = current.messages.slice(0, lastRole(current.messages, "assistant"));
  const lastUser = lastRole(kept, "user");
  if (lastUser < 0) return;
  voice.unlock();
  void answer(current.id, kept.slice(0, lastUser), kept[lastUser]);
}

/** Delete at once (undo is offered), stopping the reply first if it was being written into what goes. */
export function discard(what: Removal) {
  const reply = live.state.reply;
  if (reply && (what.kind === "all" || (what.kind === "chat" && what.id === reply.chatId))) stop();
  remove(what);
}

/**
 * Talk hands-free, full duplex: one tap opens the mic until the next. The mic stays open while Arcanus speaks.
 * Talking over it stops it at once, then the pause sends what you said. Call from a click: it unlocks audio and asks for the mic.
 */
export function talk() {
  voice.unlock();
  if (listen.state.state.on) return listen.cancel();
  if (!power.state.on) return;
  // Arcanus keeps talking (and thinking) while the mic listens. Real words stop it; noise and its own echo do not.
  let over = false; // Arcanus was talking while this was said, so it may be its own echo
  let hearing: string | null = null; // the Graph of Thought's thought for what is being heard right now
  // A sentence said in two breaths is one message. The microphone says when speech began right after the last thing
  // said ended (listen's `resumed`); the two are then joined, whichever way their words arrive.
  const resumed: boolean[] = []; // one per thing said and not yet written down, oldest first
  let carried = ""; // the first half, when its words arrived while you were already saying the rest
  let sent: string | null = null; // the last spoken message's id
  let tail = false; // the last thing heard is that message, or led straight on from it
  const said = () => live.state.reply?.text || lastAssistant();
  const interrupt = () => {
    cancelGreet();
    voice.cancel();
    if (live.state.reply) stop(); // what you said now wins over the reply being written
  };
  void listen.converse({
    strict: () => voice.state.state.speaking,
    onSpeech: (_cut, again) => {
      // Duck, but do not stop. The mic hears Arcanus's own first sentence; stopping here saved that sentence and a "…".
      // Real words still interrupt, as soon as they are written and are not an echo (onPartial, onText).
      over = voice.state.state.speaking;
      if (over) voice.duck(true);
      resumed.push(again);
      hearing ??= thought("perceive", "Hearing you…", { active: true, detail: "microphone" });
    },
    onPartial: (text) => {
      revise(hearing, { content: text });
      // Two words or more, and not Arcanus's own: you are talking over it. It stops now, not when you finish.
      const talkingOver = voice.state.state.speaking || live.state.reply !== null;
      if (!talkingOver || text.split(/\s+/).length < 2 || isEcho(text, said())) return;
      over = false; // these words were checked: the rest of what you say is yours too
      interrupt();
    },
    onText: (text, seconds) => {
      const echo = (over || voice.state.state.speaking) && isEcho(text, said());
      over = false;
      const id = hearing;
      hearing = null;
      const mine = echo ? "" : text;
      const sound = `${seconds.toFixed(1)} s of sound`;
      settle(
        id,
        mine
          ? { content: mine, detail: `heard through the microphone · ${sound}, written in ${listen.took} ms` }
          : { content: echo ? "Only my own voice, echoing back" : "Only noise", detail: `ignored · ${sound}` },
      );
      // This carries your last message on: said right after it, or right after what led on from it.
      const joins = (resumed.shift() ?? false) && tail;
      tail = joins;
      const whole = `${carried} ${mine}`.trim();
      if (!whole) return voice.duck(false);
      // You went straight on talking: that was the first half of a sentence. It waits for the rest.
      if (resumed[0]) return void (carried = whole);
      carried = "";
      interrupt();
      const chat = currentChat();
      const first = joins && chat ? chat.messages.findIndex((m) => m.id === sent) : -1;
      heard = id; // the reply's root: the message is answered at once, so it takes this
      viaVoice = true;
      if (chat && first >= 0 && power.state.on) {
        // The rest of your last message: answer the two together, in place of the reply to the first half.
        const message = chat.messages[first];
        tail = true;
        void answer(chat.id, chat.messages.slice(0, first), { ...message, text: `${message.text} ${whole}`.slice(0, MAX), at: Date.now() });
      } else if (send(whole)) {
        sent = currentChat()?.messages.findLast((m) => m.role === "user")?.id ?? null;
        tail = true;
      }
      viaVoice = false; // send() may have refused it (busy), so the next typed message isn't taken for speech
      heard = null;
    },
  });
}

// The live chat's chime: up as the mic opens, down as it closes, however it closed (the button, an error, power off).
let wasLive = false;
listen.state.subscribe(() => {
  const on = listen.state.state.on;
  if (on !== wasLive) voice.chime((wasLive = on));
});

const lastAssistant = () => currentChat()?.messages.findLast((m) => m.role === "assistant")?.text ?? "";

/** Read a reply aloud, turning the voice on if it was off. */
export function speak(text: string) {
  voice.unlock();
  voice.cancel();
  if (voice.state.state.off) voice.setEnabled(true);
  sayAll(text);
}
