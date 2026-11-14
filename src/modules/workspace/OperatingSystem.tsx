"use client";

import { ArrowLeft, ArrowRight, Check, ChevronsDownUp, FilePlus, FolderPlus, House, Monitor, RotateCw, SquareTerminal, Waypoints } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { chatLine, closePane, pin, toggleExpand, usePlace, type Section } from "@/shared/pane";
import { errorText, useStore } from "@/shared/store";
import { Breadcrumb, type Crumb } from "@/shared/ui/breadcrumb";
import { Grip } from "@/shared/ui/grip";
import { Info } from "@/shared/ui/info";
import { PaneControls } from "@/shared/ui/pane-controls";
import { PopMenu } from "@/shared/ui/pop-menu";
import { GUARDRAILS, HOME, PC, SOURCE, addBooks, backToHome, canOpenFolder, git, makeFolder, openFolder, reconnect, rename, workspace, write } from "./fs";
import { Center } from "./Center";
import { Git } from "./Git";
import { closeFile, closeTab, discard, ide, newTerminal, openDir, openFile, patchTerm, saveTab, showCenter, showTerminal, travel } from "./ide";
import { source, sourceGit } from "./source";
import { exec, TerminalPanel } from "./TerminalView";
import { Tree } from "./Tree";

/** The Operating System: browse the workspace and Arcanus's own source, edit files in tabs, run commands and skills, use git. */
export function OperatingSystem() {
  const { home, at, wide } = usePlace("os");
  return home ? <OperatingSystemPane at={at} wide={wide} /> : null;
}

const baseName = (path: string) => path.split("/").pop() ?? path;
const parent = (path: string) => path.split("/").slice(0, -1).join("/");
/** The places that are Arcanus itself, and This PC and its drives: not to be renamed or deleted from a list. */
const fixed = (path: string) => path === HOME || path === SOURCE || path === GUARDRAILS || path === PC || parent(path) === PC;

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
  const graphOpen = useStore(ide, (s) => s.graphOpen);
  const changesOpen = useStore(ide, (s) => s.changesOpen);
  const gitGraphOpen = useStore(ide, (s) => s.gitGraphOpen);
  const sideW = useStore(ide, (s) => s.sideW);
  const sideBox = useRef<HTMLElement>(null);
  const sizeSide = (w: number) => ide.set({ sideW: Math.min(800, Math.max(180, w)) });
  /** The center has room beside the files (expanded, or in the window's center); otherwise it is an Artifacts tab. */
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
      ide.set({ dir: "", tabs: [], active: "", activeRight: "", focus: 0 });
      ide.set({ back: [], forward: [] }); // the folders visited were in the root being left
    });
  /** Bring the folder list into view (narrow, the editor covers it) for the name field. */
  const showExplorer = (to = dir) => ide.set({ dir: to });

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
    setNaming({ from: path, value: baseName(path) });
  }
  const startNew = (folder = false) => setNaming({ from: null, value: "", folder });

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
        { label: "Close file", off: !tab, run: () => closeFile(active) },
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
        { label: "Explorer", run: () => showExplorer() },
        { label: "Knowledge graph", checked: graphOpen, run: () => (graphOpen ? ide.set({ graphOpen: false }) : (ide.set({ graphOpen: true, active: "" }), showCenter())) },
        hasSource && { label: "Changes", checked: changesOpen, run: () => ide.set({ changesOpen: !changesOpen }) },
        hasSource && { label: "Git Graph", checked: gitGraphOpen, run: () => ide.set({ gitGraphOpen: !gitGraphOpen }) },
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
        hasSource && { label: "This PC", run: () => openDir(PC) },
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
        kept={(path) => (fixed(path) ? (path.startsWith(PC) ? "This PC and its drives can't be renamed or deleted" : "Arcanus's own folder: it can't be renamed or deleted") : "")}
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
            aria-label="Knowledge graph"
            aria-pressed={graphOpen && !tab}
            title={graphOpen && !tab ? "Close the knowledge graph" : "Knowledge graph: your notes and the [[links]] between them"}
            onClick={() => (graphOpen && !tab ? ide.set({ graphOpen: false }) : (ide.set({ graphOpen: true, active: "" }), showCenter()))}
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
              Write <code>[[a note&apos;s name]]</code> in a note to link it to another; the knowledge graph shows the links, and Arcanus reads a note&apos;s links with it.
            </p>
          </Info>
        </div>
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

      <div className="os-body">
        <div className="os-work">
          <div className="os-main">
            <div className="os-files">{explorer}</div>
            {split ? <Center /> : null}
          </div>
          {termOpen ? <TerminalPanel /> : null}
        </div>
        {hasSource && (changesOpen || gitGraphOpen) ? (
          <aside className="os-side" ref={sideBox} aria-label="Version control" style={{ "--side-w": `${sideW}px` } as React.CSSProperties}>
            <Grip
              label="Resize the version control column"
              x
              value={sideW}
              min={180}
              max={800}
              drag={(x) => sideBox.current && sizeSide(sideBox.current.getBoundingClientRect().right - x)}
              nudge={(step) => sizeSide(sideW - step * 20)}
            />
            <Git changes={changesOpen} graph={gitGraphOpen} />
          </aside>
        ) : null}
      </div>
      <footer className="os-status">
        <span className="truncate">/{dir}</span>
        <button
          type="button"
          className="icon-btn"
          aria-label={termOpen ? "Hide the terminal" : "Show the terminal"}
          aria-pressed={termOpen}
          title={termOpen ? "Hide the terminal" : "Show the terminal"}
          onClick={() => (termOpen ? ide.set({ termOpen: false }) : showTerminal())}
        >
          <SquareTerminal size={13} />
        </button>
        {hasSource && branch ? <Branches branch={branch} /> : null}
      </footer>
    </section>
  );
}

/** The branch in the status bar: click it to switch to another local branch. */
function Branches({ branch }: { branch: string }) {
  const version = useStore(workspace, (s) => s.version);
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    sourceGit(["branch", "--format=%(refname:short)"]).then(({ out, code }) => live && !code && setNames(out.split("\n").filter(Boolean)));
    return () => void (live = false);
  }, [version, branch]);
  return (
    <PopMenu
      label="Switch branch"
      title={`On ${branch}: switch branch`}
      trigger={<>⎇ {branch}</>}
      items={(names.length ? names : [branch]).map((name) => ({
        label: name,
        checked: name === branch,
        run: () => name !== branch && git("checkout", name).then(({ code, out }) => code && window.alert(out)),
      }))}
    />
  );
}
