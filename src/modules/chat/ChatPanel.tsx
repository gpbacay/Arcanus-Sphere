"use client";

import { useEffect, useId, useRef, useState } from "react";
import { llm } from "@/modules/llm";
import { useOnline } from "@/modules/offline";
import { voice } from "@/modules/voice";
import { power } from "@/shared/power";
import { useStore } from "@/shared/store";
import { MessageSquare } from "lucide-react";
import { Sidebar, useSidebar } from "@/shared/ui/sidebar";
import { COMPOSER_ID, Composer } from "./Composer";
import { discard, send, useBusy } from "./conversation";
import { Icon } from "./parts";
import { Thread } from "./Thread";
import { chatStore, newChat, rename, select, selectCurrent, undo } from "./store";

const SUGGESTIONS = ["Who are you?", "What time is it?", "What's (12 + 8) * 3?", "Write a haiku about the sea"];

type Mood = "off" | "ready" | "thinking" | "speaking";

/** The chat: each part below reads its own data, so a streamed token or a loading model re-renders only its part. */
export function ChatPanel() {
  const { isMobile } = useSidebar();
  const [collapsed, setCollapsed] = useState(false);
  // Phone opens on the sphere. The chat row only exists while this panel is open.
  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) setCollapsed(true);
  }, []);
  const busy = useBusy();
  const on = useStore(power, (s) => s.on);
  const speaking = useStore(voice.state, (s) => s.speaking);
  const mood: Mood = !on ? "off" : busy ? "thinking" : speaking ? "speaking" : "ready";

  if (collapsed) {
    return (
      // Minimized: only the header stays, docked on the bottom edge at the pane's full width.
      <aside className="rail" aria-label="Arcanus chat (minimized)">
        <Header mood={mood} collapsed onToggle={() => setCollapsed(false)} />
      </aside>
    );
  }

  const body = (
    <>
      <Header mood={mood} onToggle={() => setCollapsed(true)} />
      <Thread />
      <UndoBar />
      <Suggestions />
      <Composer />
    </>
  );

  if (isMobile) {
    return (
      <aside className="panel" aria-label="Arcanus chat">
        {body}
      </aside>
    );
  }
  return (
    <Sidebar side="right" variant="floating" collapsible="offcanvas">
      <div className="panel panel-docked" role="complementary" aria-label="Arcanus chat">
        {body}
      </div>
    </Sidebar>
  );
}

/** What the chat shows when it crashed: the sphere and the models keep running behind it. */
export function ChatFallback() {
  return (
    <aside className="panel panel-fallback" role="alert">
      <p>The chat stopped working. Your conversations are saved on this device.</p>
      <button type="button" className="btn" onClick={() => location.reload()}>
        Reload
      </button>
    </aside>
  );
}

function useStatusText(mood: Mood) {
  const online = useOnline();
  const model = useStore(llm.state, (s) => s.status);
  const saved = useStore(chatStore, (s) => s.saved);
  const note = saved === "none" ? " · can't save on this device" : "";
  const text =
    mood === "off"
      ? "Off · type /run to switch Arcanus on"
      : mood === "thinking"
      ? "Thinking on this device"
      : mood === "speaking"
        ? "Speaking"
        : model === "ready"
          ? online ? "Ready · runs on this device" : "Offline · still runs on this device"
          : model === "error"
            ? online ? "SmolLM2 didn't load · time, math and facts still work" : "Offline · connect once so the models can download"
            : online ? "Loading models · you can send now" : "Offline · loading models from this device";
  return text + note;
}

function Header({ mood, collapsed = false, onToggle }: { mood: Mood; collapsed?: boolean; onToggle: () => void }) {
  const menuId = useId();
  const current = useStore(chatStore, selectCurrent);
  const chats = useStore(chatStore, (s) => s.chats);
  const status = useStatusText(mood);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const shown = chats.filter((c) => c.title.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  function pick(id: string) {
    select(id);
    setRenaming(false);
    setMenuOpen(false);
  }

  function startNew() {
    newChat();
    setRenaming(false);
    setMenuOpen(false);
    document.getElementById(COMPOSER_ID)?.focus();
  }

  function commitRename() {
    rename(renameValue);
    setRenaming(false);
  }

  return (
    <header className="panel-head">
      <span className="brand-logo" data-state={mood} style={{ width: 22, height: 22 }} aria-hidden>
        <MessageSquare size={22} />
      </span>
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
          <button type="button" className="title-btn" aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuId} onClick={() => setMenuOpen((v) => !v)}>
            <span className="truncate">{current?.title ?? "Arcanus"}</span>
            <Icon name="chevron" size={14} />
          </button>
        )}
        <p className="panel-status">{status}</p>
        {menuOpen ? (
          <div id={menuId} role="menu" className="menu" onKeyDown={(e) => e.key === "Escape" && setMenuOpen(false)}>
            <input className="field" value={query} placeholder="Search conversations" aria-label="Search conversations" autoFocus onChange={(e) => setQuery(e.target.value)} />
            <div className="menu-list">
              {shown.map((chat) => (
                <button key={chat.id} type="button" role="menuitem" className="menu-item" onClick={() => pick(chat.id)}>
                  <span className="truncate">{chat.title}</span>
                  {chat.id === current?.id ? <Icon name="check" size={14} /> : null}
                </button>
              ))}
              {!shown.length ? <p className="menu-empty">No conversation matches.</p> : null}
            </div>
            <div className="menu-sep" />
            <button type="button" role="menuitem" className="menu-item" onClick={startNew}>
              New conversation
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu-item danger"
              onClick={() => {
                setMenuOpen(false);
                discard({ kind: "all" });
              }}
            >
              Delete every conversation
            </button>
          </div>
        ) : null}
      </div>
      <button type="button" className="icon-btn" aria-label="New conversation" title="New conversation" onClick={startNew}>
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
        onClick={() => current && discard({ kind: "chat", id: current.id })}
      >
        <Icon name="trash" />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label={collapsed ? "Expand chat" : "Minimize chat"}
        title={collapsed ? "Expand chat" : "Minimize chat"}
        onClick={onToggle}
      >
        <Icon name={collapsed ? "up" : "down"} />
      </button>
    </header>
  );
}

/** Deletes apply at once; this is the way back, for a few seconds. */
function UndoBar() {
  const pending = useStore(chatStore, (s) => s.undo);
  if (!pending) return null;
  return (
    <div className="undo" role="status">
      <p>{pending.label}</p>
      <button type="button" className="btn" onClick={undo}>
        Undo
      </button>
    </div>
  );
}

function Suggestions() {
  const empty = useStore(chatStore, (s) => !selectCurrent(s)?.messages.some((m) => m.role === "user"));
  const busy = useBusy();
  const on = useStore(power, (s) => s.on);
  if (on && (!empty || busy)) return null;
  return (
    <div className="suggestions">
      {(on ? SUGGESTIONS : ["/run"]).map((s) => (
        <button key={s} type="button" className="chip" onClick={() => send(s)}>
          {s}
        </button>
      ))}
    </div>
  );
}
