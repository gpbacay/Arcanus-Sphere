"use client";

import { Info, Settings, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { applyTheme, theme, type Theme } from "@/shared/theme";
import { useStore } from "@/shared/store";
import { Logo } from "@/shared/ui/logo";
import { voice } from "@/modules/voice";

type DialogName = "about" | "settings";

/** Left rail: the mark, About, and Settings. Both pages are dialogs, so the sphere stays on screen. */
export function AppNav() {
  const [open, setOpen] = useState<DialogName | null>(null);
  return (
    <nav className="app-nav" aria-label="Arcanus">
      <div className="app-nav-brand">
        <Logo size={32} />
        <span className="app-nav-name">Arcanus</span>
      </div>
      <div className="app-nav-gap" />
      <button type="button" className="app-nav-btn" aria-expanded={open === "about"} aria-haspopup="dialog" onClick={() => setOpen("about")}>
        <Info size={18} aria-hidden />
        <span>About</span>
      </button>
      <button type="button" className="app-nav-btn" aria-expanded={open === "settings"} aria-haspopup="dialog" onClick={() => setOpen("settings")}>
        <Settings size={18} aria-hidden />
        <span>Settings</span>
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
        <Logo size={28} />
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
        <li>ARC 1 decides what a message needs.</li>
        <li>SmolVLM writes the reply on this device.</li>
        <li>Paradee speaks it. The sphere reacts to that audio.</li>
        <li>Messages stay here. Models download once and are cached.</li>
      </ul>
    </AppDialog>
  );
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const mode = useStore(theme, (s) => s.mode);
  const speak = useStore(voice.state, (s) => !s.off);
  return (
    <AppDialog title="Settings" onClose={onClose}>
      <div className="setting">
        <span className="setting-label" id="appearance-label">
          Appearance
        </span>
        <div className="choices" role="group" aria-labelledby="appearance-label">
          <ThemeChoice mode="dark" current={mode} label="Dark" />
          <ThemeChoice mode="light" current={mode} label="Light" />
        </div>
        <p className="setting-note">Panels follow this choice. The sphere stays on a dark stage so the orb stays visible.</p>
      </div>
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

function ThemeChoice({ mode, current, label }: { mode: Theme; current: Theme; label: string }) {
  return (
    <button type="button" className="choice" aria-pressed={current === mode} onClick={() => applyTheme(mode)}>
      <span className={mode === "dark" ? "swatch swatch-dark" : "swatch swatch-light"}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={mode === "dark" ? "/logo-dark.png" : "/logo-light.png"} alt="" width={18} height={18} />
      </span>
      {label}
    </button>
  );
}
