// Answering a message: brain decides, the language model writes, the voice speaks, each sentence as it is written.
// The user's message and a "thinking" reply appear the moment they send (optimistic); tokens stream into a store of
// their own, so only the reply being written re-renders. When a model is missing, Arcanus answers what it still can.
import { recallNotes, routeNames, teach, think, type Plan } from "@/modules/brain";
import { abilities, assemble, greetingPrompt, identityBrief, personality, unsupported } from "@/modules/harness";
import { listen } from "@/modules/listen";
import { llm, type Turn } from "@/modules/llm";
import { go } from "@/modules/web";
import { isEcho, isIntroduction, openingLine, takeSentences, voice } from "@/modules/voice";
import { HOME, createSkill, instructions, memories, remember, saveArtifact, workspace, type Skill } from "@/modules/workspace";
import { openPane, pane } from "@/shared/pane";
import { power, setPower } from "@/shared/power";
import { Store, errorText, useStore, type Engine } from "@/shared/store";
import type { ThoughtStep } from "@/shared/ui/chain-of-thought";
import { MAX, chatStore, currentChat, newChat, push, remove, write, type Msg, type Removal } from "./store";

export type Live = { chatId: string; trace: ThoughtStep[]; text: string };

/** The reply being written right now, if any. */
export const live = new Store<{ reply: Live | null }>({ reply: null });
export const useBusy = () => useStore(live, (s) => s.reply !== null);
// While Arcanus is switched off it takes nothing in: the same "no" as while a reply is being written.
const busy = () => live.state.reply !== null || !power.state.on;

// The date is in, so the model never guesses it; the abilities are in, so it never offers ones it doesn't have.
const system = () =>
  `You are Arcanus. ${identityBrief} ${personality.line} You can ${abilities.join(", ")}. Today is ${new Date().toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" })}. Answer clearly and briefly. About yourself, use only these facts. If you do not know something, say so instead of guessing. Do not invent a job, a team, a company, or a personal history.`;
const NO_MODEL =
  "My language model couldn't load on this device, so I can't write that reply right now. I can still tell the time, do math and answer questions about myself. Try again once SmolLM2 shows ready.";

let gen = 0;

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
let lastContext: { report: Report; used: number } | null = null;

/** The message as the model should read it: a skill's command name taken off. */
const ask = (user: Msg, skill?: Skill) => (skill ? user.text.replace(/^\/\S+\s*/, "") || skill.description : user.text);

const STANDING = "Your user's standing instructions (ARCANUS.md)";

async function buildTurns(prior: Msg[], user: Msg, plan: Plan, skill?: Skill): Promise<{ turns: Turn[]; step: ThoughtStep | null }> {
  const [rules, notes] = await Promise.all([instructions().catch(() => ""), memories().catch(() => [])]);
  const text = ask(user, skill);
  const pinned = pane.state.pinned;
  const listed = plan.facts?.map((f) => `- ${f}`).join("\n") ?? "";
  const facts = !listed
    ? ""
    : plan.source
      ? `${listed}\n\nAnswer from this, and say which site it came from.`
      : `${listed}\n\nAnswer from these facts. Do not add a job, a team, or a personal history.`;
  const { sections, report, used } = assemble(
    [
      { label: STANDING, text: rules, priority: 1 },
      { label: `Instructions for the /${skill?.name} skill`, text: skill?.body ?? "", priority: 0 },
      { label: plan.source ?? "Facts about Arcanus, and only these", text: facts, priority: 0 },
      { label: `What the user is showing you: ${pinned?.label}`, text: pinned?.text ?? "", priority: 2 },
      { label: "Notes you remembered", text: recallNotes(text, notes).map((n) => `- ${n.text}`).join("\n"), priority: 3 },
    ],
    BUDGET
  );
  lastContext = { report, used };
  const standing = sections.find((s) => s.label === STANDING);
  const quote = user.replyToId ? prior.find((m) => m.id === user.replyToId) : undefined;
  const content = [
    ...sections.filter((s) => s !== standing).map((s) => `${s.label}:\n${s.text}`),
    quote ? `About this earlier message: "${quote.text.slice(0, 300)}"` : "",
    text,
  ]
    .filter(Boolean)
    .join("\n\n");
  // Only the conversation itself: not commands, and not the boot greeting, which a tiny model wrote about itself and
  // which would otherwise be read back as fact.
  const history = prior
    .filter((m) => !m.kind && m.text)
    .slice(-HISTORY)
    .map((m): Turn => ({ role: m.role, content: m.text.length > HISTORY_CHARS ? `${m.text.slice(0, HISTORY_CHARS)}…` : m.text }));
  const base = system();
  const prompt = standing ? `${base}\n\n${standing.label}:\n${standing.text}` : base;
  const step: ThoughtStep | null = report.length
    ? { label: "Context", description: `${used.toLocaleString()} of ${BUDGET.toLocaleString()} characters`, results: report.map(reportLine) }
    : null;
  return { turns: [{ role: "system", content: prompt }, ...history, { role: "user", content }], step };
}

