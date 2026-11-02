"use client";

// Talking to Arcanus in AR. Built to stay out of the way of the camera view: the resting state is one round mic button
// at the bottom, Arcanus's reply floats as a small translucent caption that fades on its own, and the text box only
// opens when asked. Speech is hands-free: tap the mic, talk, and it sends when you pause.
import { Keyboard } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { canListen, listen } from "@/modules/listen";
import { llm } from "@/modules/llm";
import { voice } from "@/modules/voice";
import { useStore } from "@/shared/store";
import { greeting, live, send, stop, useBusy } from "./conversation";
import { Icon } from "./parts";
import { MAX, chatStore, selectCurrent } from "./store";

const FADE_MS = 9000; // how long a finished reply stays up
const yes = () => true;
const never = () => () => undefined;

const lastText = (role: "user" | "assistant") => (s: typeof chatStore.state) => selectCurrent(s)?.messages.findLast((m) => m.role === role)?.text ?? "";

export function ArChat() {
  const busy = useBusy();
  const speaking = useStore(voice.state, (s) => s.speaking);
  const phase = useStore(listen.state, (s) => s.phase);
  const heard = useStore(listen.state, (s) => s.heard);
  const problem = useStore(listen.state, (s) => s.problem);
  const model = useStore(llm.state, (s) => s.status);
  const pct = useStore(llm.state, (s) => (s.total ? Math.min(99, Math.round((s.loaded / s.total) * 100)) : 0));
  const liveText = useStore(live, (s) => s.reply?.text ?? "");
  const greeted = useStore(greeting, (s) => s.text);
  const lastReply = useStore(chatStore, lastText("assistant"));
  const lastAsk = useStore(chatStore, lastText("user"));
  const micOk = useSyncExternalStore(never, canListen, yes);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // The caption shows while Arcanus works or speaks, then fades after a few seconds. Tapping it clears it.
  const working = busy || speaking || phase !== "idle";
  useEffect(() => {
    if (working || liveText || greeted) return setVisible(true);
    const timer = setTimeout(() => setVisible(false), FADE_MS);
    return () => clearTimeout(timer);
  }, [working, liveText, lastReply, greeted]);

  useEffect(() => {
    if (typing) inputRef.current?.focus();
  }, [typing]);

  // Leaving the page (or the AR view) must never leave the microphone open.
  useEffect(() => () => listen.cancel(), []);

  function talk() {
    voice.unlock(); // inside the tap, so the browser lets Arcanus's voice play later
    if (phase === "recording") return listen.stop();
    if (busy) stop();
    voice.cancel(); // so Arcanus doesn't hear itself
    void listen.record((text) => {
      if (text) send(text);
    });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (send(draft)) {
      setDraft("");
      setTyping(false);
    }
  }

  const status =
    phase === "recording" ? (heard ? "Listening… I'll answer when you pause" : "Listening…") : phase === "transcribing" ? "Writing down what you said…" : "";
  const loading = model === "loading" || model === "idle";
  const caption = busy ? liveText || "Thinking…" : greeted || lastReply;

  return (
    <div className="arc" data-recording={phase === "recording" || undefined}>
      {visible && caption && !status ? (
        <button type="button" className="arc-caption" aria-live="polite" onClick={() => setVisible(false)}>
          {busy && lastAsk ? <span className="arc-ask">{lastAsk}</span> : null}
          <span>{caption}</span>
        </button>
      ) : null}
      {status || problem ? (
        <p className="arc-status" role={problem ? "alert" : "status"} data-warn={problem ? true : undefined}>
          {problem || status}
        </p>
      ) : loading && !visible ? (
        <p className="arc-status" role="status">
          Waking up{pct ? ` · ${pct}%` : "…"} · you can still talk
        </p>
      ) : null}

      <form className="arc-dock" onSubmit={submit}>
        {typing ? (
          <>
            <input
              ref={inputRef}
              className="arc-input"
              value={draft}
              maxLength={MAX}
              placeholder="Message Arcanus"
              aria-label="Message Arcanus"
              enterKeyHint="send"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setTyping(false)}
            />
            <button type="submit" className="arc-btn" aria-label="Send" disabled={!draft.trim() || busy}>
              <Icon name="send" size={18} />
            </button>
            <button type="button" className="arc-btn" aria-label="Close the keyboard" onClick={() => setTyping(false)}>
              <Icon name="close" size={18} />
            </button>
          </>
        ) : (
          <>
            <button type="button" className="arc-btn" aria-label="Type a message" title="Type a message" onClick={() => setTyping(true)}>
              <Keyboard size={20} aria-hidden />
            </button>
            {micOk ? (
              <button
                type="button"
                className="arc-mic"
                data-recording={phase === "recording" || undefined}
                aria-pressed={phase === "recording"}
                aria-label={phase === "recording" ? "Finish speaking" : "Talk to Arcanus"}
                disabled={phase === "transcribing"}
                onClick={talk}
              >
                <Icon name="mic" size={26} />
              </button>
            ) : null}
            {busy || speaking ? (
              <button type="button" className="arc-btn" aria-label="Stop" title="Stop" onClick={stop}>
                <Icon name="stop" size={18} />
              </button>
            ) : (
              <span className="arc-btn arc-spacer" aria-hidden />
            )}
          </>
        )}
      </form>
    </div>
  );
}
