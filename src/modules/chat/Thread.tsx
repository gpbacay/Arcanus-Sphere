"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/shared/store";
import { ChainOfThoughtTrace, type ThoughtStep } from "@/shared/ui/chain-of-thought";
import { Skeleton } from "@/shared/ui/skeleton";
import { booting, discard, live, resend, retry, speak, useBusy } from "./conversation";
import { MAX, chatStore, selectCurrent, setEditing, setReplyTo, type Msg } from "./store";

const clock = (at: number) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(at);

/** The conversation's shape while saved chats are read: two of yours, one of Arcanus's. */
function ThreadSkeleton() {
  return (
    <div className="thread" aria-busy="true" aria-label="Loading conversation">
      {(
        [
          ["user", 180, 34],
          ["assistant", "85%", 64],
          ["user", 120, 34],
        ] as const
      ).map(([role, width, height], i) => (
        <div key={i} className="msg" data-role={role}>
          <Skeleton className="skeleton" style={{ width, height }} />
        </div>
      ))}
    </div>
  );
}

export function Thread() {
  const hydrated = useStore(chatStore, (s) => s.hydrated);
  const current = useStore(chatStore, selectCurrent);
  const editingId = useStore(chatStore, (s) => s.editingId);
  const writingHere = useStore(live, (s) => Boolean(s.reply && s.reply.chatId === current?.id));
  const busy = useBusy();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [current?.messages, writingHere]);

  if (!hydrated || !current) return <ThreadSkeleton />;
  const lastAssistant = current.messages.findLastIndex((m) => m.role === "assistant");

  return (
    <div className="thread" role="log" aria-label="Conversation">
      {current.messages.map((message, index) => (
        <Message
          key={message.id}
          message={message}
          quote={message.replyToId ? current.messages.find((m) => m.id === message.replyToId) : undefined}
          editing={editingId === message.id}
          busy={busy}
          canRetry={message.role === "assistant" && index === lastAssistant && !message.kind}
        />
      ))}
      <LiveReply chatId={current.id} />
      <div ref={endRef} />
    </div>
  );
}

function Message({ message, quote, editing, busy, canRetry }: { message: Msg; quote?: Msg; editing: boolean; busy: boolean; canRetry: boolean }) {
  const [text, setText] = useState(message.text);

  if (editing) {
    return (
      <article className="msg" data-role={message.role}>
        <div className="edit">
          <textarea
            className="field"
            value={text}
            maxLength={MAX}
            aria-label="Edit message"
            autoFocus
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                resend(message.id, text);
              } else if (e.key === "Escape") setEditing(null);
            }}
          />
          <div className="row">
            <span className="count">
              {text.length}/{MAX}
            </span>
            <button type="button" className="btn btn-primary" onClick={() => resend(message.id, text)}>
              Save and resend
            </button>
            <button type="button" className="btn" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="msg" data-role={message.role} data-kind={message.kind}>
      {quote ? <p className="msg-quote">{quote.text}</p> : null}
      {message.kind === "boot" ? (
        <BootTrace id={message.id} saved={message.trace} />
      ) : message.role === "assistant" && message.trace?.length ? (
        <div className="msg-trace">
          <ChainOfThoughtTrace
            label={message.kind === "command" ? `Models · ${modelCount(message.trace)}` : `How Arcanus decided · ${message.trace.length} steps`}
            steps={message.trace}
          />
        </div>
      ) : null}
      {message.text ? <div className="msg-bubble">{message.text}</div> : null}
      <div className="msg-actions">
        <time dateTime={new Date(message.at).toISOString()}>{clock(message.at)}</time>
        {message.kind === "command" ? null : (
          <button type="button" disabled={busy} onClick={() => setReplyTo(message)}>
            Reply
          </button>
        )}
        {message.kind === "command" ? null : message.role === "user" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setText(message.text);
              setEditing(message.id);
            }}
          >
            Edit
          </button>
        ) : message.text ? (
          <button type="button" onClick={() => speak(message.text)}>
            Speak
          </button>
        ) : null}
        <button type="button" disabled={busy} onClick={() => discard({ kind: "message", id: message.id })}>
          Delete
        </button>
        {canRetry ? (
          <button type="button" disabled={busy} onClick={retry}>
            Retry
          </button>
        ) : null}
      </div>
    </article>
  );
}

const modelCount = (steps: ThoughtStep[]) => {
  const ready = steps.filter((s) => s.results?.[0] === "ready" || s.results?.[0] === "WebGPU").length;
  const failed = steps.filter((s) => s.results?.[0] === "failed").length;
  return `${ready}/${steps.length} ready${failed ? ` · ${failed} failed` : ""}`;
};

/** The boot log on Arcanus's introduction: held open and live while the models load, then folded away like any trace. */
function BootTrace({ id, saved }: { id: string; saved?: ThoughtStep[] }) {
  const steps = useStore(booting, (s) => (s.id === id ? s.steps : null));
  const shown = steps ?? saved;
  if (!shown?.length) return null;
  const loading = steps !== null;
  const done = shown.filter((s) => !s.status).length;
  return (
    <div className="msg-trace">
      <ChainOfThoughtTrace
        label={loading ? `Initializing Arcanus · ${done}/${shown.length} models` : `Boot log · ${modelCount(shown)}`}
        steps={shown}
        thinking={loading}
        open={loading || undefined}
      />
    </div>
  );
}

/** The reply being written. The only part of the thread that re-renders per token. */
function LiveReply({ chatId }: { chatId: string }) {
  const reply = useStore(live, (s) => s.reply);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    ref.current?.scrollIntoView({ block: "end" });
  }, [reply?.text]);

  if (!reply || reply.chatId !== chatId) return null;
  return (
    <article ref={ref} className="msg" data-role="assistant" aria-busy="true">
      <div className="msg-trace">
        <ChainOfThoughtTrace label="Arcanus is thinking" steps={reply.trace} thinking open />
      </div>
      {reply.text ? (
        <div className="msg-bubble">
          {reply.text}
          <span className="caret" aria-hidden />
        </div>
      ) : null}
    </article>
  );
}
