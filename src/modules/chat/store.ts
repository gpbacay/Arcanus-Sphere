// Conversations: their state, saving them on this device, and every change to them. Changes apply at once
// (optimistic) and are written to storage in the background; deletes can be undone for a few seconds.
// They are kept in IndexedDB. They used to be in localStorage, which stops at about 5 MB: a few hundred replies with
// their traces. What was saved there is read once, and moved.
import type { ThoughtStep } from "@/shared/ui/chain-of-thought";
import { scopedKey } from "@/modules/account";
import { kept } from "@/shared/idb";
import { Store } from "@/shared/store";

export interface Msg {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
  replyToId?: string;
  trace?: ThoughtStep[];
  /** How long Arcanus thought before this reply was done, in ms ("Thought 17s"). */
  ms?: number;
  /** "boot": Arcanus's introduction, its trace the boot log. "command": a terminal command or its output, kept out of the model's context. */
  kind?: "boot" | "command";
}

export interface Chat {
  id: string;
  title: string;
  messages: Msg[];
}

export type Removal = { kind: "message"; id: string } | { kind: "chat"; id: string } | { kind: "all" };
type Undo = { label: string; chats: Chat[]; currentId: string };
/** What the last save kept: everything, or nothing (storage full or blocked). */
type Saved = "all" | "none";

export const MAX = 2000;
// Each account has its own conversations (account/local.ts): the keys are read when used, once someone is signed in.
const chatsKey = () => scopedKey("chats_v1");
const currentKey = () => scopedKey("current_v1");
const UNDO_MS = 6000;

export const chatStore = new Store({
  chats: [] as Chat[],
  currentId: "",
  /** False until the saved chats are read on the client: the thread shows a skeleton until then. */
  hydrated: false,
  saved: "all" as Saved,
  replyTo: null as Msg | null,
  editingId: null as string | null,
  undo: null as Undo | null,
});

type State = typeof chatStore.state;
export const selectCurrent = (s: State) => s.chats.find((c) => c.id === s.currentId) ?? null;
export const currentChat = () => selectCurrent(chatStore.state);

const blankChat = (): Chat => ({ id: crypto.randomUUID(), title: "Untitled", messages: [] });

// ------------------------------------------------------------------ saving

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

/** The saved conversations, checked field by field: what is in storage may be from an older version, or edited. */
function fromSaved(data: unknown): { chats: Chat[]; currentId: string } {
  try {
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
                  trace: asTrace(m.trace),
                  kind: m.kind === "boot" || m.kind === "command" ? m.kind : undefined,
                },
              ]
            : []
        ),
      });
    }
    if (chats.length) {
      const saved = localStorage.getItem(currentKey());
      return { chats, currentId: chats.some((c) => c.id === saved) ? saved! : chats[0].id };
    }
  } catch {
    /* a bad save starts a fresh chat */
  }
  const chat = blankChat();
  return { chats: [chat], currentId: chat.id };
}

function persist() {
  window.clearTimeout(saveTimer);
  const { chats, currentId } = chatStore.state;
  try {
    localStorage.setItem(currentKey(), currentId);
  } catch {
    /* storage blocked: the first conversation opens next time */
  }
  const settle = (saved: Saved) => saved !== chatStore.state.saved && chatStore.set({ saved });
  kept("readwrite", (store) => store.put(chats, chatsKey())).then(
    () => {
      settle("all");
      localStorage.removeItem(chatsKey()); // the copy from before the move: IndexedDB has it now
    },
    () => settle("none"), // storage full or blocked: this session still works
  );
}

let saveTimer = 0;
/** Apply a change now and save it shortly after, so a burst of changes is written once. */
function commit(patch: Partial<State>) {
  chatStore.set(patch);
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(persist, 300);
}

let hydrating: Promise<void> | null = null;

/** Read the saved chats. Call on the client; it resolves once they are in the store. Never rejects. */
export function hydrate() {
  hydrating ??= (async () => {
    let data: unknown = await kept<unknown>("readonly", (store) => store.get(chatsKey())).catch(() => undefined);
    try {
      data ??= JSON.parse(localStorage.getItem(chatsKey()) ?? "null"); // saved before the move to IndexedDB
    } catch {
      /* a bad save starts a fresh chat */
    }
    chatStore.set({ ...fromSaved(data), hydrated: true });
    // A change still waiting to be saved is written before the tab goes away. A phone hides a tab without unloading it.
    const flush = () => document.visibilityState === "hidden" && persist();
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", flush);
  })();
  return hydrating;
}

// ------------------------------------------------------------------ changes

// Undo restores the chats as they were before the delete, so any later change to them retires the offer.
export function write(id: string, fn: (chat: Chat) => Chat) {
  commit({ chats: chatStore.state.chats.map((chat) => (chat.id === id ? fn(chat) : chat)), undo: null });
}

export function push(chatId: string, message: Msg) {
  write(chatId, (chat) => ({ ...chat, messages: [...chat.messages, message] }));
}

export function select(id: string) {
  commit({ currentId: id, replyTo: null, editingId: null });
}

export function newChat() {
  const chat = blankChat();
  commit({ chats: [chat, ...chatStore.state.chats], currentId: chat.id, replyTo: null, editingId: null, undo: null });
}

export function rename(title: string) {
  write(chatStore.state.currentId, (chat) => ({ ...chat, title: title.trim().slice(0, 40) || "Untitled" }));
}

export const setReplyTo = (replyTo: Msg | null) => chatStore.set({ replyTo });
export const setEditing = (editingId: string | null) => chatStore.set({ editingId });

const REMOVED = { message: "Message deleted", chat: "Conversation deleted", all: "Every conversation deleted" };
let undoTimer = 0;

/** Delete at once, with a few seconds to undo, instead of asking first. A message takes everything after it. */
export function remove(what: Removal) {
  const { chats, currentId } = chatStore.state;
  let next =
    what.kind === "all"
      ? []
      : what.kind === "chat"
        ? chats.filter((c) => c.id !== what.id)
        : chats.map((c) => {
            const index = c.messages.findIndex((m) => m.id === what.id);
            return index < 0 ? c : { ...c, messages: c.messages.slice(0, index) };
          });
  if (!next.length) next = [blankChat()];
  const nextId = next.some((c) => c.id === currentId) ? currentId : next[0].id;
  commit({ chats: next, currentId: nextId, replyTo: null, editingId: null, undo: { label: REMOVED[what.kind], chats, currentId } });
  window.clearTimeout(undoTimer);
  undoTimer = window.setTimeout(() => chatStore.set({ undo: null }), UNDO_MS);
}

export function undo() {
  const { undo } = chatStore.state;
  if (!undo) return;
  window.clearTimeout(undoTimer);
  commit({ chats: undo.chats, currentId: undo.currentId, undo: null });
}