function reportLine(r: Report[number]) {
  const name =
    r.label === STANDING
      ? "ARCANUS.md"
      : r.label.startsWith("Notes")
        ? "memory"
        : r.label.startsWith("What the user")
          ? r.label.replace(/^.*?: /, "")
          : r.label.replace(/^Instructions for the /, "");
  return `${name.slice(0, 48)} · ${r.chars === r.of ? r.chars : r.chars ? `${r.chars} of ${r.of}, cut` : "left out"}`;
}

const sayAll = (text: string) => takeSentences(`${text}\n`).sentences.forEach((s) => voice.say(s));
const lastRole = (messages: Msg[], role: Msg["role"]) => messages.findLastIndex((m) => m.role === role);

// ------------------------------------------------------------------ boot

let engines: Engine[] = [];

/** The boot message whose models are still loading, and their steps as they stand. */
export const booting = new Store<{ id: string | null; steps: ThoughtStep[] }>({ id: null, steps: [] });

/** One model as a step of the boot log: its size as the description, its state as the chip. */
function engineStep({ name, detail, state: { state: s } }: Engine): ThoughtStep {
  const pct = s.total ? Math.min(100, Math.round((s.loaded / s.total) * 100)) : 0;
  if (s.off) return { label: name, description: detail, status: "pending", results: ["off"] };
  if (s.status === "ready") return { label: name, description: detail, results: [s.device === "webgpu" ? "WebGPU" : "ready"] };
  if (s.status === "loading") return { label: name, description: detail, status: "active", results: [s.total ? `${pct}%` : "starting"] };
  if (s.status === "error") return { label: name, description: `${detail} · ${s.error ?? "failed"} · /run retries`, results: ["failed"] };
  return { label: name, description: detail, status: "pending", results: ["waiting"] };
}
const engineSteps = () => engines.map(engineStep);
const settled = () => engines.every(({ state: { state: s } }) => s.off || s.status === "ready" || s.status === "error");

let unwatch: (() => void) | null = null;

/** Keep the boot message's log live until every model settles, then write it into the message. */
function watchBoot(chatId: string, id: string) {
  const save = () => {
    offs.forEach((off) => off());
    unwatch = null;
    booting.set({ id: null, steps: [] });
    const trace = engineSteps();
    write(chatId, (chat) => ({ ...chat, messages: chat.messages.map((m) => (m.id === id ? { ...m, trace } : m)) }));
  };
  const update = () => (settled() ? save() : booting.set({ id, steps: engineSteps() }));
  const offs = engines.map((engine) => engine.state.subscribe(update));
  unwatch = save;
  update();
}

let listening = false;
/** This boot's greeting, once SmolLM2 has written it. */
let bootLine = "";
let greetGen = 0;
let composing = false;

function onPointer() {
  voice.unlock();
  if (!listening || !power.state.on || voice.state.state.off) return;
  listening = false;
  window.removeEventListener("pointerdown", onPointer);
  sayAll(bootLine);
}

function watchGesture() {
  if (listening || voice.state.state.off) return;
  listening = true;
  window.addEventListener("pointerdown", onPointer);
}

function silence() {
  if (!listening) return;
  listening = false;
  window.removeEventListener("pointerdown", onPointer);
}

/** Stop the greeting: not written, or not waiting to be spoken. */
function stopGreeting() {
  silence();
  greetGen++;
  if (composing) llm.stop();
}

/** Stop a boot in progress: its log is written as it stands, and the greeting is no longer written or spoken. */
export function cancelGreet() {
  stopGreeting();
  unwatch?.();
}

