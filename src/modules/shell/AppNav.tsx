"use client";

import { FolderOpen, Globe, Info, Settings, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { pane, togglePane } from "@/shared/pane";
import { useStore } from "@/shared/store";
import { Logo } from "@/shared/ui/logo";
import { voice } from "@/modules/voice";

type DialogName = "about" | "settings";

/** Left rail: the mark, Arcanus's files and browser (side panes), then About and Settings (dialogs). */
export function AppNav() {
  const [open, setOpen] = useState<DialogName | null>(null);
  const side = useStore(pane, (s) => s.open);
  return (
    <nav className="app-nav" aria-label="Arcanus">
      <div className="app-nav-brand" title="Arcanus">
        <Logo size={26} />
      </div>
      <button type="button" className="app-nav-btn" aria-label="Files" title="Files" aria-expanded={side === "files"} onClick={() => togglePane("files")}>
        <FolderOpen size={17} aria-hidden />
      </button>
      <button type="button" className="app-nav-btn" aria-label="Browser" title="Browser" aria-expanded={side === "browser"} onClick={() => togglePane("browser")}>
        <Globe size={17} aria-hidden />
      </button>
      <div className="app-nav-gap" />
      <button type="button" className="app-nav-btn" aria-label="About" title="About" aria-expanded={open === "about"} aria-haspopup="dialog" onClick={() => setOpen("about")}>
        <Info size={17} aria-hidden />
      </button>
      <button type="button" className="app-nav-btn" aria-label="Settings" title="Settings" aria-expanded={open === "settings"} aria-haspopup="dialog" onClick={() => setOpen("settings")}>
        <Settings size={17} aria-hidden />
      </button>
      {open === "about" ? <AboutDialog onClose={() => setOpen(null)} /> : null}
      {open === "settings" ? <SettingsDialog onClose={() => setOpen(null)} /> : null}
    </nav>
  );
}

function AppDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="app-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => event.target === dialog.current && dialog.current.close()}
    >
      <div className="app-dialog-head">
        <Logo size={20} />
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={() => dialog.current?.close()}>
          <X size={16} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <AppDialog title="About Arcanus" onClose={onClose}>
      <p>Arcanus is a local assistant created by Gianne Bacay. It answers in this browser, speaks the reply, and the sphere moves with the voice.</p>
      <ul>
        <li>Hippocampus decides what a message needs.</li>
        <li>SmolLM2 writes the reply on this device.</li>
        <li>Paradee speaks it. The sphere reacts to that audio.</li>
        <li>Messages stay here. Models download once and are cached.</li>
        <li>Its own files live in .arcanus/: instructions, skills, memory and artifacts.</li>
        <li>Its browser reads the web only when you browse or ask it to look something up.</li>
      </ul>
    </AppDialog>
  );
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const speak = useStore(voice.state, (s) => !s.off);
  return (
    <AppDialog title="Settings" onClose={onClose}>
      <label className="voice-row">
        <span>
          <span className="setting-label">Speak replies</span>
          <span className="setting-note">Paradee reads each answer aloud.</span>
        </span>
        <input type="checkbox" checked={speak} onChange={(event) => voice.setEnabled(event.target.checked)} />
      </label>
    </AppDialog>
  );
}
