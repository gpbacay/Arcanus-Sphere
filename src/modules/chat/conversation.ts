// Answering a message: brain decides, the language model writes, the voice speaks, each sentence as it is written.
// The user's message and a "thinking" reply appear the moment they send (optimistic); tokens stream into a store of
// their own, so only the reply being written re-renders. When a model is missing, Arcanus answers what it still can.
import { think } from "@/modules/brain";
import { personality } from "@/modules/harness";
import { listen } from "@/modules/listen";
import { llm, type Turn } from "@/modules/llm";
import { isEcho, isIntroduction, openingLine, takeSentences, voice } from "@/modules/voice";
import { power } from "@/shared/power";
import { Store, errorText, useStore } from "@/shared/store";
import type { ThoughtStep } from "@/shared/ui/chain-of-thought";
import { MAX, chatStore, currentChat, push, remove, write, type Msg, type Removal } from "./store";

export type Live = { chatId: string; trace: ThoughtStep[]; text: string };

/** The reply being written right now, if any. */
export const live = new Store<{ reply: Live | null }>({ reply: null });
export const useBusy = () => useStore(live, (s) => s.reply !== null);
// While Arcanus is switched off it takes nothing in: the same "no" as while a reply is being written.
const busy = () => live.state.reply !== null || !power.state.on;

const SYSTEM = `You are Arcanus, a local AI assistant that lives in the user's browser as a glowing 3D sphere. ${personality.line} Gianne Bacay created you. You run on the user's device: SmolVLM writes replies, ARC 1 decides what a message needs, and Paradee speaks them. No server sees the conversation. Answer clearly and briefly. If asked who you are or who made you, say you are Arcanus, created by Gianne Bacay.`;
const NO_MODEL =
  "My language model couldn't load on this device, so I can't write that reply right now. I can still tell the time, do math and answer questions about myself. Try again once SmolVLM shows ready.";

let gen = 0;

function buildTurns(prior: Msg[], user: Msg, facts?: string[]): Turn[] {
  const quote = user.replyToId ? prior.find((m) => m.id === user.replyToId) : undefined;
  let content = user.text;
  if (quote) content = `About this earlier message: "${quote.text.slice(0, 300)}"\n\n${content}`;
  if (facts?.length) content = `Facts about Arcanus:\n${facts.map((f) => `- ${f}`).join("\n")}\n\nUsing these facts, answer: ${content}`;
  const history = prior.slice(-6).map((m): Turn => ({ role: m.role, content: m.text }));
  return [{ role: "system", content: SYSTEM }, ...history, { role: "user", content }];
}

const sayAll = (text: string) => takeSentences(`${text}\n`).sentences.forEach((s) => voice.say(s));
const lastRole = (messages: Msg[], role: Msg["role"]) => messages.findLastIndex((m) => m.role === role);

/** The line Arcanus composed for this boot. Empty until the model writes one. */
export const greeting = new Store({ text: "" });

let greetGen = 0;
let greetJob = 0;
let listening = false;

function bootAsk() {
  const when = new Date().toLocaleString(undefined, { weekday: "long", hour: "numeric", minute: "2-digit", second: "2-digit" });
  return `It is ${when}. Introduce yourself.`;
}

function onPointer() {
  voice.unlock();
  const line = greeting.state.text;
  if (!line || !power.state.on || voice.state.state.off) return;
  listening = false;
  window.removeEventListener("pointerdown", onPointer);
  voice.cancel();
  sayAll(line);
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

function waitReady(mine: number) {
  return new Promise<void>((resolve) => {
    const check = () => {
      const status = llm.state.state.status;
      if (mine !== greetGen || !power.state.on || status === "ready" || status === "error") {
        dropL();
        dropP();
        resolve();
      }
    };
    const dropL = llm.state.subscribe(check);
    const dropP = power.subscribe(check);
    check();
  });
}

/** Drop a boot greeting still being written, and the line from the last one. */
export function cancelGreet() {
  greetGen++;
  greeting.set({ text: "" });
  silence();
  if (!greetJob) return;
  greetJob = 0;
  llm.stop();
}

/** Ask SmolVLM for this boot's greeting. Nothing is written ahead of time. */
export function greet() {
  if (!power.state.on) return;
  const mine = ++greetGen;
  watchGesture();
  void runGreet(mine);
}

async function runGreet(mine: number) {
  if (greetJob) llm.stop();
  await waitReady(mine);
  if (mine !== greetGen || !power.state.on || busy() || llm.state.state.status !== "ready") return;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (mine !== greetGen || !power.state.on || busy()) return;
    const line = await oneIntro(mine);
    if (mine !== greetGen || !power.state.on || !isIntroduction(line)) continue;
    greeting.set({ text: line });
    if (voice.state.state.off || !voice.state.state.analyser) return;
    silence();
    voice.cancel();
    sayAll(line);
    return;
  }
}

