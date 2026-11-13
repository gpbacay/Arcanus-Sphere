"use client";

import { FolderOpen, Globe, Info, MapPin, Network, Settings, User, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { account, passwordError, saveAccount, signOut } from "@/modules/account";
import { pane, toggleMap, togglePane, TOP_ACTIONS } from "@/shared/pane";
import { useStore } from "@/shared/store";
import { Logo } from "@/shared/ui/logo";
import { modelSize, MODELS, setModelSize, type ModelSize } from "@/modules/llm";
import { deviceSpecs, type Specs } from "@/modules/device";
import { mind } from "@/modules/mind";
import { voice } from "@/modules/voice";

type DialogName = "about" | "settings" | "account";

/**
 * The top bar: the mark, then Arcanus's Graph of Thought, files, browser and world map (side panes), then Account, About
 * and Settings (dialogs), and at the right end a slot (TOP_ACTIONS) the studio fills with the orb's ⋮ tools.
 */
export function AppNav() {
  const [open, setOpen] = useState<DialogName | null>(null);
  const side = useStore(pane, (s) => s.open);
  const map = useStore(pane, (s) => s.map);
  const thinking = useStore(mind, (s) => s.thoughts.some((t) => t.status === "active"));
  return (
    <nav className="app-topbar" aria-label="Arcanus">
      <div className="app-nav-brand" title="Arcanus">
        <Logo size={26} />
        <span className="app-topbar-title">Arcanus</span>
      </div>
      <button
        type="button"
        className="app-nav-btn"
        aria-label="Graph of Thought"
        title="Graph of Thought: what Arcanus is thinking, live"
        aria-expanded={side === "mind"}
        data-live={thinking || undefined}
        onClick={() => togglePane("mind")}
      >
        <Network size={17} aria-hidden />
      </button>
      <button type="button" className="app-nav-btn" aria-label="Files" title="Files" aria-expanded={side === "files"} onClick={() => togglePane("files")}>
        <FolderOpen size={17} aria-hidden />
      </button>
      <button type="button" className="app-nav-btn" aria-label="Browser" title="Browser" aria-expanded={side === "browser"} onClick={() => togglePane("browser")}>
        <Globe size={17} aria-hidden />
      </button>
      <button type="button" className="app-nav-btn" aria-label="World map" title="World map: where you and Arcanus are, live" aria-expanded={map} onClick={() => toggleMap()}>
        <MapPin size={17} aria-hidden />
      </button>
      <div className="app-nav-gap" />
      <button type="button" className="app-nav-btn" aria-label="Account" title="Account" aria-expanded={open === "account"} aria-haspopup="dialog" onClick={() => setOpen("account")}>
        <User size={17} aria-hidden />
      </button>
      <button type="button" className="app-nav-btn" aria-label="About" title="About" aria-expanded={open === "about"} aria-haspopup="dialog" onClick={() => setOpen("about")}>
        <Info size={17} aria-hidden />
      </button>
      <button type="button" className="app-nav-btn" aria-label="Settings" title="Settings" aria-expanded={open === "settings"} aria-haspopup="dialog" onClick={() => setOpen("settings")}>
        <Settings size={17} aria-hidden />
      </button>
      <div id={TOP_ACTIONS} className="app-topbar-actions" />
      {open === "about" ? <AboutDialog onClose={() => setOpen(null)} /> : null}
      {open === "settings" ? <SettingsDialog onClose={() => setOpen(null)} /> : null}
      {open === "account" ? <AccountDialog onClose={() => setOpen(null)} /> : null}
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

type Row = [label: string, value: string];
const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

const deviceRows = (s: Specs): Row[] => [
  ["Device", s.host],
  ["System", `${s.os.name} (${s.os.arch})`],
  ["Processor", `${s.cpu.model} · ${s.cpu.cores} threads`],
  ["Memory", gb(s.memory.total)],
  ...(s.gpu ? ([["Graphics", s.gpu]] as Row[]) : []),
];

/** What the browser alone says, when Arcanus's device service isn't running. It never gives the computer's name. */
function browserRows(): Row[] {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string }; deviceMemory?: number };
  return [
    ["System", nav.userAgentData?.platform || navigator.platform || "Unknown"],
    ["Processor", `${navigator.hardwareConcurrency} threads`],
    ...(nav.deviceMemory ? ([["Memory", `${nav.deviceMemory}+ GB`]] as Row[]) : []),
  ];
}

/** The device this account lives on: its name and hardware, read from the operating system when the device service runs. */
function DeviceDetails() {
  const [found, setFound] = useState<{ rows: Row[]; full: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    deviceSpecs().then(
      (s) => live && setFound({ rows: deviceRows(s), full: true }),
      () => live && setFound({ rows: browserRows(), full: false }),
    );
    return () => void (live = false);
  }, []);
  return (
    <div>
      <span className="setting-label">This device</span>
      <span className="setting-note">{found && !found.full ? "Arcanus's device service isn't running, so this is only what the browser says." : "This account is kept on this device."}</span>
      <ul className="device-details" aria-busy={!found}>
        {(found?.rows ?? [["Device", "Reading…"]]).map(([label, value]) => (
          <li key={label}>
            <span>{label}</span>
            {value}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Who is signed in: the name Arcanus greets, the password, and the way out. */
function AccountDialog({ onClose }: { onClose: () => void }) {
  const user = useStore(account, (s) => s.user);
  const [name, setName] = useState(user?.name ?? "");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    const bad = next ? passwordError(next) : "";
    if (bad) return setNote({ text: bad, bad: true });
    setPending(true);
    const error = await saveAccount({ name, current, next: next || undefined }).catch(() => "This browser could not save the change.");
    setPending(false);
    setNote(error ? { text: error, bad: true } : { text: next ? "Saved. The new password works from now on." : "Saved." });
    if (!error) {
      setCurrent("");
      setNext("");
    }
  }
  return (
    <AppDialog title="Account" onClose={onClose}>
      <p>
        Signed in as <strong>{user?.username}</strong>. This account&apos;s conversations, memory, skills and files are its own, and stay in this browser.
      </p>
      <DeviceDetails />
      <form className="account-form" onSubmit={save}>
        <label>
          <span className="setting-label">Name</span>
          <span className="setting-note">Arcanus greets you by its first word.</span>
          <input className="field" value={name} maxLength={60} autoComplete="name" onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span className="setting-label">Current password</span>
          <input className="field" type="password" value={current} autoComplete="current-password" onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label>
          <span className="setting-label">New password</span>
          <span className="setting-note">Leave both empty to keep the one you have.</span>
          <input className="field" type="password" value={next} autoComplete="new-password" onChange={(e) => setNext(e.target.value)} />
        </label>
        {note ? (
          <p role={note.bad ? "alert" : "status"} data-bad={note.bad || undefined}>
            {note.text}
          </p>
        ) : null}
        <div className="row">
          <button type="button" className="btn" onClick={signOut}>
            Sign out
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            Save
          </button>
        </div>
      </form>
    </AppDialog>
  );
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <AppDialog title="About Arcanus" onClose={onClose}>
      <p>Arcanus is a local assistant created by Gianne Bacay. It answers in this browser, speaks the reply, and the sphere moves with the voice.</p>
      <ul>
        <li>Hippocampus decides what a message needs.</li>
        <li>The Graph of Thought shows what Arcanus is thinking and doing, live.</li>
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
      <label className="model-row">
        <span className="setting-label">Language model</span>
        <span className="setting-note">The larger one follows your instructions, your books and the conversation far better, and writes about four times slower. Changing it reloads Arcanus.</span>
        <select className="field" value={modelSize()} onChange={(event) => setModelSize(event.target.value as ModelSize)}>
          <option value="small">{MODELS.small.label} · faster · 180 MB</option>
          <option value="large">{MODELS.large.label} · better answers · 390 MB</option>
        </select>
      </label>
    </AppDialog>
  );
}
