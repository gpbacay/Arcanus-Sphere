"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { canListen, listen } from "@/modules/listen";
import { voice } from "@/modules/voice";
import { workspace } from "@/modules/workspace";
import { pane, pin } from "@/shared/pane";
import { power } from "@/shared/power";
import { useStore } from "@/shared/store";
import { COMMANDS, send, stop, talk, useBusy } from "./conversation";
import { Icon } from "./parts";
import { MAX, chatStore, setReplyTo } from "./store";

export const COMPOSER_ID = "arcanus-composer";

const yes = () => true;
const never = () => () => undefined;

export function Composer() {
  const replyTo = useStore(chatStore, (s) => s.replyTo);
  const voiceOn = !useStore(voice.state, (s) => s.off);
  const talking = useStore(listen.state, (s) => s.on);
  const hearing = useStore(listen.state, (s) => s.hearing);
  const writing = useStore(listen.state, (s) => s.writing);
  const problem = useStore(listen.state, (s) => s.problem);
  const partial = useStore(listen.state, (s) => s.partial);
  const micOk = useSyncExternalStore(never, canListen, yes);
  const busy = useBusy();
  const on = useStore(power, (s) => s.on);
  const skills = useStore(workspace, (s) => s.skills);
  const pinned = useStore(pane, (s) => s.pinned);
  const [draft, setDraft] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Typing "/" opens the command list, narrowed as you type; arrows pick, Tab completes, Enter runs.
  // Skills from .arcanus/skills are commands too.
  const commands = [...COMMANDS, ...skills.filter((s) => !COMMANDS.some((c) => c.name === `/${s.name}`)).map((s) => ({ name: `/${s.name}`, hint: s.description }))];
  const matches = /^\/[\w-]*$/.test(draft) ? commands.filter((c) => c.name.startsWith(draft.toLowerCase())) : [];
  const pick = Math.min(active, matches.length - 1);

  function submit(text = draft) {
    if (!send(text)) return;
    setDraft("");
    if (inputRef.current) inputRef.current.style.height = "auto";
  }

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
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
      {pinned ? (
        <div className="attachment">
          <span className="attachment-label">Reading</span>
          <p className="truncate" title={pinned.href ?? pinned.label}>
            {pinned.label}
          </p>
          <button type="button" className="icon-btn" aria-label={`Stop reading ${pinned.label}`} onClick={() => pin(null)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ) : null}
      {problem ? (
        <div className="attachment" role="alert">
          <p>{problem}</p>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => listen.state.set({ problem: "" })}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ) : null}
      {matches.length ? (
        <div className="commands" role="listbox" aria-label="Commands">
          {matches.map((c, i) => (
            <button
              key={c.name}
              type="button"
              role="option"
              aria-selected={i === pick}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => submit(c.name)}
            >
              <code>{c.name}</code>
              <span>{c.hint}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="composer-box" data-command={draft.startsWith("/") || undefined}>
        <textarea
          id={COMPOSER_ID}
          ref={inputRef}
          value={draft}
          maxLength={MAX}
          rows={2}
          placeholder={!on ? "Arcanus is off · type /run to start it" : !talking ? "Message Arcanus, or / for commands" : hearing ? partial || "Hearing you… I'll answer when you pause" : writing ? partial || "Writing down what you said…" : "Listening… just talk, or talk over Arcanus to interrupt"}
          aria-label="Message Arcanus or type a command"
          onChange={(e) => {
            setDraft(e.target.value);
            setActive(0);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          onKeyDown={(e) => {
            if (matches.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setActive((pick + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
            } else if (matches.length && e.key === "Tab") {
              e.preventDefault();
              setDraft(matches[pick].name);
            } else if (matches.length && e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(matches[pick].name);
            } else if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape" && replyTo) setReplyTo(null);
          }}
        />
        <div className="composer-bar">
          <button
            type="button"
            className="icon-btn"
            aria-pressed={voiceOn}
            aria-label={voiceOn ? "Turn voice off" : "Turn voice on"}
            title={voiceOn ? "Voice on" : "Voice off"}
            onClick={() => voice.setEnabled(!voiceOn)}
          >
            <Icon name={voiceOn ? "voice" : "mute"} />
          </button>
          <span className="count" data-warn={draft.length > MAX - 200}>
            {draft.length > MAX * 0.8 ? `${draft.length}/${MAX}` : null}
          </span>
          {/* One button, three jobs: stop a reply, send what is typed, or (nothing typed) start or end live voice chat. */}
          {draft.trim() ? (
            <button type="submit" className="send" aria-label="Send" title="Send (Enter)">
              <Icon name="send" />
            </button>
          ) : busy && !talking ? (
            <button type="button" className="send" data-stop aria-label="Stop" title="Stop" onClick={stop}>
              <Icon name="stop" />
            </button>
          ) : (
            <button
              type="button"
              className="send"
              data-recording={talking || undefined}
              aria-pressed={talking}
              aria-label={talking ? "End the voice conversation" : "Talk to Arcanus"}
              title={talking ? "End the voice conversation" : "Talk to Arcanus, hands-free"}
              disabled={!on || !micOk}
              onClick={talk}
            >
              <Icon name="live" />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