/**
 * Boot: post Arcanus's boot message, its trace the models loading, live until they settle. A boot right after another
 * replaces it, so reloads don't stack them. Once SmolLM2 is ready it writes the greeting in its own words, and the
 * greeting is spoken when the voice is ready, or on the next tap. Without the model, the boot log is the whole message.
 */
export function greet(list = engines) {
  engines = list;
  const chat = currentChat();
  if (!power.state.on || !chat) return;
  unwatch?.();
  stopGreeting();
  bootLine = "";
  const mine = ++greetGen;
  const intro: Msg = { id: crypto.randomUUID(), role: "assistant", text: "", at: Date.now(), kind: "boot" };
  write(chat.id, (c) => ({ ...c, messages: [...(c.messages.at(-1)?.kind === "boot" ? c.messages.slice(0, -1) : c.messages), intro] }));
  watchBoot(chat.id, intro.id);
  void compose(chat.id, intro.id, mine).catch(() => undefined);
}

/** Resolves true once SmolLM2 is ready, false if it failed or is switched off. */
function llmReady() {
  return new Promise<boolean>((resolve) => {
    const check = () => {
      const s = llm.state.state;
      if (s.status !== "ready" && s.status !== "error" && !s.off) return;
      off();
      resolve(s.status === "ready");
    };
    const off = llm.state.subscribe(check);
    check();
  });
}

/** "Friday evening": when this boot is, in words the greeting can use. */
function moment() {
  const now = new Date();
  const hour = now.getHours();
  return `${now.toLocaleDateString([], { weekday: "long" })} ${hour < 5 ? "night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}`;
}

/** The title of the last conversation the user had, if it has one. */
function lastTopic() {
  const asked = (c: { messages: Msg[] }) => c.messages.findLast((m) => m.role === "user" && !m.kind)?.at ?? 0;
  const last = [...chatStore.state.chats].sort((a, b) => asked(b) - asked(a))[0];
  return last && asked(last) && last.title !== "Untitled" ? last.title : undefined;
}

const TRIES = 6; // about 6 in 16 lines pass on either SmolLM2 size, so 6 tries greet on ~94% of boots
const MAX_WORDS = 25;
const MAX_UNSUPPORTED = 2;

/**
 * Have SmolLM2 write this boot's greeting from the harness's facts: who Arcanus is, what it can do, when it is, and
 * the user's own ARCANUS.md, last topic and notes about them. A line that isn't a greeting, runs long, or brings in
 * more than a couple of words of its own (unsupported) is thrown away, up to TRIES times.
 */
async function compose(chatId: string, id: string, mine: number) {
  if (!(await llmReady())) return;
  const [rules, notes] = await Promise.all([instructions().catch(() => ""), memories().catch(() => [])]);
  const { turns, facts } = greetingPrompt({
    when: moment(),
    rules,
    lastTopic: lastTopic(),
    notes: recallNotes("my name call me greet greeting hello prefer", notes).map((n) => n.text),
  });
  for (let attempt = 0; attempt < TRIES; attempt++) {
    if (mine !== greetGen || !power.state.on) return;
    composing = true;
    const written = await llm.generate(turns, () => undefined, { maxNewTokens: 40, sample: true }).finally(() => (composing = false));
    const line = openingLine(written.text);
    if (mine !== greetGen || !power.state.on) return;
    if (!isIntroduction(line) || line.split(/\s+/).length > MAX_WORDS || unsupported(line, facts).length > MAX_UNSUPPORTED) continue;
    bootLine = line;
    write(chatId, (chat) => ({ ...chat, messages: chat.messages.map((m) => (m.id === id ? { ...m, text: line } : m)) }));
    if (voice.state.state.off) return;
    if (voice.state.state.analyser) sayAll(line);
    else watchGesture();
    return;
  }
}

