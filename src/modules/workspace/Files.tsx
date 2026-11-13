"use client";

import { ArrowLeft, ArrowRight, ArrowUp, Check, File, Folder, Maximize2, MessageSquareText, Minimize2, Monitor, Pencil, Plus, RotateCw, Save, Trash2, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { chatLine, closePane, pane, pin } from "@/shared/pane";
import { errorText, useStore } from "@/shared/store";
import { Breadcrumb, type Crumb } from "@/shared/ui/breadcrumb";
import { GUARDRAILS, HOME, SOURCE, addBooks, backToHome, canOpenFolder, list, makeFolder, openFolder, reconnect, remove, rename, workspace, write, type Entry } from "./fs";
import { Git } from "./Git";
import { closeTab, editTab, ide, openDir, openFile, saveTab, travel } from "./ide";
import { source } from "./source";
import { runLine } from "./terminal";

// The editor is a chunk of its own, fetched when a file is first opened.
const Editor = dynamic(() => import("./Editor"), { ssr: false, loading: () => <p className="pane-note">Opening the editor…</p> });

/** Arcanus OS: browse the workspace and Arcanus's own source, edit files in tabs, run commands and skills, use git. */
export function Files() {
  const open = useStore(pane, (s) => s.open === "files");
  return open ? <FilesPane /> : null;
}

const baseName = (path: string) => path.split("/").pop() ?? path;
const parent = (path: string) => path.split("/").slice(0, -1).join("/");
/** The places that are Arcanus itself: not to be renamed or deleted from a list. */
const fixed = (path: string) => path === HOME || path === SOURCE || path === GUARDRAILS;

/** A menu entry; null draws a line, false leaves it out. */
type Item = { label: string; run: () => unknown; kbd?: string; off?: boolean; checked?: boolean } | null | false;

function MenuBar({ menus }: { menus: [string, Item[]][] }) {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => !ref.current?.contains(event.target as Node) && setOpen(null);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div className="os-menubar" ref={ref} onKeyDown={(e) => e.key === "Escape" && setOpen(null)}>
      {menus.map(([name, items]) => (
        <div key={name} className="os-menu">
          <button type="button" aria-haspopup="menu" aria-expanded={open === name} onClick={() => setOpen(open === name ? null : name)} onPointerEnter={() => open && setOpen(name)}>
            {name}
          </button>
          {open === name ? (
            <div role="menu" className="menu" aria-label={name}>
              {items.map((item, i) =>
                item === false ? null : item === null ? (
                  <div key={i} className="menu-sep" />
                ) : (
                  <button
                    key={item.label}
                    type="button"
                    role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                    aria-checked={item.checked}
                    className="menu-item"
                    disabled={item.off}
                    onClick={() => {
                      setOpen(null);
                      void item.run();
                    }}
                  >
                    <span>{item.label}</span>
                    {item.checked ? <Check size={14} aria-hidden /> : item.kbd ? <kbd>{item.kbd}</kbd> : null}
                  </button>
                )
              )}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Run a line in the terminal, and log it with its answer. */
async function exec(typed: string) {
  const line = typed.trim();
  if (!line) return;
  ide.set({ view: "terminal", line: "", log: [...ide.state.log, `$ ${line}`] });
  const answer = await runLine(line).catch((err: unknown) => `That didn't work: ${errorText(err)}`);
  ide.set({ log: [...ide.state.log, answer] });
}

function Terminal() {
  const log = useStore(ide, (s) => s.log);
  const line = useStore(ide, (s) => s.line);
  const out = useRef<HTMLPreElement>(null);
  useEffect(() => {
    out.current?.scrollTo({ top: out.current.scrollHeight }); // newer Chrome returns a promise: not the effect's to return
  }, [log]);

  return (
    <div className="pane-body terminal">
      <pre className="git-note" ref={out} role="log" aria-label="Terminal output">
        {log.length ? log.join("\n") : "Type help for the commands. ls, open, find, git … run here; a /skill or words go to the chat."}
      </pre>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void exec(line);
        }}
      >
        <input className="field" autoFocus value={line} placeholder="$ ls source/src" aria-label="Command" spellCheck={false} onChange={(e) => ide.set({ line: e.target.value })} />
      </form>
    </div>
  );
}

function FilesPane() {
  const kind = useStore(workspace, (s) => s.kind);
  const name = useStore(workspace, (s) => s.name);
  const lost = useStore(workspace, (s) => s.reconnect);
  const version = useStore(workspace, (s) => s.version);
  const failed = useStore(workspace, (s) => s.error);
  const skills = useStore(workspace, (s) => s.skills);
  const hasSource = useStore(source, (s) => s.available);
  const branch = useStore(source, (s) => s.branch);
  const dir = useStore(ide, (s) => s.dir);
  const tabs = useStore(ide, (s) => s.tabs);
  const active = useStore(ide, (s) => s.active);
  const view = useStore(ide, (s) => s.view);
  const wide = useStore(ide, (s) => s.wide);
  const canBack = useStore(ide, (s) => s.back.length > 0);
  const canForward = useStore(ide, (s) => s.forward.length > 0);
  const [fresh, setFresh] = useState(0); // bumped by Refresh: the folder is read again
  // The entries and the folder they were read from: while the next folder loads, the last one's rows must not be
  // clicked, or "source" clicked again in .arcanus/source opened .arcanus/source/source.
  const [listing, setListing] = useState<{ dir: string; entries: Entry[] } | null>(null);
  const entries = listing?.dir === dir ? listing.entries : null;
  // from: the path being renamed, or null for a new file (or folder, with `folder`)
  const [naming, setNaming] = useState<{ from: string | null; value: string; folder?: boolean } | null>(null);
  const [error, setError] = useState("");
  const books = useRef<HTMLInputElement>(null);
  const opened = useRef(0);
  const tab = tabs.find((t) => t.path === active);
  /** What Edit and Run act on: the file being edited, otherwise the folder being browsed. */
  const target = tab ? active : dir;
  const skill = target ? skills.find((s) => s.path === target || s.path === `${target}/SKILL.md`) : undefined;

  useEffect(() => {
    let current = true;
    list(dir).then(
      (found) => current && (setListing({ dir, entries: found }), setError("")),
      (err) => current && (setListing({ dir, entries: [] }), setError(errorText(err)))
    );
    return () => {
      current = false;
    };
  }, [dir, version, name, fresh]);

  const act = (run: () => Promise<unknown>) => () =>
    run().catch((err) => (err instanceof DOMException && err.name === "AbortError" ? undefined : setError(errorText(err))));
  const join = (entry: string) => (dir ? `${dir}/${entry}` : entry);
  const crumbs = (path: string): Crumb[] => {
    const parts = path ? path.split("/") : [];
    return parts.map((name, i) => ({ name, path: i < parts.length - 1 ? parts.slice(0, i + 1).join("/") : undefined }));
  };
  /** Another root has other files: the open tabs belong to the one being left. */
  const swap = (run: () => Promise<unknown>) =>
    act(async () => {
      await run();
      ide.set({ dir: "", tabs: [], active: "" });
      ide.set({ back: [], forward: [] }); // the folders visited were in the root being left
    });
  /** Bring the folder list into view (narrow, the editor covers it) for the name field. */
  const showExplorer = (at = dir) => ide.set({ view: "files", dir: at, active: wide ? active : "" });
  const terminal = (line = ide.state.line) => ide.set({ view: "terminal", line });

  /**
   * Open an entry with one click: a folder is browsed, a file goes to the editor. Idempotent: the folder already open
   * stays as it is, and a second click within 400 ms (the rest of a double-click) is ignored, so it can't land on
   * whatever the first one put under the pointer.
   */
  function open(path: string, folder: boolean) {
    const now = performance.now();
    if (now - opened.current < 400 || (folder && path === dir)) return;
    opened.current = now;
    if (folder) ide.set({ dir: path, view: "files" });
    else void act(() => openFile(path))();
  }

  /** Make what was typed: "notes.md", "folder/notes.md", or "folder/" for a folder. Or rename `naming.from` to it. */
  async function submitName() {
    if (!naming) return;
    const typed = naming.value.trim();
    const clean = typed.replace(/^\/+|\/+$/g, "");
    setNaming(null);
    if (!clean) return;
    if (naming.from !== null) {
      const to = [parent(naming.from), clean].filter(Boolean).join("/");
      if (to === naming.from) return;
      await rename(naming.from, to);
      closeTab(naming.from);
    } else if (naming.folder || typed.endsWith("/")) {
      await makeFolder(join(clean));
      ide.set({ dir: join(clean) });
    } else {
      await write(join(clean), "");
      await openFile(join(clean));
    }
  }

  function startRename(path: string) {
    showExplorer(parent(path));
    setNaming({ from: path, value: baseName(path) });
  }

  async function discard(path: string) {
    if (!window.confirm(`Delete ${path}?${path.startsWith(`${SOURCE}/`) ? "" : " This can't be undone."}`)) return;
    await remove(path);
    closeTab(path);
  }

  function close(path: string) {
    const closing = tabs.find((t) => t.path === path);
    if (closing && closing.text !== closing.saved && !window.confirm(`Close ${baseName(path)} without saving your changes?`)) return;
    closeTab(path);
  }

  const editable = !!target && !fixed(target);
  const menus: [string, Item[]][] = [
    [
      "File",
      [
        { label: "New file…", run: () => (showExplorer(), setNaming({ from: null, value: "" })) },
        { label: "New folder…", run: () => (showExplorer(), setNaming({ from: null, value: "", folder: true })) },
        null,
        canOpenFolder() && { label: "Open a folder on this device…", run: swap(openFolder) },
        !!lost && { label: `Reconnect ${lost}`, run: swap(reconnect) },
        kind === "folder" && { label: "Back to Arcanus home", run: swap(backToHome) },
        { label: "Add books (.txt, .md)…", run: () => books.current?.click() },
        null,
        { label: "Save", kbd: "Ctrl+S", off: !tab || tab.text === tab.saved, run: act(() => saveTab(active)) },
        { label: "Close file", off: !tab, run: () => close(active) },
        { label: "Close Arcanus OS", run: closePane },
      ],
    ],
    [
      "Edit",
      [
        { label: "Rename…", kbd: "F2", off: !editable, run: () => startRename(target) },
        { label: "Delete", kbd: "Del", off: !editable, run: act(() => discard(target)) },
        null,
        { label: "Find in my source…", off: !hasSource, run: () => terminal("find ") },
        { label: "Ask Arcanus about this file", off: !tab, run: () => tab && pin({ label: tab.path, text: tab.text }) },
      ],
    ],
    [
      "View",
      [
        { label: "Explorer", checked: view === "files", run: () => ide.set({ view: "files" }) },
        hasSource && { label: `Source control${branch ? ` · ${branch}` : ""}`, checked: view === "git", run: () => ide.set({ view: "git" }) },
        { label: "Terminal", checked: view === "terminal", run: () => terminal() },
        null,
        { label: "Wide", checked: wide, run: () => ide.set({ wide: !wide }) },
      ],
    ],
    [
      "Go",
      [
        { label: "Back", kbd: "Alt+←", off: !canBack, run: () => travel(-1) },
        { label: "Forward", kbd: "Alt+→", off: !canForward, run: () => travel(1) },
        { label: "Up one folder", kbd: "Alt+↑", off: !dir, run: () => showExplorer(parent(dir)) },
        { label: "Refresh", run: () => setFresh((n) => n + 1) },
        null,
        { label: name || "Root", run: () => openDir("") },
        { label: "Arcanus home", run: () => openDir(HOME) },
        hasSource && { label: "My source", run: () => openDir(SOURCE) },
        { label: "Skills", run: () => openDir(`${HOME}/skills`) },
        { label: "Memory", run: () => openDir(`${HOME}/memory`) },
        { label: "Knowledge", run: () => openDir(`${HOME}/knowledge`) },
        { label: "Artifacts", run: () => openDir(`${HOME}/artifacts`) },
      ],
    ],
    [
      "Run",
      [
        { label: skill ? `Run /${skill.name}` : "Run skill", off: !skill, run: () => skill && chatLine.send(`/${skill.name}`) },
        null,
        { label: "Run a command…", run: () => terminal() },
      ],
    ],
    [
      "Terminal",
      [
        { label: "Open terminal", run: () => terminal() },
        { label: "Clear terminal", run: () => ide.set({ log: [] }) },
      ],
    ],
    [
      "Help",
      [
        { label: "Commands", run: () => exec("help") },
        { label: "What is in .arcanus", run: () => openDir("") },
      ],
    ],
  ];

  const explorer = (
    <div className="pane-body explorer">
      {naming ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(submitName)();
          }}
        >
          <input
            className="field"
            autoFocus
            value={naming.value}
            placeholder={naming.from !== null ? "New name" : naming.folder ? "Folder name" : "notes.md, folder/notes.md, or folder/"}
            aria-label={naming.from !== null ? `New name for ${naming.from}` : naming.folder ? "New folder name" : "New file or folder name"}
            onChange={(e) => setNaming({ ...naming, value: e.target.value })}
            onBlur={() => !naming.value.trim() && setNaming(null)}
            onKeyDown={(e) => e.key === "Escape" && setNaming(null)}
          />
        </form>
      ) : null}
      <ul
        className="entries"
        onKeyDown={(e) => {
          // F2 and Del act on the focused row.
          const path = (e.target as HTMLElement).closest("li")?.dataset.path;
          if (!path || fixed(path)) return;
          if (e.key === "F2") startRename(path);
          else if (e.key === "Delete") void act(() => discard(path))();
        }}
      >
        {entries?.map((entry) => {
          const path = join(entry.name);
          const folder = entry.kind === "directory";
          const kept = fixed(path) ? "Arcanus's own folder: it can't be renamed or deleted" : "";
          return (
            <li key={entry.name} data-path={path}>
              <button type="button" aria-current={path === active || undefined} onClick={() => open(path, folder)}>
                {folder ? <Folder size={14} aria-hidden /> : <File size={14} aria-hidden />}
                <span className="truncate">{entry.name}</span>
              </button>
              <button type="button" className="icon-btn" aria-label={`Rename ${entry.name}`} title={kept || "Rename"} disabled={!!kept} onClick={() => startRename(path)}>
                <Pencil size={13} />
              </button>
              <button type="button" className="icon-btn" aria-label={`Delete ${entry.name}`} title={kept || "Delete"} disabled={!!kept} onClick={act(() => discard(path))}>
                <Trash2 size={13} />
              </button>
            </li>
          );
        })}
      </ul>
      {entries && !entries.length ? <p className="pane-note">This folder is empty.</p> : null}
      {!dir ? (
        <p className="pane-note">
          Arcanus keeps its own files in <code>.arcanus/</code>. <code>self.md</code> is what it knows about itself, and <code>lore.md</code> where it comes from and why it is called Arcanus. <code>ARCANUS.md</code> is read
          before every reply. <code>guardrails/</code> holds the rules Arcanus never breaks: <code>built-in.md</code> the ones in its code, <code>rules.md</code> yours. <code>skills/</code> run with /name, or Run in the menu. <code>memory/</code>, <code>artifacts/</code> and <code>knowledge/</code> hold notes,
          saved replies and books (File, then Add books).{" "}
          {hasSource ? (
            <>
              <code>source/</code> is the code Arcanus is running: save a file there and it runs a moment later.
            </>
          ) : (
            "Its source code appears here when Arcanus is opened at localhost on the computer it runs from."
          )}
        </p>
      ) : null}
    </div>
  );

  return (
    <section
      className="side-pane files-pane"
      aria-label="Arcanus OS"
      data-wide={wide || undefined}
      onKeyDown={(e) => {
        if (!e.altKey || (e.target as HTMLElement).closest(".cm-editor")) return; // the editor keeps its own Alt keys
        const step = { ArrowLeft: () => travel(-1), ArrowRight: () => travel(1), ArrowUp: () => dir && showExplorer(parent(dir)) }[e.key];
        if (!step) return;
        e.preventDefault();
        step();
      }}
    >
      <header className="pane-head">
        <Monitor size={16} aria-hidden />
        <h2>Arcanus OS</h2>
        <span className="pane-sub truncate" title={kind === "home" ? "Arcanus's private folder in this browser" : "A folder on this device"}>
          {name || "…"}
        </span>
        <button type="button" className="icon-btn" aria-label={wide ? "Make the pane narrow" : "Make the pane wide"} title={wide ? "Narrow: bring back the sphere" : "Wide: the folder beside the editor"} aria-pressed={wide} onClick={() => ide.set({ wide: !wide })}>
          {wide ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
        <button type="button" className="icon-btn" aria-label="Close Arcanus OS" onClick={closePane}>
          <X size={16} />
        </button>
      </header>

      <MenuBar menus={menus} />
      {view === "files" ? (
        <div className="os-nav">
          <button type="button" className="icon-btn" aria-label="Back" title="Back (Alt+←)" disabled={!canBack} onClick={() => travel(-1)}>
            <ArrowLeft size={15} />
          </button>
          <button type="button" className="icon-btn" aria-label="Forward" title="Forward (Alt+→)" disabled={!canForward} onClick={() => travel(1)}>
            <ArrowRight size={15} />
          </button>
          <button type="button" className="icon-btn" aria-label="Up one folder" title="Up one folder (Alt+↑)" disabled={!dir} onClick={() => showExplorer(parent(dir))}>
            <ArrowUp size={15} />
          </button>
          <button type="button" className="icon-btn" aria-label="Refresh" title="Refresh" onClick={() => setFresh((n) => n + 1)}>
            <RotateCw size={14} />
          </button>
          <Breadcrumb
            label="Folder"
            root={name || "root"}
            segments={crumbs(dir)}
            onOpen={(path) => showExplorer(path)}
            action={
              <button type="button" className="icon-btn" aria-label="New file or folder" title="New file, or folder/ for a folder" onClick={() => (showExplorer(), setNaming({ from: null, value: "" }))}>
                <Plus size={15} />
              </button>
            }
          />
        </div>
      ) : null}
      <input
        ref={books}
        type="file"
        accept=".txt,.md,text/plain,text/markdown"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          void act(async () => {
            const { added, refused } = await addBooks(files);
            if (added.length) openDir(`${HOME}/knowledge`);
            setError(refused.length ? `Not added: ${refused.join(", ")}` : "");
          })();
        }}
      />
      {error || failed ? (
        <p className="pane-note" role="alert">
          {error || failed}
        </p>
      ) : null}

      {view === "git" && hasSource ? (
        <Git />
      ) : view === "terminal" ? (
        <Terminal />
      ) : (
        <>
          {tabs.length ? (
            <div className="tabs" role="tablist" aria-label="Open files">
              {tabs.map((t) => (
                <div key={t.path} className="tab" data-active={t.path === active || undefined}>
                  <button type="button" role="tab" aria-selected={t.path === active} title={t.path} onClick={() => ide.set({ active: t.path })}>
                    <span className="truncate">{baseName(t.path)}</span>
                    {t.text !== t.saved ? <span className="tab-dirty" role="img" aria-label="unsaved changes" /> : null}
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Close ${baseName(t.path)}`} onClick={() => close(t.path)}>
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="ide">
            {wide || !tab ? explorer : null}
            {tab ? (
              <div className="pane-body editor">
                <Breadcrumb label="Editing" root={name || "root"} segments={crumbs(tab.path)} onOpen={(path) => ide.set({ dir: path, active: "" })} />
                <Editor path={tab.path} text={tab.text} onChange={(text) => editTab(tab.path, text)} onSave={act(() => saveTab(tab.path))} />
                <div className="pane-actions">
                  {wide ? null : (
                    <button type="button" className="btn" onClick={() => ide.set({ active: "" })}>
                      Files
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn"
                    title="Arcanus reads this file with every message until you remove it"
                    onClick={() => pin({ label: tab.path, text: tab.text })}
                  >
                    <MessageSquareText size={14} aria-hidden /> Ask Arcanus
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Delete ${tab.path}`} title="Delete" onClick={act(() => discard(tab.path))}>
                    <Trash2 size={15} />
                  </button>
                  <button type="button" className="btn btn-primary" disabled={tab.text === tab.saved} title="Ctrl+S" onClick={act(() => saveTab(tab.path))}>
                    <Save size={14} aria-hidden /> Save
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </>
      )}
      <footer className="os-status">
        <span className="truncate">{view === "terminal" ? "Terminal" : view === "git" ? "Source control" : `/${dir}`}</span>
        {entries && view === "files" ? <span>{entries.length === 1 ? "1 item" : `${entries.length} items`}</span> : null}
        {hasSource && branch ? <span>⎇ {branch}</span> : null}
      </footer>
    </section>
  );
}
