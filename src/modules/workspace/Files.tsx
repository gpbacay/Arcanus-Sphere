"use client";

import { BookPlus, Code, File, Folder, FolderOpen, GitBranch, HardDrive, Maximize2, MessageSquareText, Minimize2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { closePane, pane, pin } from "@/shared/pane";
import { errorText, useStore } from "@/shared/store";
import { Breadcrumb, type Crumb } from "@/shared/ui/breadcrumb";
import { HOME, SOURCE, addBooks, backToHome, canOpenFolder, list, makeFolder, openFolder, reconnect, remove, rename, workspace, write, type Entry } from "./fs";
import { Git } from "./Git";
import { closeTab, editTab, ide, openDir, openFile, saveTab } from "./ide";
import { source } from "./source";

// The editor is a chunk of its own, fetched when a file is first opened.
const Editor = dynamic(() => import("./Editor"), { ssr: false, loading: () => <p className="pane-note">Opening the editor…</p> });

/** Arcanus's files and its IDE: browse the workspace and its own source, edit files in tabs, hand one to Arcanus, use git. */
export function Files() {
  const open = useStore(pane, (s) => s.open === "files");
  return open ? <FilesPane /> : null;
}

const baseName = (path: string) => path.split("/").pop() ?? path;
/** The places that are Arcanus itself: not to be renamed or deleted from a list. */
const fixed = (path: string) => path === HOME || path === SOURCE;

function FilesPane() {
  const kind = useStore(workspace, (s) => s.kind);
  const name = useStore(workspace, (s) => s.name);
  const lost = useStore(workspace, (s) => s.reconnect);
  const version = useStore(workspace, (s) => s.version);
  const failed = useStore(workspace, (s) => s.error);
  const hasSource = useStore(source, (s) => s.available);
  const branch = useStore(source, (s) => s.branch);
  const dir = useStore(ide, (s) => s.dir);
  const tabs = useStore(ide, (s) => s.tabs);
  const active = useStore(ide, (s) => s.active);
  const view = useStore(ide, (s) => s.view);
  const wide = useStore(ide, (s) => s.wide);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [naming, setNaming] = useState<{ from: string | null; value: string } | null>(null); // from: the entry being renamed, or null for a new one
  const [error, setError] = useState("");
  const tab = tabs.find((t) => t.path === active);

  useEffect(() => {
    let current = true;
    list(dir).then(
      (found) => current && (setEntries(found), setError("")),
      (err) => current && (setEntries([]), setError(errorText(err)))
    );
    return () => {
      current = false;
    };
  }, [dir, version, name]);

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
    });

  /** Make what was typed: "notes.md", "folder/notes.md", or "folder/" for a folder. Or rename `naming.from` to it. */
  async function submitName() {
    if (!naming) return;
    const typed = naming.value.trim();
    const clean = typed.replace(/^\/+|\/+$/g, "");
    setNaming(null);
    if (!clean) return;
    if (naming.from !== null) {
      if (clean === naming.from) return;
      await rename(join(naming.from), join(clean));
      closeTab(join(naming.from));
    } else if (typed.endsWith("/")) {
      await makeFolder(join(clean));
      ide.set({ dir: join(clean) });
    } else {
      await write(join(clean), "");
      await openFile(join(clean));
    }
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

  const explorer = (
    <div className="pane-body explorer">
      <Breadcrumb
        label="Folder"
        root={name || "root"}
        segments={crumbs(dir)}
        onOpen={(path) => ide.set({ dir: path })}
        action={
          <button type="button" className="icon-btn" aria-label="New file or folder" title="New file, or folder/ for a folder" onClick={() => setNaming({ from: null, value: "" })}>
            <Plus size={15} />
          </button>
        }
      />
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
            placeholder={naming.from === null ? "notes.md, folder/notes.md, or folder/" : "New name"}
            aria-label={naming.from === null ? "New file or folder name" : `New name for ${naming.from}`}
            onChange={(e) => setNaming({ ...naming, value: e.target.value })}
            onBlur={() => !naming.value.trim() && setNaming(null)}
            onKeyDown={(e) => e.key === "Escape" && setNaming(null)}
          />
        </form>
      ) : null}
      <ul className="entries">
        {entries?.map((entry) => {
          const path = join(entry.name);
          return (
            <li key={entry.name}>
              <button type="button" aria-current={path === active || undefined} onClick={entry.kind === "directory" ? () => ide.set({ dir: path }) : act(() => openFile(path))}>
                {entry.kind === "directory" ? path === SOURCE ? <Code size={14} aria-hidden /> : <Folder size={14} aria-hidden /> : <File size={14} aria-hidden />}
                <span className="truncate">{entry.name}</span>
                {path === SOURCE ? <span className="pane-sub">my own code</span> : null}
              </button>
              {fixed(path) ? null : (
                <>
                  <button type="button" className="icon-btn" aria-label={`Rename ${entry.name}`} title="Rename" onClick={() => setNaming({ from: entry.name, value: entry.name })}>
                    <Pencil size={13} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Delete ${entry.name}`} title="Delete" onClick={act(() => discard(path))}>
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {entries && !entries.length ? <p className="pane-note">This folder is empty.</p> : null}
      {!dir ? (
        <p className="pane-note">
          Arcanus keeps its own files in <code>.arcanus/</code>. <code>self.md</code> is what it knows about itself. <code>ARCANUS.md</code> is read
          before every reply. <code>skills/</code> run with /name. <code>memory/</code>, <code>artifacts/</code> and <code>knowledge/</code> hold notes,
          saved replies and books.{" "}
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
    <section className="side-pane files-pane" aria-label="Arcanus files" data-wide={wide || undefined}>
      <header className="pane-head">
        <FolderOpen size={16} aria-hidden />
        <h2>Files</h2>
        <span className="pane-sub truncate" title={kind === "home" ? "Arcanus's private folder in this browser" : "A folder on this device"}>
          {name || "…"}
        </span>
        <button type="button" className="icon-btn" aria-label={wide ? "Make the pane narrow" : "Make the pane wide"} title={wide ? "Narrow: bring back the sphere" : "Wide: the folder beside the editor"} aria-pressed={wide} onClick={() => ide.set({ wide: !wide })}>
          {wide ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
        <button type="button" className="icon-btn" aria-label="Close files" onClick={closePane}>
          <X size={16} />
        </button>
      </header>

      <div className="pane-bar">
        {hasSource ? (
          <>
            <button type="button" className="btn" aria-pressed={view === "files" && (dir === SOURCE || dir.startsWith(`${SOURCE}/`))} title="The code Arcanus is running" onClick={() => openDir(SOURCE)}>
              <Code size={14} aria-hidden /> Source
            </button>
            <button type="button" className="btn" aria-pressed={view === "git"} title="What changed in the source, commit, pull and push" onClick={() => ide.set({ view: view === "git" ? "files" : "git" })}>
              <GitBranch size={14} aria-hidden /> {branch || "Git"}
            </button>
          </>
        ) : null}
        <label className="btn" title="Books and documents (.txt or .md) Arcanus answers from">
          <BookPlus size={14} aria-hidden /> Add books
          <input
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
        </label>
        {lost ? (
          <button type="button" className="btn" onClick={swap(reconnect)}>
            Reconnect {lost}
          </button>
        ) : null}
        {canOpenFolder() ? (
          <button type="button" className="btn" onClick={swap(openFolder)}>
            <HardDrive size={14} aria-hidden /> Open a folder
          </button>
        ) : null}
        {kind === "folder" ? (
          <button type="button" className="btn" onClick={swap(backToHome)}>
            Use Arcanus home
          </button>
        ) : null}
      </div>
      {error || failed ? (
        <p className="pane-note" role="alert">
          {error || failed}
        </p>
      ) : null}

      {view === "git" && hasSource ? (
        <Git />
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
    </section>
  );
}
