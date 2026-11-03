"use client";

import { useRef, useState, useSyncExternalStore, type ChangeEvent } from "react";
import { canListen, listen } from "@/modules/listen";
import { voice } from "@/modules/voice";
import { power } from "@/shared/power";
import { useStore } from "@/shared/store";
import { send, stop, talk, useBusy } from "./conversation";
import { Icon } from "./parts";
import { MAX, chatStore, setReplyTo } from "./store";

export const COMPOSER_ID = "arcanus-composer";

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

const yes = () => true;
const never = () => () => undefined;

export function Composer() {
  const replyTo = useStore(chatStore, (s) => s.replyTo);
  const voiceOn = !useStore(voice.state, (s) => s.off);
  const talking = useStore(listen.state, (s) => s.on);
  const hearing = useStore(listen.state, (s) => s.hearing);
  const writing = useStore(listen.state, (s) => s.writing);
  const problem = useStore(listen.state, (s) => s.problem);
  const micOk = useSyncExternalStore(never, canListen, yes);
  const busy = useBusy();
  const on = useStore(power, (s) => s.on);
  const [draft, setDraft] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function submit() {
    if (!send(draft, image)) return;
    setDraft("");
    setImage(null);
    if (inputRef.current) inputRef.current.style.height = "auto";
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
      {problem ? (
        <div className="attachment" role="alert">
          <p>{problem}</p>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => listen.state.set({ problem: "" })}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ) : null}
      <div className="composer-box">
        <textarea
          id={COMPOSER_ID}
          ref={inputRef}
          value={draft}
          maxLength={MAX}
          rows={2}
          placeholder={!on ? "Arcanus is off" : !talking ? "Message Arcanus" : hearing ? "Hearing you… I'll answer when you pause" : writing ? "Writing down what you said…" : "Listening… just talk, or talk over Arcanus to interrupt"}
          aria-label="Message Arcanus"
          disabled={!on}
          onChange={(e) => {
            setDraft(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape" && replyTo) setReplyTo(null);
          }}
        />
        <div className="composer-bar">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={attach} />
          <button type="button" className="icon-btn" aria-label="Attach an image" title="Attach an image" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Icon name="image" />
          </button>
          {micOk ? (
            <button
              type="button"
              className="icon-btn"
              data-recording={talking || undefined}
              aria-pressed={talking}
              aria-label={talking ? "End the voice conversation" : "Talk to Arcanus"}
              title={talking ? "End the voice conversation" : "Talk to Arcanus, hands-free"}
              disabled={!on}
              onClick={talk}
            >
              <Icon name="mic" />
            </button>
          ) : null}
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
            {draft.length}/{MAX}
          </span>
          {busy ? (
            <button type="button" className="send" data-stop aria-label="Stop" title="Stop" onClick={stop}>
              <Icon name="stop" />
            </button>
          ) : (
            <button type="submit" className="send" aria-label="Send" title="Send (Enter)" disabled={!on || (!draft.trim() && !image)}>
              <Icon name="send" />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