/** One sampled sentence. A sign-off is returned and discarded by the caller. */
async function oneIntro(mine: number): Promise<string> {
  greetJob = mine;
  let shown = "";
  const take = (text: string) => {
    const line = openingLine(text);
    // A short stub may be followed by the introduction. A finished sign-off is not.
    if (!/[.!?]$/.test(line) || line.split(/\s+/).length < 3) return;
    if (isIntroduction(line)) greeting.set({ text: line });
    llm.stop();
  };
  try {
    const written = await llm.generate(
      [
        {
          role: "system",
          content:
            `You are Arcanus, just switched on. ${personality.line} One sentence that says the name Arcanus first, greets the person, and offers help. Do not thank them. Do not say goodbye.`,
        },
        { role: "user", content: bootAsk() },
      ],
      undefined,
      (piece) => {
        if (mine !== greetGen) return;
        shown += piece;
        take(shown);
      },
      { maxNewTokens: 24, fresh: true, sample: true },
    );
    return openingLine(written.text || shown);
  } catch {
    return openingLine(shown);
  } finally {
    if (greetJob === mine) greetJob = 0;
  }
}

async function answer(chatId: string, prior: Msg[], user: Msg) {
  cancelGreet();
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
    title: chat.title === "Untitled" && prior.length === 0 ? user.text.replace(/\s+/g, " ").trim().slice(0, 40) || "Image" : chat.title,
    messages: [...prior, user],
  }));
  show([
    { label: "Read the message", description: user.text },
    { label: "ARC 1", description: "Deciding what this needs", status: "active" },
  ]);

  let trace: ThoughtStep[] = [];
  try {
    const plan = await think(user.text, Boolean(user.image));
    trace = plan.trace;
    if (stale()) return;
    if (plan.reply) {
      sayAll(plan.reply);
      finish(plan.reply, trace);
      return;
    }

    const writing = (description: string): ThoughtStep => ({ label: "SmolVLM-256M", description, status: "active" });
    show([...trace, writing(llm.state.state.status === "ready" ? "Writing on this device" : "Waiting for the model to load on this device")]);
    let shown = "";
    let unspoken = "";
    let result;
    try {
      result = await llm.generate(buildTurns(prior, user, plan.facts), user.image, (piece) => {
        if (stale()) return;
        shown += piece;
        const { sentences, rest } = takeSentences(unspoken + piece);
        unspoken = rest;
        sentences.forEach((s) => voice.say(s));
        show([...trace, writing("Writing on this device")], shown);
      });
    } catch (err) {
      // Without SmolVLM, recalled notes are still an answer; anything else gets an honest "not now".
      const notes = plan.facts?.join(" ");
      sayAll(notes ?? NO_MODEL);
      finish(notes ?? NO_MODEL, [
        ...trace,
        { label: "SmolVLM unavailable", description: errorText(err) },
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
        ? { label: "Recalled an earlier reply", description: "Same prompt as before, and SmolVLM writes the same words for it, so it didn't run again" }
        : {
            label: "SmolVLM-256M wrote this",
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

/** Send a message from the composer. Returns false when there is nothing to send or a reply is still being written. */
export function send(text: string, image?: string | null) {
  const current = currentChat();
  const trimmed = text.trim().slice(0, MAX);
  if ((!trimmed && !image) || busy() || !current) return false;
  voice.unlock(); // inside the click/keypress, so the browser lets the voice play
  const { replyTo } = chatStore.state;
  chatStore.set({ replyTo: null, editingId: null });
  void answer(current.id, current.messages, {
    id: crypto.randomUUID(),
    role: "user",
    text: trimmed || "What is in this image?",
    at: Date.now(),
    replyToId: replyTo?.id,
    image: image ?? undefined,
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
 * aloud, and speaking over it stops it mid-sentence. Call from a click: it unlocks audio and asks for the mic.
 */
export function talk() {
  voice.unlock();
  if (listen.state.state.on) return listen.cancel();
  if (!power.state.on) return;
  let said = ""; // what Arcanus was saying when you started, to tell your words from its echo
  void listen.converse({
    strict: () => voice.state.state.speaking,
    onSpeech: () => {
      said = voice.state.state.speaking ? live.state.reply?.text || greeting.state.text || lastAssistant() : "";
      cancelGreet();
      if (live.state.reply) stop();
      voice.cancel();
    },
    onText: (text) => {
      if (said && isEcho(text, said)) return;
      if (live.state.reply) stop(); // a reply begun from something typed meanwhile: what you said now wins
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