async function answer(chatId: string, prior: Msg[], user: Msg, skill?: Skill) {
  stopGreeting();
  const mine = ++gen;
  const stale = () => mine !== gen;
  const show = (trace: ThoughtStep[], text = "") => !stale() && live.set({ reply: { chatId, trace, text } });
  const finish = (text: string, trace: ThoughtStep[]) => {
    if (stale()) return;
    push(chatId, { id: crypto.randomUUID(), role: "assistant", text, at: Date.now(), trace });
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

  let trace: ThoughtStep[] = [];
  try {
    const plan: Plan = skill
      ? { route: "skill", trace: [{ label: "Read the message", description: user.text }, { label: `Skill · /${skill.name}`, description: skill.path }] }
      : await think(user.text);
    trace = plan.trace;
    if (stale()) return;
    if (plan.reply) {
      sayAll(plan.reply);
      finish(plan.reply, trace);
      return;
    }

    const built = await buildTurns(prior, user, plan, skill);
    if (stale()) return;
    if (built.step) trace = [...trace, built.step];
    const writing = (description: string): ThoughtStep => ({ label: "SmolLM2", description, status: "active" });
    show([...trace, writing(llm.state.state.status === "ready" ? "Writing on this device" : "Waiting for the model to load on this device")]);
    let shown = "";
    let unspoken = "";
    let spoke = false;
    let result;
    try {
      result = await llm.generate(built.turns, (piece) => {
        if (stale()) return;
        // Until the first words are spoken, a clause ending in a comma is enough to start: the voice begins sooner.
        shown += piece;
        const { sentences, rest } = takeSentences(unspoken + piece, spoke ? 80 : 24);
        unspoken = rest;
        spoke ||= sentences.length > 0;
        sentences.forEach((s) => voice.say(s));
        show([...trace, writing("Writing on this device")], shown);
      });
    } catch (err) {
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
    if (unspoken.trim()) voice.say(unspoken);
    const device = llm.state.state.device === "webgpu" ? "WebGPU" : "WebAssembly";
    finish(result.text || shown.trim() || "…", [
      ...trace,
      result.cached
        ? { label: "Recalled an earlier reply", description: "Same prompt as before, and SmolLM2 writes the same words for it, so it didn't run again" }
        : {
            label: `SmolLM2-${device === "WebGPU" ? "360M" : "135M"} wrote this`,
            description: `First word in ${(result.firstMs / 1000).toFixed(1)} s · ${result.tokens} tokens at ${result.perSecond.toFixed(1)} tok/s · ${device}`,
          },
      ...(voice.state.state.off ? [] : [{ label: "Paradee-8M spoke it", description: "Sentence by sentence, as it was written" }]),
    ]);
  } catch (err) {
    // Whatever broke, the reply ends here, so Arcanus is never left stuck thinking.
    finish("That didn't run. Try it once more.", [...trace, { label: "Something failed", description: errorText(err) }]);
  }
}

export function stop() {
  const reply = live.state.reply;
  gen++;
  llm.stop();
  voice.cancel();
  live.set({ reply: null });
  if (!reply) return;
  const partial = reply.text.trim();
  push(reply.chatId, {
    id: crypto.randomUUID(),
    role: "assistant",
    text: partial ? `${partial} …` : "Stopped.",
    at: Date.now(),
    trace: [...reply.trace.map((s) => ({ ...s, status: undefined })), { label: "Stopped", description: "You stopped Arcanus before it finished." }],
  });
}

// ------------------------------------------------------------------ terminal

export const COMMANDS = [
  { name: "/run", hint: "Switch Arcanus on, or retry a model that failed" },
  { name: "/shutdown", hint: "Switch Arcanus off" },
  { name: "/clear", hint: "Start a new conversation" },
  { name: "/browse", hint: "Open a page or search the web: /browse <address or words>" },
  { name: "/files", hint: "Open Arcanus's files (.arcanus)" },
  { name: "/remember", hint: "Keep a note in .arcanus/memory: /remember <note>" },
  { name: "/teach", hint: "Teach Arcanus what your last message needed: /teach <route>" },
  { name: "/skill", hint: "Make a skill: /skill <name> <instructions>" },
  { name: "/save", hint: "Save the last reply to .arcanus/artifacts" },
  { name: "/context", hint: "Show what the last reply read" },
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
  const out = (text: string, trace?: ThoughtStep[]) =>
    push(chatId, { id: crypto.randomUUID(), role: "assistant", text, at: Date.now(), kind: "command", trace });
  const later = (run: () => Promise<string>) => void run().then(out, (err: unknown) => out(`That didn't work: ${errorText(err)}`));
  push(chatId, { id: crypto.randomUUID(), role: "user", text: input, at: Date.now(), kind: "command" });

  if (skill) return out("Arcanus is off. /run starts it.");
  if (name === "/help") {
    const skills = workspace.state.skills.map((s) => ({ name: `/${s.name}`, hint: `Skill · ${s.description}` }));
    return out([...COMMANDS, ...skills].map((c) => `${c.name.padEnd(10)} ${c.hint}`).join("\n"));
  }
  if (name === "/files") {
    openPane("files");
    return out(`Files are open. Arcanus keeps its own in ${HOME}/, in ${workspace.state.name || "its home"}.`);
  }
  if (name === "/browse") {
    if (!arg) {
      openPane("browser");
      return out("The browser is open. /browse <address or words> goes straight there.");
    }
    return later(async () => {
      const view = await go(arg);
      return view.kind === "page" ? `Opened ${view.page.title}.` : `${view.results.length} results from ${view.engine}.`;
    });
  }
  if (name === "/remember") {
    if (!arg) return out("/remember <note> keeps a note. Arcanus recalls it when a message is about it.");
    return later(async () => `Remembered. Saved to ${await remember(arg)}.`);
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
      return `Made /${made.name}. Its instructions are in ${made.path}: edit them in Files.`;
    });
  }
  if (name === "/save") {
    const chat = currentChat();
    const last = chat?.messages.findLast((m) => m.role === "assistant" && !m.kind);
    if (!chat || !last) return out("There's no reply to save yet.");
    return later(async () => `Saved to ${await saveArtifact(arg || chat.title, `${last.text}\n`)}.`);
  }
  if (name === "/context") {
    const where = `Workspace: ${workspace.state.name || "not ready"} · ${workspace.state.skills.length} skills in ${HOME}/skills`;
    if (!lastContext) return out(`${where}\nNo reply has read any context yet.`);
    return out(`${where}\nThe last reply read ${lastContext.used} of ${BUDGET} characters of context:\n${lastContext.report.map(reportLine).join("\n")}`);
  }
  if (name === "/shutdown") {
    if (!power.state.on) return out("Already off. /run starts Arcanus.");
    setPower(false);
    return out("Shut down. The models stay in memory, so /run boots again at once.");
  }
  if (name === "/run") {
    if (!power.state.on) return setPower(true); // the boot message that follows is the answer
    const failed = engines.filter((e) => !e.state.state.off && e.state.state.status === "error");
    failed.forEach((e) => e.start());
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
 * Talk hands-free, full duplex: one tap opens the mic until the next. Each pause sends what you said, Arcanus answers
 * aloud, and speaking over it turns it down at once and stops it once your words are written. Call from a click: it unlocks audio and asks for the mic.
 */
export function talk() {
  voice.unlock();
  if (listen.state.state.on) return listen.cancel();
  if (!power.state.on) return;
  // Arcanus keeps talking (and thinking) while the mic listens. A sound only turns it down; it stops for real words,
  // never for noise or its own voice leaking back into the mic.
  let over = false; // Arcanus was talking while this was said, so it may be its own echo
  const said = () => live.state.reply?.text || lastAssistant();
  const interrupt = () => {
    cancelGreet();
    voice.cancel();
    if (live.state.reply) stop(); // what you said now wins over the reply being written
  };
  void listen.converse({
    strict: () => voice.state.state.speaking,
    onSpeech: () => {
      over = voice.state.state.speaking;
      if (over) voice.duck(true);
    },
    // Two words that aren't Arcanus's own: it's you, so stop now rather than when you finish.
    onWords: (text) => {
      if (!over || (text.match(/[a-z0-9']+/gi)?.length ?? 0) < 2 || isEcho(text, said())) return;
      over = false;
      interrupt();
    },
    onText: (text) => {
      const echo = (over || voice.state.state.speaking) && isEcho(text, said());
      over = false;
      if (!text || echo) return voice.duck(false);
      interrupt();
      send(text);
    },
  });
}

const lastAssistant = () => currentChat()?.messages.findLast((m) => m.role === "assistant")?.text ?? "";

/** Read a reply aloud, turning the voice on if it was off. */
export function speak(text: string) {
  voice.unlock();
  voice.cancel();
  if (voice.state.state.off) voice.setEnabled(true);
  sayAll(text);
}
