"use client";

import { BookPlus, File, Folder, FolderOpen, HardDrive, MessageSquareText, Plus, Save, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { closePane, pane, pin } from "@/shared/pane";
import { errorText, useStore } from "@/shared/store";
import { Breadcrumb, type Crumb } from "@/shared/ui/breadcrumb";
import { HOME, addBooks, canOpenFolder, list, openFolder, read, reconnect, remove, backToHome, workspace, write, type Entry } from "./fs";

/** Arcanus's files: browse the workspace, open and edit a file, hand one to Arcanus to read. */
export function Files() {
  const open = useStore(pane, (s) => s.open === "files");
  return open ? <FilesPane /> : null;
}

type Opened = { path: string; text: string; saved: string };

function FilesPane() {
  const kind = useStore(workspace, (s) => s.kind);
  const name = useStore(workspace, (s) => s.name);
  const lost = useStore(workspace, (s) => s.reconnect);
  const version = useStore(workspace, (s) => s.version);
  const failed = useStore(workspace, (s) => s.error);
  const [dir, setDir] = useState("");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [file, setFile] = useState<Opened | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => setDir(""), [name]);
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
  const openCrumb = (path: string) => {
    setFile(null);
    setDir(path);
  };

  async function openEntry(entry: Entry) {
    if (entry.kind === "directory") return setDir(join(entry.name));
    const text = (await read(join(entry.name))) ?? "";
    setFile({ path: join(entry.name), text, saved: text });
  }

  async function create(entryName: string) {
    const clean = entryName.trim().replace(/^\/+|\/+$/g, "");
    setNewName(null);
    if (!clean) return;
    await write(join(clean), "");
    setFile({ path: join(clean), text: "", saved: "" });
  }

  return (
    <section className="side-pane" aria-label="Arcanus files">
      <header className="pane-head">
        <FolderOpen size={16} aria-hidden />
        <h2>Files</h2>
        <span className="pane-sub truncate" title={kind === "home" ? "Arcanus's private folder in this browser" : "A folder on this device"}>
          {name || "…"}
        </span>
        <button type="button" className="icon-btn" aria-label="Close files" onClick={closePane}>
          <X size={16} />
        </button>
      </header>

      <div className="pane-bar">
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
                if (added.length) setDir(`${HOME}/knowledge`);
                setError(refused.length ? `Not added: ${refused.join(", ")}` : "");
              })();
            }}
          />
        </label>
        {lost ? (
          <button type="button" className="btn" onClick={act(reconnect)}>
            Reconnect {lost}
          </button>
        ) : null}
        {canOpenFolder() ? (
          <button type="button" className="btn" onClick={act(openFolder)}>
            <HardDrive size={14} aria-hidden /> Open a folder
          </button>
        ) : null}
        {kind === "folder" ? (
          <button type="button" className="btn" onClick={act(backToHome)}>
            Use Arcanus home
          </button>
        ) : null}
      </div>
      {error || failed ? (
        <p className="pane-note" role="alert">
          {error || failed}
        </p>
      ) : null}

      {file ? (
        <div className="pane-body editor">
          <Breadcrumb label="Editing" root={name || "root"} segments={crumbs(file.path)} onOpen={openCrumb} />
          <textarea
            className="field"
            value={file.text}
            spellCheck={false}
            aria-label={`Contents of ${file.path}`}
            onChange={(e) => setFile({ ...file, text: e.target.value })}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                e.preventDefault();
                void act(async () => (await write(file.path, file.text), setFile({ ...file, saved: file.text })))();
              }
            }}
          />
          <div className="pane-actions">
            <button type="button" className="btn" onClick={() => setFile(null)}>
              Back
            </button>
            <button
              type="button"
              className="btn"
              title="Arcanus reads this file with every message until you remove it"
              onClick={() => pin({ label: file.path, text: file.text })}
            >
              <MessageSquareText size={14} aria-hidden /> Ask Arcanus
            </button>
            <button type="button" className="icon-btn" aria-label={`Delete ${file.path}`} title="Delete" onClick={act(async () => (await remove(file.path), setFile(null)))}>
              <Trash2 size={15} />
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={file.text === file.saved}
              onClick={act(async () => (await write(file.path, file.text), setFile({ ...file, saved: file.text })))}
            >
              <Save size={14} aria-hidden /> Save
            </button>
          </div>
        </div>
      ) : (
        <div className="pane-body">
          <Breadcrumb
            label="Folder"
            root={name || "root"}
            segments={crumbs(dir)}
            onOpen={setDir}
            action={
              <button type="button" className="icon-btn" aria-label="New file" title="New file (name/with/folders.md)" onClick={() => setNewName("")}>
                <Plus size={15} />
              </button>
            }
          />
          {newName !== null ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(() => create(newName))();
              }}
            >
              <input
                className="field"
                autoFocus
                value={newName}
                placeholder="notes.md or folder/file.md"
                aria-label="New file name"
                onChange={(e) => setNewName(e.target.value)}
                onBlur={() => !newName.trim() && setNewName(null)}
                onKeyDown={(e) => e.key === "Escape" && setNewName(null)}
              />
            </form>
          ) : null}
          <ul className="entries">
            {entries?.map((entry) => (
              <li key={entry.name}>
                <button type="button" onClick={act(() => openEntry(entry))}>
                  {entry.kind === "directory" ? <Folder size={14} aria-hidden /> : <File size={14} aria-hidden />}
                  <span className="truncate">{entry.name}</span>
                </button>
              </li>
            ))}
          </ul>
          {entries && !entries.length ? <p className="pane-note">This folder is empty.</p> : null}
          {!dir ? (
            <p className="pane-note">
              Arcanus keeps its own files in <code>.arcanus/</code>. <code>self.md</code> is what it knows about itself. <code>ARCANUS.md</code> is read
              before every reply. <code>skills/</code> run with /name. <code>memory/</code>, <code>artifacts/</code> and <code>knowledge/</code> hold notes,
              saved replies and books. Open a file to edit it; Ctrl+S saves.
              {kind === "home" ? " These live privately in this browser. Open the project folder to edit the source that is running." : " This folder is on this device. Saving a source file changes it; reload to run it."}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
