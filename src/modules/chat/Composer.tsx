"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { canListen, listen } from "@/modules/listen";
import { voice } from "@/modules/voice";
import { fileCatalog, fileNames, ide, shortPath, workspace } from "@/modules/workspace";
import { pane, pin, shownAt } from "@/shared/pane";
import { power } from "@/shared/power";
import { useStore } from "@/shared/store";
import { COMMANDS, attach, detach, held, send, stop, talk, useBusy } from "./conversation";
import { mentionQuery, rankFiles, withoutMention } from "./mention";
import { Icon } from "./parts";
import { MAX, chatStore, setReplyTo } from "./store";

export const COMPOSER_ID = "arcanus-composer";

const yes = () => true;
const never = () => () => undefined;

function Reading({ label, title, onClose }: { label: string; title?: string; onClose: () => void }) {
  return (
    <div className="attachment">
      <span className="attachment-label">Reading</span>
      <p className="truncate" title={title ?? label}>
        {label}
      </p>
      <button type="button" className="icon-btn" aria-label={`Stop reading ${label}`} onClick={onClose}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

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
  const front = useStore(ide, (s) => (s.focus ? s.activeRight : s.active));
  const openKey = useStore(ide, (s) => s.tabs.map((t) => t.path).join("\0"));
  const running = useStore(pane, (s) => (shownAt(s, "artifacts") && /\.html?$/i.test(s.artifact) ? s.artifact : ""));
  const files = useStore(held, (s) => s.files);
  const quiet = useStore(held, (s) => s.quiet);
  const [draft, setDraft] = useState("");
  const [cursor, setCursor] = useState(0);
  const [active, setActive] = useState(0);
  const [mentionClosed, setMentionClosed] = useState(false);
  const listed = useStore(fileCatalog, (s) => s);
  // Typing "/" opens the command list, narrowed as you type; arrows pick, Tab completes, Enter runs.
  // Typing "@" attaches a file the same way. Skills from .arcanus/skills are commands too.
  const commands = [...COMMANDS, ...skills.filter((s) => !COMMANDS.some((c) => c.name === `/${s.name}`)).map((s) => ({ name: `/${s.name}`, hint: s.description }))];
  const matches = /^\/[\w-]*$/.test(draft) ? commands.filter((c) => c.name.startsWith(draft.toLowerCase())) : [];
  const pick = Math.min(active, matches.length - 1);
  const query = mentionQuery(draft, cursor);
  const choosingFile = query !== null && !mentionClosed;
  const open = openKey ? openKey.split("\0") : [];
  const hits = choosingFile && listed.ready ? rankFiles([...new Set([...open, ...listed.paths])], query ?? "", open) : null;
  const filePick = Math.min(active, Math.max((hits?.length ?? 1) - 1, 0));
  const covers = (label: string) => !!pinned && !pinned.href && (pinned.label === label || pinned.label.endsWith(`/${label}`) || label.endsWith(`/${pinned.label}`));

  useEffect(() => {
    if (choosingFile && !listed.ready) void fileNames();
  }, [choosingFile, listed.ready]);

  function field() {
    const el = document.getElementById(COMPOSER_ID);
    return el instanceof HTMLTextAreaElement ? el : null;
  }

  function submit(text = draft) {
    if (!send(text)) return;
    setDraft("");
    setCursor(0);
    const el = field();
    if (el) el.style.height = "auto";
  }

  function takeFile(path: string) {
    attach(path);
    const next = withoutMention(draft, cursor);
    setDraft(next.text);
    setCursor(next.cursor);
    setActive(0);
    setMentionClosed(true);
    requestAnimationFrame(() => {
      const el = field();
      if (!el) return;
      el.setSelectionRange(next.cursor, next.cursor);
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    });
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
        <Reading label={pinned.label} title={pinned.href ?? pinned.label} onClose={() => pin(null)} />
      ) : null}
      {files
        .filter((path) => !covers(path))
        .map((path) => (
          <Reading key={path} label={shortPath(path)} title={path} onClose={() => detach(path)} />
        ))}
      {front && !quiet.includes(front) && !files.includes(front) && !covers(front) ? (
        <Reading label={shortPath(front)} title={front} onClose={() => detach(front, ...(running && front.endsWith(`/${running}`) ? [running] : []))} />
      ) : null}
      {running && !front.endsWith(`/${running}`) && !quiet.includes(running) && !covers(running) && !files.some((path) => path.endsWith(`/${running}`)) ? (
        <Reading label={running} title={running} onClose={() => detach(running)} />
      ) : null}
      {problem ? (
        <div className="attachment" role="alert">
          <p>{problem}</p>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => listen.state.set({ problem: "" })}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ) : null}
      {choosingFile ? (
        <div className="commands" role="listbox" aria-label="Files">
          {hits === null ? (
            <p>Looking through your files…</p>
          ) : hits.length === 0 ? (
            <p>No file with that name</p>
          ) : (
            hits.map((path, i) => {
              const name = path.split("/").pop() ?? path;
              const where = shortPath(path);
              const dir = where.endsWith(name) ? where.slice(0, -name.length).replace(/\/$/, "") : where;
              return (
                <button
                  key={path}
                  type="button"
                  role="option"
                  aria-selected={i === filePick}
                  title={where}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => takeFile(path)}
                >
                  <code>{name}</code>
                  {dir ? <span>{dir}</span> : null}
                </button>
              );
            })
          )}
        </div>
      ) : matches.length ? (
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
          value={draft}
          maxLength={MAX}
          rows={1}
          placeholder={!on ? "Arcanus is off · type /run to start it" : !talking ? "Message Arcanus, @ a file, or / for commands" : hearing ? partial || "Hearing you… I'll answer when you pause" : writing ? partial || "Writing down what you said…" : "Listening… just talk, or talk over Arcanus to interrupt"}
          aria-label="Message Arcanus, attach a file with @, or type a command"
          onChange={(e) => {
            setDraft(e.target.value);
            setCursor(e.target.selectionStart ?? e.target.value.length);
            setActive(0);
            setMentionClosed(false);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          onSelect={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={(e) => {
            if (choosingFile && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              if (hits?.length) setActive((filePick + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length);
            } else if (choosingFile && hits?.length && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))) {
              e.preventDefault();
              takeFile(hits[filePick]);
            } else if (choosingFile && !hits && e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
            } else if (choosingFile && e.key === "Escape") {
              e.preventDefault();
              setMentionClosed(true);
            } else if (matches.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
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
