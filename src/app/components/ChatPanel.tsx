"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AgentStep } from "@/lib/types";

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps?: AgentStep[];
  model?: string;
  thought?: string;
}

export interface LiveAgentState {
  status: string;
  thought: string;
  answer: string;
  tools: { toolName: string; content: string }[];
}

interface ChatPanelProps {
  messages: UiMessage[];
  isThinking: boolean;
  isSpeaking: boolean;
  ttsEnabled: boolean;
  onToggleTts: () => void;
  onSend: (text: string) => void;
  error: string | null;
  modelLabel?: string | null;
  live?: LiveAgentState | null;
}

function shortModel(label?: string | null) {
  if (!label) return "router";
  const leaf = label.split("/").pop() || label;
  return leaf.length > 28 ? `${leaf.slice(0, 26)}…` : leaf;
}

function ThoughtBlock({
  text,
  live,
  defaultOpen,
}: {
  text: string;
  live?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen || live));
  useEffect(() => {
    if (live) setOpen(true);
  }, [live, text]);

  if (!text.trim()) return null;

  return (
    <div className="cot-block" data-live={live ? "true" : "false"}>
      <button
        type="button"
        className="cot-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        <span>chain of thought</span>
        <span>{open ? "−" : "+"}</span>
      </button>
      {open && <pre className="cot-body">{text}</pre>}
    </div>
  );
}

export default function ChatPanel({
  messages,
  isThinking,
  isSpeaking,
  ttsEnabled,
  onToggleTts,
  onSend,
  error,
  modelLabel,
  live,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isThinking, live?.thought, live?.answer, live?.tools.length]);

  const status = isSpeaking ? "speaking" : isThinking ? "thinking" : "ready";
  const statusLabel = (live?.status || status).toUpperCase();
  const activeModel = useMemo(() => {
    const fromMsg = [...messages].reverse().find((m) => m.model)?.model;
    return shortModel(fromMsg || modelLabel);
  }, [messages, modelLabel]);

  const toolCount = useMemo(
    () =>
      messages.reduce(
        (n, m) => n + (m.steps?.filter((s) => s.type === "tool").length || 0),
        0
      ),
    [messages]
  );

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || isThinking) return;
    setInput("");
    if (taRef.current) taRef.current.style.height = "64px";
    onSend(text);
  };

  return (
    <div className="app-chrome" data-collapsed={collapsed ? "true" : "false"}>
      <header className="app-topbar">
        <div className="app-brand">
          <span className="app-brand-mark" data-state={status} />
          <span className="app-brand-title">Arcanus</span>
          <span className="app-brand-sub">agent · rag · cot</span>
        </div>
        <div className="app-meta">
          <span className="meta-chip" data-active={status !== "ready"}>
            {statusLabel}
          </span>
          <span className="meta-chip" title={modelLabel || activeModel}>
            {activeModel}
          </span>
          <span className="meta-chip">tools {toolCount}</span>
          <span className="meta-chip" data-active={ttsEnabled}>
            <button type="button" onClick={onToggleTts}>
              tts {ttsEnabled ? "on" : "off"}
            </button>
          </span>
          <button
            type="button"
            className="icon-btn mobile-open"
            onClick={() => setCollapsed(false)}
            aria-label="Open panel"
          >
            ▤
          </button>
        </div>
      </header>

      {collapsed ? (
        <aside className="sidebar-collapsed-rail">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setCollapsed(false)}
            aria-label="Expand panel"
            title="Expand"
          >
            »
          </button>
          <span
            className="app-brand-mark"
            data-state={status}
            style={{ marginTop: 4 }}
          />
        </aside>
      ) : (
        <aside className="sidebar">
          <div className="sidebar-head">
            <h2>Agent</h2>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setCollapsed(true)}
                aria-label="Collapse panel"
                title="Collapse"
              >
                «
              </button>
            </div>
          </div>

          <div ref={listRef} className="sidebar-thread">
            {messages.length === 0 && !isThinking && (
              <div className="empty-state">
                Streaming agent with live chain-of-thought. Tools + RAG run
                when needed; simple asks take the fast path.
                <br />
                <br />
                Try: <code>What is Arcanus?</code>
              </div>
            )}

            {messages.map((m) => {
              const tools = m.steps?.filter((s) => s.type === "tool") || [];
              const thought =
                m.thought ||
                m.steps
                  ?.filter((s) => s.type === "thought")
                  .map((s) => s.content)
                  .join("\n") ||
                "";
              return (
                <article key={m.id} className="msg" data-role={m.role}>
                  <div className="msg-meta">
                    <span>{m.role === "user" ? "you" : "arcanus"}</span>
                    {m.model && <span>{shortModel(m.model)}</span>}
                  </div>
                  {m.role === "assistant" && thought && (
                    <ThoughtBlock text={thought} />
                  )}
                  {m.content && <div className="msg-body">{m.content}</div>}
                  {tools.length > 0 && (
                    <div className="tool-row">
                      {tools.map((s, i) => (
                        <div key={i} className="tool-chip" title={s.content}>
                          › {s.toolName}
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}

            {isThinking && live && (
              <article className="msg" data-role="assistant" data-live="true">
                <div className="msg-meta">
                  <span>arcanus</span>
                  <span>{live.status || "thinking"}</span>
                </div>
                <ThoughtBlock text={live.thought} live defaultOpen />
                {live.tools.map((t, i) => (
                  <div key={i} className="tool-chip" title={t.content}>
                    › {t.toolName}
                  </div>
                ))}
                {live.answer && <div className="msg-body">{live.answer}</div>}
                {!live.answer && (
                  <div className="thinking-row">{live.status || "working…"}</div>
                )}
              </article>
            )}
          </div>

          {error && <div className="error-banner">{error}</div>}

          <form className="composer" onSubmit={submit}>
            <div className="composer-box">
              <textarea
                ref={taRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  const el = e.target;
                  el.style.height = "64px";
                  el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
                }}
                placeholder="Message Arcanus…  Enter to send · Shift+Enter newline"
                rows={3}
                disabled={isThinking}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              <div className="composer-toolbar">
                <div className="composer-actions">
                  <button
                    type="button"
                    className="btn"
                    data-active={ttsEnabled}
                    onClick={onToggleTts}
                  >
                    tts
                  </button>
                  <span className="meta-chip" style={{ border: 0, padding: 0 }}>
                    {messages.length} msg
                  </span>
                </div>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isThinking || !input.trim()}
                >
                  send
                </button>
              </div>
            </div>
          </form>
        </aside>
      )}
    </div>
  );
}
