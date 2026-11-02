"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { Sidebar, useSidebar } from "@/components/ui/sidebar";
import { ChainOfThoughtTrace, type ThoughtStep } from "./chain-of-thought";
import { think } from "@/lib/brain";
import { brainState, llm, startBrain, useEngine, voice, type LoadState, type Turn } from "@/lib/engines";
import { offlineReady, useOnline } from "@/lib/offline";
import { takeSentences } from "@/lib/tools";

interface Msg {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
  replyToId?: string;
  /** A downscaled JPEG data URL. */
  image?: string;
  trace?: ThoughtStep[];
}

interface Chat {
  id: string;
  title: string;
  messages: Msg[];
}

type Confirm = { kind: "message"; id: string } | { kind: "chat"; id: string } | { kind: "all" };

const MAX = 2000;
const CHATS_KEY = "arcanus_chats_v1";
const CURRENT_KEY = "arcanus_current_v1";
const VOICE_KEY = "arcanus_voice_v1";
const SUGGESTIONS = ["Who are you?", "What time is it?", "What's (12 + 8) * 3?", "Write a haiku about the sea"];
const SYSTEM =
  "You are Arcanus, a friendly AI assistant that lives in the user's browser as a glowing sphere. Answer clearly and briefly.";

const blankChat = (): Chat => ({ id: crypto.randomUUID(), title: "Untitled", messages: [] });

function asTrace(value: unknown): ThoughtStep[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const steps = value.flatMap((step): ThoughtStep[] => {
    if (!step || typeof step !== "object" || typeof step.label !== "string") return [];
    return [
      {
        label: step.label,
        description: typeof step.description === "string" ? step.description : undefined,
        results: Array.isArray(step.results) ? step.results.filter((r: unknown) => typeof r === "string") : undefined,
        steps: asTrace(step.steps),
      },
    ];
  });
  return steps.length ? steps : undefined;
}

function loadChats(): { chats: Chat[]; currentId: string } {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(CHATS_KEY) ?? "null");
    const chats: Chat[] = [];
    for (const item of Array.isArray(data) ? data : []) {
      if (!item || typeof item.id !== "string" || !Array.isArray(item.messages)) continue;
      chats.push({
        id: item.id,
        title: typeof item.title === "string" && item.title.trim() ? item.title.slice(0, 40) : "Untitled",
        messages: item.messages.flatMap((m: Partial<Msg>): Msg[] =>
          m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string" && typeof m.id === "string"
            ? [
                {
                  id: m.id,
                  role: m.role,
                  text: m.text.slice(0, MAX * 4),
                  at: typeof m.at === "number" ? m.at : Date.now(),
                  replyToId: typeof m.replyToId === "string" ? m.replyToId : undefined,
                  image: typeof m.image === "string" && m.image.startsWith("data:image/") ? m.image : undefined,
                  trace: asTrace(m.trace),
                },
              ]
            : []
        ),
      });
    }
    if (chats.length) {
      const saved = localStorage.getItem(CURRENT_KEY);
      return { chats, currentId: chats.some((c) => c.id === saved) ? saved! : chats[0].id };
    }
  } catch {
    /* a bad save starts a fresh chat */
  }
  const chat = blankChat();
  return { chats: [chat], currentId: chat.id };
}

const clock = (at: number) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(at);

function lastRole(messages: Msg[], role: Msg["role"]) {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === role) return i;
  return -1;
}

/** Shrink an image to at most 512 px a side as JPEG: enough for SmolVLM, small enough to keep in localStorage. */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

function buildTurns(prior: Msg[], user: Msg, facts?: string[]): Turn[] {
  const quote = user.replyToId ? prior.find((m) => m.id === user.replyToId) : undefined;
  let content = user.text;
  if (quote) content = `About this earlier message: "${quote.text.slice(0, 300)}"\n\n${content}`;
  if (facts?.length) content = `Facts about Arcanus:\n${facts.map((f) => `- ${f}`).join("\n")}\n\nUsing these facts, answer: ${content}`;
  const history = prior.slice(-6).map((m): Turn => ({ role: m.role, content: m.text }));
  return [{ role: "system", content: SYSTEM }, ...history, { role: "user", content }];
}

