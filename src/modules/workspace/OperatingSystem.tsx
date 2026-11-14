"use client";

import { ArrowLeft, ArrowRight, Check, ChevronsDownUp, Code, Eye, FilePlus, FolderPlus, FolderTree, House, MessageSquareText, Monitor, RotateCw, Save, Trash2, Waypoints, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { chatLine, closePane, pin, toggleExpand, usePlace, type Section } from "@/shared/pane";
import { errorText, useStore } from "@/shared/store";
import { Breadcrumb, type Crumb } from "@/shared/ui/breadcrumb";
import { Info } from "@/shared/ui/info";
import { Markdown, WikiLinks } from "@/shared/ui/markdown";
import { PaneControls } from "@/shared/ui/pane-controls";
import { GUARDRAILS, HOME, SOURCE, addBooks, backToHome, canOpenFolder, makeFolder, openFolder, reconnect, remove, rename, workspace, write } from "./fs";
import { Git } from "./Git";
import { closeTab, editTab, ide, newTerminal, openDir, openFile, patchTerm, saveTab, showTerminal, togglePreview, travel } from "./ide";
import { source } from "./source";
import { exec, TerminalPanel } from "./TerminalView";
import { NoteGraph } from "./NoteGraph";
import { openNote } from "./notes";
import { Tree } from "./Tree";

// The editor is a chunk of its own, fetched when a file is first opened.
const Editor = dynamic(() => import("./Editor"), { ssr: false, loading: () => <p className="pane-note">Opening the editor…</p> });

/** The Operating System: browse the workspace and Arcanus's own source, edit files in tabs, run commands and skills, use git. */
export function OperatingSystem() {
  const { home, at, wide } = usePlace("os");
  return home ? <OperatingSystemPane at={at} wide={wide} /> : null;
}

/**
 * A markdown file as it reads. Its HTML comments show as notes, not hidden: in Arcanus's own files (ARCANUS.md,
 * guardrails/rules.md) the comment is the guide to the file, and until you write under it, all there is.
 */
function Preview({ text }: { text: string }) {
  if (!text.trim()) return <p className="pane-note">This file is empty.</p>;
  // A skill's front matter (name, description) shows as its properties, the way a notes app shows them.
  const front = /^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(text);
  const props = front ? front[1].split(/\r?\n/).map((line) => /^([\w-]+):\s*(.*)$/.exec(line)).filter((m) => m !== null) : [];
  return (
    <>
      {props.length ? (
        <dl className="md-props" aria-label="Properties">
          {props.map(([, key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {text
        .slice(props.length ? front![0].length : 0)
        .split(/(<!--[\s\S]*?-->)/)
        .map((part, i) =>
          part.startsWith("<!--") ? (
            <aside key={i} className="md-note md" aria-label="Comment">
              <Markdown text={commentText(part.slice(4, -3))} file />
            </aside>
          ) : part.trim() ? (
            <Markdown key={i} text={part} file />
          ) : null
        )}
    </>
  );
}

/**
 * A comment as markdown. Its lines are wrapped and indented to sit under "<!--": the indent they share is taken off
 * so the wrapped lines run together, and a line indented further (an example) keeps a line of its own, as a quote.
 */
function commentText(body: string) {
  const [first, ...rest] = body.trim().split("\n");
  const indent = Math.min(...rest.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length));
  return [first, ...rest.map((l) => l.slice(Number.isFinite(indent) ? indent : 0))].map((l) => (/^\s+\S/.test(l) ? `> ${l.trim()}` : l)).join("\n");
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

function OperatingSystemPane({ at, wide }: { at: Section | null; wide: boolean }) {
  const kind = useStore(workspace, (s) => s.kind);
  const name = useStore(workspace, (s) => s.name);
  const lost = useStore(workspace, (s) => s.reconnect);
  const failed = useStore(workspace, (s) => s.error);
  const skills = useStore(workspace, (s) => s.skills);
  const hasSource = useStore(source, (s) => s.available);
  const branch = useStore(source, (s) => s.branch);
  const dir = useStore(ide, (s) => s.dir);
  const tabs = useStore(ide, (s) => s.tabs);
  const active = useStore(ide, (s) => s.active);
  const view = useStore(ide, (s) => s.view);
  /** The folder beside the editor: room for both, expanded or in the center. */
  const split = wide || at === "center";
  const termOpen = useStore(ide, (s) => s.termOpen);
  const canBack = useStore(ide, (s) => s.back.length > 0);
  const canForward = useStore(ide, (s) => s.forward.length > 0);
  const [fresh, setFresh] = useState(0); // bumped by Refresh: the folder is read again
  const picked = useStore(ide, (s) => s.into);
  /** Where a new file or folder goes: the folder last picked in the tree, while it is inside the one shown. */
  const into = picked && (picked === dir || !dir || picked.startsWith(`${dir}/`)) ? picked : dir;
  // from: the path being renamed, or null for a new file (or folder, with `folder`)
  const [naming, setNaming] = useState<{ from: string | null; value: string; folder?: boolean } | null>(null);
  const [error, setError] = useState("");
  const books = useRef<HTMLInputElement>(null);
  const opened = useRef(0);
  const tab = tabs.find((t) => t.path === active);
  /** What Edit and Run act on: the file being edited, otherwise the folder being browsed. */
  const target = tab ? active : dir;
  const skill = target ? skills.find((s) => s.path === target || s.path === `${target}/SKILL.md`) : undefined;

  const act = (run: () => Promise<unknown>) => () =>
    run().catch((err) => (err instanceof DOMException && err.name === "AbortError" ? undefined : setError(errorText(err))));
  const join = (entry: string) => (into ? `${into}/${entry}` : entry);
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
  const showExplorer = (to = dir) => ide.set({ view: "files", dir: to, active: split ? active : "" });

  /** Open a file with one click. A second click within 400 ms (the rest of a double-click) is ignored. */
  function open(path: string) {
    const now = performance.now();
    if (now - opened.current < 400) return;
    opened.current = now;
    void act(() => openFile(path))();
  }
  /** The new item shows where it was made: its folder is opened in the tree. */
  const reveal = (path: string) => ide.set({ expanded: [...new Set([...ide.state.expanded, ...(into && into !== dir ? [into] : [])])], selected: path });

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
      reveal(join(clean));
    } else {
      await write(join(clean), "");
      reveal(join(clean));
      await openFile(join(clean));
    }
  }

  function startRename(path: string) {
    ide.set({ view: "files", active: split ? active : "" });
    setNaming({ from: path, value: baseName(path) });
  }
  const startNew = (folder = false) => (ide.set({ view: "files", active: split ? active : "" }), setNaming({ from: null, value: "", folder }));

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
        { label: "New file…", run: () => startNew() },
        { label: "New folder…", run: () => startNew(true) },
        null,
        canOpenFolder() && { label: "Open a folder on this device…", run: swap(openFolder) },
        !!lost && { label: `Reconnect ${lost}`, run: swap(reconnect) },
        kind === "folder" && { label: "Back to Arcanus home", run: swap(backToHome) },
        { label: "Add books (.txt, .md)…", run: () => books.current?.click() },
        null,
        { label: "Save", kbd: "Ctrl+S", off: !tab || tab.text === tab.saved, run: act(() => saveTab(active)) },
        { label: "Close file", off: !tab, run: () => close(active) },
        { label: "Close Operating System", run: () => closePane("os") },
      ],
    ],
    [
      "Edit",
      [
        { label: "Rename…", kbd: "F2", off: !editable, run: () => startRename(target) },
        { label: "Delete", kbd: "Del", off: !editable, run: act(() => discard(target)) },
        null,
        { label: "Find in my source…", off: !hasSource, run: () => showTerminal("find ") },
        { label: "Ask Arcanus about this file", off: !tab, run: () => tab && pin({ label: tab.path, text: tab.text }) },
      ],
    ],
    [
      "View",
      [
        { label: "Explorer", checked: view === "files", run: () => ide.set({ view: "files" }) },
        { label: "Graph of notes", checked: view === "graph", run: () => ide.set({ view: view === "graph" ? "files" : "graph" }) },
        hasSource && { label: `Source control${branch ? ` · ${branch}` : ""}`, checked: view === "git", run: () => ide.set({ view: "git" }) },
        { label: "Terminal", checked: termOpen, run: () => (termOpen ? ide.set({ termOpen: false }) : showTerminal()) },
        null,
        (at === "left" || at === "right") && { label: "Expanded", checked: wide, run: () => toggleExpand(at) },
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
        { label: "Run a command…", run: () => showTerminal() },
      ],
    ],
    [
      "Terminal",
      [
        { label: "New terminal", run: () => newTerminal() },
        { label: "Clear terminal", run: () => patchTerm(ide.state.term, () => ({ log: [] })) },
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
      <Tree
        root={dir}
        fresh={fresh}
        kept={(path) => (fixed(path) ? "Arcanus's own folder: it can't be renamed or deleted" : "")}
        onOpen={open}
        onRename={startRename}
        onDelete={(path) => void act(() => discard(path))()}
        onError={setError}
      />
    </div>
  );

  return (
    <section
      className="side-pane os-pane"
      aria-label="Operating System"
      data-at={at ?? undefined}
      data-wide={wide || undefined}
      data-split={split || undefined}
      hidden={!at}
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
        <h2>Operating System</h2>
        <span className="pane-sub truncate" title={kind === "home" ? "Arcanus's private folder in this browser" : "A folder on this device"}>
          {name || "…"}
        </span>
        <PaneControls page="os" title="Operating System" />
      </header>

      <MenuBar menus={menus} />
      {view !== "git" ? (
        <div className="os-nav">
          <button type="button" className="icon-btn" aria-label="Back" title="Back (Alt+←)" disabled={!canBack} onClick={() => travel(-1)}>
            <ArrowLeft size={15} />
          </button>
          <button type="button" className="icon-btn" aria-label="Forward" title="Forward (Alt+→)" disabled={!canForward} onClick={() => travel(1)}>
            <ArrowRight size={15} />
          </button>
          <button type="button" className="icon-btn" aria-label="Home" title="Home: the root folder" disabled={!dir} onClick={() => showExplorer("")}>
            <House size={15} />
          </button>
          <Breadcrumb label="Folder" root={name || "root"} segments={crumbs(dir)} onOpen={(path) => showExplorer(path)} />
          <button type="button" className="icon-btn" aria-label="New file" title={`New file in ${into || name || "the root"}`} onClick={() => startNew()}>
            <FilePlus size={15} />
          </button>
          <button type="button" className="icon-btn" aria-label="New folder" title={`New folder in ${into || name || "the root"}`} onClick={() => startNew(true)}>
            <FolderPlus size={15} />
          </button>
          <button type="button" className="icon-btn" aria-label="Refresh" title="Refresh" onClick={() => setFresh((n) => n + 1)}>
            <RotateCw size={14} />
          </button>
          <button type="button" className="icon-btn" aria-label="Collapse folders" title="Collapse folders" onClick={() => ide.set({ expanded: [] })}>
            <ChevronsDownUp size={15} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Graph of notes"
            aria-pressed={view === "graph"}
            title={view === "graph" ? "Back to the files" : "Graph: your notes and the [[links]] between them"}
            onClick={() => ide.set({ view: view === "graph" ? "files" : "graph" })}
          >
            <Waypoints size={15} />
          </button>
          <Info label="What is in .arcanus">
            <p>
              Arcanus keeps its own files in <code>.arcanus/</code>:
            </p>
            <ul>
              <li><code>self.md</code>: what it knows about itself</li>
              <li><code>lore.md</code>: where it comes from and its name</li>
              <li><code>ARCANUS.md</code>: read before every reply</li>
              <li><code>guardrails/</code>: rules it never breaks, <code>built-in.md</code> from its code and <code>rules.md</code> yours</li>
              <li><code>skills/</code>: run with /name, or Run in the menu</li>
              <li><code>memory/</code>, <code>artifacts/</code>, <code>knowledge/</code>: notes, saved replies, books (File, then Add books)</li>
              <li>{hasSource ? <><code>source/</code>: the code Arcanus is running; save a file and it runs a moment later</> : <><code>source/</code>: its source code, when opened at localhost on the computer it runs from</>}</li>
            </ul>
            <p>
              Write <code>[[a note&apos;s name]]</code> in a note to link it to another; the graph button shows the links, and Arcanus reads a note&apos;s links with it.
            </p>
          </Info>
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

      <div className="os-main">
      {view === "git" && hasSource ? (
        <Git />
      ) : view === "graph" ? (
        <NoteGraph current={active} />
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
            {split || !tab ? explorer : null}
            {tab ? (
              <div className="pane-body editor">
                {tab.preview ? (
                  <div className="md md-preview" tabIndex={0} aria-label={`Preview of ${baseName(tab.path)}`}>
                    <WikiLinks.Provider value={(target) => void act(() => openNote(target, tab.path))()}>
                      <Preview text={tab.text} />
                    </WikiLinks.Provider>
                  </div>
                ) : (
                  <Editor path={tab.path} text={tab.text} onChange={(text) => editTab(tab.path, text)} onSave={act(() => saveTab(tab.path))} />
                )}
                <div className="pane-actions">
                  {split ? null : (
                    <button type="button" className="icon-btn" aria-label="Files" title="Files" onClick={() => ide.set({ active: "" })}>
                      <FolderTree size={15} />
                    </button>
                  )}
                  {/\.(md|markdown)$/i.test(tab.path) ? (
                    <button
                      type="button"
                      className="icon-btn"
                      aria-pressed={!!tab.preview}
                      aria-label="Preview"
                      title={tab.preview ? "Back to the text" : "Preview: see it as it reads"}
                      onClick={() => togglePreview(tab.path)}
                    >
                      {tab.preview ? <Code size={15} /> : <Eye size={15} />}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Ask Arcanus about this file"
                    title="Ask Arcanus: it reads this file with every message until you remove it"
                    onClick={() => pin({ label: tab.path, text: tab.text })}
                  >
                    <MessageSquareText size={15} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Delete ${tab.path}`} title="Delete" onClick={act(() => discard(tab.path))}>
                    <Trash2 size={15} />
                  </button>
                  <button type="button" className="icon-btn icon-btn-primary" aria-label="Save" disabled={tab.text === tab.saved} title="Save (Ctrl+S)" onClick={act(() => saveTab(tab.path))}>
                    <Save size={15} />
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </>
      )}
      </div>
      {termOpen ? <TerminalPanel /> : null}
      <footer className="os-status">
        <span className="truncate">{view === "git" ? "Source control" : view === "graph" ? "Graph of notes" : `/${dir}`}</span>
        {hasSource && branch ? <span>⎇ {branch}</span> : null}
      </footer>
    </section>
  );
}
