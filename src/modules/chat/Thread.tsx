"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/shared/store";
import { ChainOfThoughtTrace } from "@/shared/ui/chain-of-thought";
import { Skeleton } from "@/shared/ui/skeleton";
import { discard, live, resend, retry, speak, useBusy } from "./conversation";
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
  }, [current?.messages]);

  if (!hydrated || !current) return <ThreadSkeleton />;
  const lastAssistant = current.messages.findLastIndex((m) => m.role === "assistant");

  return (
    <div className="thread" role="log" aria-label="Conversation">
      {current.messages.length === 0 && !writingHere ? (
        <div className="empty">
          <p className="empty-title">I&apos;m Arcanus.</p>
          <p>
            Everything I do runs in this browser: ARC 1 decides what you need, SmolVLM writes, Paradee speaks. Nothing you
            type leaves this device. Attach an image and I&apos;ll describe it.
          </p>
        </div>
      ) : null}
      {current.messages.map((message, index) => (
        <Message
          key={message.id}
          message={message}
          quote={message.replyToId ? current.messages.find((m) => m.id === message.replyToId) : undefined}
          editing={editingId === message.id}
          busy={busy}
          canRetry={message.role === "assistant" && index === lastAssistant}
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
    <article className="msg" data-role={message.role}>
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
              setText(message.text);
              setEditing(message.id);
            }}
          >
            Edit
          </button>
        ) : (
          <button type="button" onClick={() => speak(message.text)}>
            Speak
          </button>
        )}
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