const PATHS = {
  plus: "M12 5v14M5 12h14",
  pencil: "M4 20h4L18.5 9.5a2.1 2.1 0 0 0-4-4L4 16z",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  close: "M6 6l12 12M18 6L6 18",
  send: "M5 12h14M13 6l6 6-6 6",
  stop: "M7 7h10v10H7z",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01",
  voice: "M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11",
  mute: "M4 9v6h4l5 4V5L8 9zM17 9l4 6M21 9l-4 6",
  chevron: "M6 9l6 6 6-6",
  left: "M15 6l-6 6 6 6",
  right: "M9 6l6 6-6 6",
  check: "M5 12l5 5 9-10",
};

function Icon({ name, size = 16 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}

function EnginePill({ name, detail, state, off, onRetry }: { name: string; detail: string; state: LoadState; off?: boolean; onRetry: () => void }) {
  const pct = state.total ? Math.min(100, Math.round((state.loaded / state.total) * 100)) : 0;
  const label = off
    ? "off"
    : state.status === "ready"
      ? state.device === "webgpu" ? "WebGPU" : "ready"
      : state.status === "loading"
        ? state.total ? `${pct}%` : "starting"
        : state.status === "error"
          ? "failed"
          : "waiting";
  return (
    <div
      className="engine"
      data-status={off ? "off" : state.status}
      style={{ "--p": state.status === "ready" ? 1 : pct / 100 } as React.CSSProperties}
      title={state.error ?? `${name} · ${detail}`}
    >
      <span className="engine-name">{name}</span>
      <span className="engine-detail">{detail}</span>
      {state.status === "error" && !off ? (
        <button type="button" className="engine-retry" onClick={onRetry}>
          Retry
        </button>
      ) : (
        <span className="engine-state">{label}</span>
      )}
    </div>
  );
}

export default function ChatPanel({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) {
  const menuId = useId();
  const { isMobile } = useSidebar();
  const brain = useEngine(brainState);
  const model = useEngine(llm.state);
  const speech = useEngine(voice.state);
  const online = useOnline();
  const [chats, setChats] = useState<Chat[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [draft, setDraft] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<{ trace: ThoughtStep[]; text: string } | null>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatQuery, setChatQuery] = useState("");
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const gen = useRef(0);
  const flightChat = useRef<string | null>(null);
  const liveRef = useRef(live);
  const voiceRef = useRef(voiceOn);
  liveRef.current = live;
  voiceRef.current = voiceOn;

  const current = chats.find((c) => c.id === currentId) ?? null;
  const lastAssistantAt = current ? lastRole(current.messages, "assistant") : -1;
  const shownChats = chats.filter((c) => c.title.toLowerCase().includes(chatQuery.trim().toLowerCase()));

  useEffect(() => {
    const loaded = loadChats();
    setChats(loaded.chats);
    setCurrentId(loaded.currentId);
    let on = true;
    try {
      on = localStorage.getItem(VOICE_KEY) !== "off";
    } catch {
      /* storage blocked: voice stays on */
    }
    setVoiceOn(on);
    setHydrated(true);
    // Engines start once the service worker controls the page, so everything they download is kept for offline use.
    void offlineReady().then(() => {
      startBrain();
      void llm.start().catch(() => undefined);
      if (on) void voice.start().catch(() => undefined);
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
      if (currentId) localStorage.setItem(CURRENT_KEY, currentId);
      localStorage.setItem(VOICE_KEY, voiceOn ? "on" : "off");
    } catch {
      /* full or blocked storage: this session still works */
    }
  }, [chats, currentId, voiceOn, hydrated]);

  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [current?.messages, live]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  function writeChat(id: string, fn: (chat: Chat) => Chat) {
    setChats((prev) => prev.map((chat) => (chat.id === id ? fn(chat) : chat)));
  }

  function pushMessage(chatId: string, message: Msg) {
    writeChat(chatId, (chat) => ({ ...chat, messages: [...chat.messages, message] }));
  }

  async function answer(chatId: string, prior: Msg[], userMessage: Msg) {
    const mine = ++gen.current;
    const stale = () => mine !== gen.current;
    flightChat.current = chatId;
    voice.cancel();
    const asked = userMessage.text;
    writeChat(chatId, (chat) => ({
      ...chat,
      title: chat.title === "Untitled" && prior.length === 0 ? asked.replace(/\s+/g, " ").trim().slice(0, 40) || "Image" : chat.title,
      messages: [...prior, userMessage],
    }));
    setBusy(true);
    setLive({
      trace: [
        { label: "Read the message", description: asked },
        { label: "ARC 1", description: "Deciding what this needs", status: "active" },
      ],
      text: "",
    });
    const finish = (text: string, trace: ThoughtStep[]) => {
      if (stale()) return;
      pushMessage(chatId, { id: crypto.randomUUID(), role: "assistant", text, at: Date.now(), trace });
      setLive(null);
      setBusy(false);
      flightChat.current = null;
    };
    let trace: ThoughtStep[] = [];
    try {
      const plan = await think(asked, Boolean(userMessage.image));
      trace = plan.trace;
      if (stale()) return;
      if (plan.reply) {
        // Sentence by sentence, like the model's replies: one long block would hold back the first word.
        if (voiceRef.current) takeSentences(`${plan.reply}\n`).sentences.forEach((s) => voice.say(s));
        finish(plan.reply, trace);
        return;
      }
      const writing = (description: string): ThoughtStep => ({ label: "SmolVLM-256M", description, status: "active" });
      setLive({ trace: [...trace, writing(llm.state.state.status === "ready" ? "Writing on this device" : "Loading the model on this device")], text: "" });
      let shown = "";
      let unspoken = "";
      const result = await llm.generate(buildTurns(prior, userMessage, plan.facts), userMessage.image, (piece) => {
        if (stale()) return;
        shown += piece;
        if (voiceRef.current) {
          const { sentences, rest } = takeSentences(unspoken + piece);
          unspoken = rest;
          sentences.forEach((s) => voice.say(s));
        }
        setLive({ trace: [...trace, writing("Writing on this device")], text: shown });
      });
      if (stale()) return;
      if (voiceRef.current && unspoken.trim()) voice.say(unspoken);
      const device = llm.state.state.device === "webgpu" ? "WebGPU" : "WebAssembly";
      finish(result.text || shown.trim() || "…", [
        ...trace,
        {
          label: "SmolVLM-256M wrote this",
          description: `First word in ${(result.firstMs / 1000).toFixed(1)} s · ${result.tokens} tokens at ${result.perSecond.toFixed(1)} tok/s · ${device}`,
        },
        ...(voiceRef.current ? [{ label: "Paradee-8M spoke it", description: "Sentence by sentence, as it was written" }] : []),
      ]);
    } catch (err) {
      const reason = (err instanceof Error ? err.message : String(err)).slice(0, 200);
      finish("That didn't run. Try it once more.", [...trace, { label: "Something failed", description: reason }]);
    }
  }

  function stop() {
    const id = flightChat.current;
    const partial = liveRef.current?.text.trim();
    const trace = liveRef.current?.trace.map((s) => ({ ...s, status: undefined })) ?? [];
    gen.current += 1;
    flightChat.current = null;
    llm.stop();
    voice.cancel();
    setBusy(false);
    setLive(null);
    if (!id) return;
    pushMessage(id, {
      id: crypto.randomUUID(),
      role: "assistant",
      text: partial ? `${partial} …` : "Stopped.",
      at: Date.now(),
      trace: [...trace, { label: "Stopped", description: "You stopped Arcanus before it finished." }],
    });
  }

  function send(text = draft, quote: Msg | null = replyTo) {
    const trimmed = text.trim().slice(0, MAX);
    if ((!trimmed && !image) || busy || flightChat.current || !current) return;
    voice.unlock(); // inside the click/keypress, so the browser lets the voice play
    const userMessage: Msg = {
      id: crypto.randomUUID(),
      role: "user",
      text: trimmed || "What is in this image?",
      at: Date.now(),
      replyToId: quote?.id,
      image: image ?? undefined,
    };
    setDraft("");
    setImage(null);
    setReplyTo(null);
    setEditingId(null);
    void answer(current.id, current.messages, userMessage);
  }

  function saveEdit() {
    if (!current || !editingId || busy || flightChat.current) return;
    const text = editText.trim().slice(0, MAX);
    const index = current.messages.findIndex((m) => m.id === editingId);
    if (!text || index < 0 || current.messages[index].role !== "user") return;
    voice.unlock();
    setEditingId(null);
    setReplyTo(null);
    void answer(current.id, current.messages.slice(0, index), { ...current.messages[index], text, at: Date.now() });
  }

  function retry() {
    if (!current || busy || flightChat.current) return;
    const kept = current.messages.slice(0, lastRole(current.messages, "assistant"));
    const lastUser = lastRole(kept, "user");
    if (lastUser < 0) return;
    voice.unlock();
    void answer(current.id, kept.slice(0, lastUser), kept[lastUser]);
  }

  function speak(text: string) {
    voice.unlock();
    voice.cancel();
    if (!voiceOn) setVoiceOn(true);
    takeSentences(`${text}\n`).sentences.forEach((s) => voice.say(s));
  }

  function toggleVoice() {
    const on = !voiceOn;
    setVoiceOn(on);
    if (on) {
      voice.unlock();
      void voice.start().catch(() => undefined);
    } else voice.cancel();
  }

  function selectChat(id: string) {
    setCurrentId(id);
    setReplyTo(null);
    setEditingId(null);
    setRenaming(false);
    setConfirm(null);
    setMenuOpen(false);
  }

  function newChat() {
    const chat = blankChat();
    setChats((prev) => [chat, ...prev]);
    selectChat(chat.id);
    inputRef.current?.focus();
  }

  function commitRename() {
    if (currentId) writeChat(currentId, (chat) => ({ ...chat, title: renameValue.trim().slice(0, 40) || "Untitled" }));
    setRenaming(false);
  }

  function applyConfirm() {
    if (!confirm) return;
    if (confirm.kind === "all") {
      if (flightChat.current) stop();
      const chat = blankChat();
      setChats([chat]);
      selectChat(chat.id);
    } else if (confirm.kind === "chat") {
      if (flightChat.current === confirm.id) stop();
      const next = chats.filter((c) => c.id !== confirm.id);
      if (!next.length) {
        const chat = blankChat();
        setChats([chat]);
        selectChat(chat.id);
      } else {
        setChats(next);
        if (currentId === confirm.id) selectChat(next[0].id);
      }
    } else if (currentId) {
      const id = confirm.id;
      if (editingId === id) setEditingId(null);
      if (replyTo?.id === id) setReplyTo(null);
      writeChat(currentId, (chat) => {
        const index = chat.messages.findIndex((m) => m.id === id);
        return index < 0 ? chat : { ...chat, messages: chat.messages.slice(0, index) };
      });
    }
    setConfirm(null);
  }

  async function attach(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      setImage(await shrink(file));
      inputRef.current?.focus();
    } catch {
      setImage(null);
    }
  }

  const status = busy ? "thinking" : speech.speaking ? "speaking" : "ready";
  const statusText = busy
    ? "Thinking on this device"
    : speech.speaking
      ? "Speaking"
      : model.status === "ready"
        ? online ? "Ready · runs on this device" : "Offline · still runs on this device"
        : model.status === "error"
          ? online ? "SmolVLM didn't load" : "Offline · connect once so the models can download"
          : online ? "Loading models on this device" : "Offline · loading models from this device";

  if (collapsed) {
    return (
      <>
        <aside className="rail" aria-label="Arcanus chat (collapsed)">
          <button type="button" className="icon-btn" aria-label="Open chat" title="Open chat" onClick={() => setCollapsed(false)}>
            <Icon name="left" />
          </button>
          <span className="brand-mark" data-state={status} />
        </aside>
      </>
    );
  }

  const chat = (
    <>
      <header className="panel-head">
        <span className="brand-mark" data-state={status} aria-hidden />
        <div className="panel-title" ref={menuRef}>
          {renaming ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                commitRename();
              }}
            >
              <input
                className="field"
                value={renameValue}
                maxLength={40}
                aria-label="Conversation name"
                autoFocus
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => e.key === "Escape" && setRenaming(false)}
              />
            </form>
          ) : (
            <button
              type="button"
              className="title-btn"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls={menuId}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <span className="truncate">{current?.title ?? "Arcanus"}</span>
              <Icon name="chevron" size={14} />
            </button>
          )}
          <p className="panel-status">{statusText}</p>
          {menuOpen ? (
            <div id={menuId} role="menu" className="menu" onKeyDown={(e) => e.key === "Escape" && setMenuOpen(false)}>
              <input
                className="field"
                value={chatQuery}
                placeholder="Search conversations"
                aria-label="Search conversations"
                autoFocus
                onChange={(e) => setChatQuery(e.target.value)}
              />
              <div className="menu-list">
                {shownChats.map((chat) => (
                  <button key={chat.id} type="button" role="menuitem" className="menu-item" onClick={() => selectChat(chat.id)}>
                    <span className="truncate">{chat.title}</span>
                    {chat.id === currentId ? <Icon name="check" size={14} /> : null}
                  </button>
                ))}
                {!shownChats.length ? <p className="menu-empty">No conversation matches.</p> : null}
              </div>
              <div className="menu-sep" />
              <button type="button" role="menuitem" className="menu-item" onClick={newChat}>
                New conversation
              </button>
              <button
                type="button"
                role="menuitem"
                className="menu-item danger"
                onClick={() => {
                  setMenuOpen(false);
                  setConfirm({ kind: "all" });
                }}
              >
                Delete every conversation
              </button>
            </div>
          ) : null}
        </div>
        <button type="button" className="icon-btn" aria-label="New conversation" title="New conversation" onClick={newChat}>
          <Icon name="plus" />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Rename conversation"
          title="Rename"
          disabled={!current}
          onClick={() => {
            setRenameValue(current?.title ?? "");
            setRenaming(true);
          }}
        >
          <Icon name="pencil" />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Delete conversation"
          title="Delete conversation"
          disabled={!current}
          onClick={() => current && setConfirm({ kind: "chat", id: current.id })}
        >
          <Icon name="trash" />
        </button>
        <button type="button" className="icon-btn" aria-label="Hide chat" title="Hide chat" onClick={() => setCollapsed(true)}>
          <Icon name="right" />
        </button>
      </header>

      <div className="engines" aria-label="On-device models">
        <EnginePill name="ARC 1" detail="decides · 5.5 MB" state={brain} onRetry={startBrain} />
        <EnginePill name="SmolVLM" detail="256M Q4 · ~170 MB" state={model} onRetry={() => void llm.start().catch(() => undefined)} />
        <EnginePill name="Paradee" detail="8M voice · ~9 MB" state={speech} off={!voiceOn} onRetry={() => void voice.start().catch(() => undefined)} />
      </div>

      <div className="thread" role="log" aria-label="Conversation">
        {current && current.messages.length === 0 && !live ? (
          <div className="empty">
            <p className="empty-title">I&apos;m Arcanus.</p>
            <p>
              Everything I do runs in this browser: ARC 1 decides what you need, SmolVLM writes, Paradee speaks. Nothing you
              type leaves this device. Attach an image and I&apos;ll describe it.
            </p>
          </div>
        ) : null}

        {current?.messages.map((message, index) => {
          const quote = message.replyToId ? current.messages.find((m) => m.id === message.replyToId) : undefined;
          return (
            <article key={message.id} className="msg" data-role={message.role}>
              {editingId === message.id ? (
                <div className="edit">
                  <textarea
                    className="field"
                    value={editText}
                    maxLength={MAX}
                    aria-label="Edit message"
                    autoFocus
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        saveEdit();
                      } else if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                  <div className="row">
                    <span className="count">
                      {editText.length}/{MAX}
                    </span>
                    <button type="button" className="btn btn-primary" onClick={saveEdit}>
                      Save and resend
                    </button>
                    <button type="button" className="btn" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {quote ? <p className="msg-quote">{quote.text}</p> : null}
                  {message.role === "assistant" && message.trace?.length ? (
                    <div className="msg-trace">
                      <ChainOfThoughtTrace label={`How Arcanus decided · ${message.trace.length} steps`} steps={message.trace} />
                    </div>
                  ) : null}
                  {message.image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a local data URL; next/image adds nothing here
                    <img className="msg-image" src={message.image} alt="Image you attached" />
                  ) : null}
                  <div className="msg-bubble">{message.text}</div>
                  <div className="msg-actions">
                    <time dateTime={new Date(message.at).toISOString()}>{clock(message.at)}</time>
                    <button type="button" disabled={busy} onClick={() => setReplyTo(message)}>
                      Reply
                    </button>
                    {message.role === "user" ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setEditingId(message.id);
                          setEditText(message.text);
                        }}
                      >
                        Edit
                      </button>
                    ) : (
                      <button type="button" onClick={() => speak(message.text)}>
                        Speak
                      </button>
                    )}
                    <button type="button" disabled={busy} onClick={() => setConfirm({ kind: "message", id: message.id })}>
                      Delete
                    </button>
                    {message.role === "assistant" && index === lastAssistantAt ? (
                      <button type="button" disabled={busy} onClick={retry}>
                        Retry
                      </button>
                    ) : null}
                  </div>
                </>
              )}
            </article>
          );
        })}

        {live ? (
          <article className="msg" data-role="assistant" aria-busy="true">
            <div className="msg-trace">
              <ChainOfThoughtTrace label="Arcanus is thinking" steps={live.trace} thinking open />
            </div>
            {live.text ? (
              <div className="msg-bubble">
                {live.text}
                <span className="caret" aria-hidden />
              </div>
            ) : null}
          </article>
        ) : null}
        <div ref={endRef} />
      </div>

      {confirm ? (
        <div className="confirm" role="alertdialog" aria-label="Confirm delete">
          <p>
            {confirm.kind === "message"
              ? "Delete this message and everything after it?"
              : confirm.kind === "chat"
                ? "Delete this conversation?"
                : "Delete every conversation?"}
          </p>
          <div className="row">
            <button type="button" className="btn btn-danger" autoFocus onClick={applyConfirm}>
              Delete
            </button>
            <button type="button" className="btn" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {current && current.messages.length === 0 && !busy ? (
        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => send(s, null)}>
              {s}
            </button>
          ))}
        </div>
      ) : null}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {replyTo ? (
          <div className="attachment">
            <span className="attachment-label">Replying to</span>
            <p className="truncate">{replyTo.text}</p>
            <button type="button" className="icon-btn" aria-label="Cancel reply" onClick={() => setReplyTo(null)}>
              <Icon name="close" size={14} />
            </button>
          </div>
        ) : null}
        {image ? (
          <div className="attachment">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL preview */}
            <img src={image} alt="Image to send" className="attachment-thumb" />
            <p className="truncate">SmolVLM will look at this image</p>
            <button type="button" className="icon-btn" aria-label="Remove image" onClick={() => setImage(null)}>
              <Icon name="close" size={14} />
            </button>
          </div>
        ) : null}
        <div className="composer-box">
          <textarea
            ref={inputRef}
            value={draft}
            maxLength={MAX}
            rows={2}
            placeholder="Message Arcanus"
            aria-label="Message Arcanus"
            onChange={(e) => {
              setDraft(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              } else if (e.key === "Escape" && replyTo) setReplyTo(null);
            }}
          />
          <div className="composer-bar">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={attach} />
            <button type="button" className="icon-btn" aria-label="Attach an image" title="Attach an image" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Icon name="image" />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-pressed={voiceOn}
              aria-label={voiceOn ? "Turn voice off" : "Turn voice on"}
              title={voiceOn ? "Voice on" : "Voice off"}
              onClick={toggleVoice}
            >
              <Icon name={voiceOn ? "voice" : "mute"} />
            </button>
            <span className="count" data-warn={draft.length > MAX - 200}>
              {draft.length}/{MAX}
            </span>
            {busy ? (
              <button type="button" className="send" data-stop aria-label="Stop" title="Stop" onClick={stop}>
                <Icon name="stop" />
              </button>
            ) : (
              <button type="submit" className="send" aria-label="Send" title="Send (Enter)" disabled={!draft.trim() && !image}>
                <Icon name="send" />
              </button>
            )}
          </div>
        </div>
      </form>
    </>
  );

  if (isMobile) {
    return (
      <aside className="panel" aria-label="Arcanus chat">
        {chat}
      </aside>
    );
  }

  return (
    <Sidebar side="right" variant="floating" collapsible="offcanvas">
      <div className="panel panel-docked" role="complementary" aria-label="Arcanus chat">
        {chat}
      </div>
    </Sidebar>
  );
}
