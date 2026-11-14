"use client";

// The Operating System's center: the open files as tabs, with the knowledge graph as the first tab, and the editor,
// split in two groups side by side like VS Code's once a file is opened to the right. In the Operating System when it
// has the room (expanded, or in the window's center); otherwise an Artifacts tab.
import { Code, Columns2, Eye, FileCode, Globe, MessageSquareText, Play, Save, Trash2, Waypoints, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { pin } from "@/shared/pane";
import { errorText, useStore } from "@/shared/store";
import { Markdown, WikiLinks } from "@/shared/ui/markdown";
import { closeFile, discard, editTab, ide, openIn, saveTab, show, togglePreview, type Group } from "./ide";
import { NoteGraph } from "./NoteGraph";
import { openNote } from "./notes";
import { RUNNERS, runFile } from "./TerminalView";

// The editor is a chunk of its own, fetched when a file is first opened.
const Editor = dynamic(() => import("./Editor"), { ssr: false, loading: () => <p className="pane-note">Opening the editor…</p> });

const baseName = (path: string) => path.split("/").pop() ?? path;

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

/** The center. With nothing open it is left out of the Operating System, and says how to open something as an artifact. */
export function Center({ away = false }: { away?: boolean }) {
  const tabs = useStore(ide, (s) => s.tabs);
  const graphOpen = useStore(ide, (s) => s.graphOpen);

  if (!graphOpen && !tabs.length)
    return away ? <p className="pane-note">Open a file in the Operating System, or the knowledge graph from its View menu.</p> : null;

  return (
    <div className="os-center">
      <EditorGroup g={0} />
      {tabs.some((t) => t.in.includes(1)) ? <EditorGroup g={1} /> : null}
    </div>
  );
}

/** One editor group: its tabs (the left one with the knowledge graph first) and the file it shows. Using it gives it the focus. */
function EditorGroup({ g }: { g: Group }) {
  const all = useStore(ide, (s) => s.tabs);
  const active = useStore(ide, (s) => (g ? s.activeRight : s.active));
  const focused = useStore(ide, (s) => s.focus === g);
  const graphOpen = useStore(ide, (s) => s.graphOpen) && g === 0;
  const [error, setError] = useState("");
  const tabs = all.filter((t) => t.in.includes(g));
  const tab = tabs.find((t) => t.path === active);
  const act = (run: () => Promise<unknown>) => () => run().catch((err) => setError(errorText(err)));

  return (
    <section className="os-group" data-focused={focused || undefined} aria-label={g ? "Right editor" : "Editor"} onFocus={() => focused || ide.set({ focus: g })}>
      {tabs.length || graphOpen ? (
        <div className="tabs" role="tablist" aria-label={g ? "Files open on the right" : "Open files"}>
          {graphOpen ? (
            <div className="tab" data-active={!tab || undefined}>
              <button type="button" role="tab" aria-selected={!tab} title="Your notes and the [[links]] between them" onClick={() => show(0, "")}>
                <Waypoints size={12} aria-hidden />
                <span className="truncate">Knowledge graph</span>
              </button>
              <button type="button" className="icon-btn" aria-label="Close the knowledge graph" onClick={() => ide.set({ graphOpen: false })}>
                <X size={12} />
              </button>
            </div>
          ) : null}
          {tabs.map((t) => (
            <div key={t.path} className="tab" data-active={t.path === active || undefined}>
              <button type="button" role="tab" aria-selected={t.path === active} title={t.path} onClick={() => show(g, t.path)}>
                <span className="truncate">{baseName(t.path)}</span>
                {t.text !== t.saved ? <span className="tab-dirty" role="img" aria-label="unsaved changes" /> : null}
              </button>
              <button type="button" className="icon-btn" aria-label={`Close ${baseName(t.path)}`} onClick={() => closeFile(t.path, g)}>
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {error ? (
        <p className="pane-note" role="alert">
          {error}
        </p>
      ) : null}
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
            {/\.html?$/i.test(tab.path) ? (
              <button type="button" className="icon-btn" aria-label="Open in my browser" title="Open in my browser (saves it first)" onClick={act(() => saveTab(tab.path).then(() => runFile(tab.path)))}>
                <Globe size={15} />
              </button>
            ) : RUNNERS[tab.path.split(".").pop()?.toLowerCase() ?? ""] ? (
              <button type="button" className="icon-btn" aria-label="Run in the terminal" title="Run in the terminal (saves it first)" onClick={act(() => saveTab(tab.path).then(() => runFile(tab.path)))}>
                <Play size={15} />
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
            {g === 0 ? (
              <button type="button" className="icon-btn" aria-label="Split right" title="Split right: open this file on the right too. What you open next goes in the side you last used" onClick={() => openIn(1, tab.path)}>
                <Columns2 size={15} />
              </button>
            ) : null}
            <button type="button" className="icon-btn" aria-label={`Delete ${tab.path}`} title="Delete" onClick={act(() => discard(tab.path))}>
              <Trash2 size={15} />
            </button>
            <button type="button" className="icon-btn icon-btn-primary" aria-label="Save" disabled={tab.text === tab.saved} title="Save (Ctrl+S)" onClick={act(() => saveTab(tab.path))}>
              <Save size={15} />
            </button>
          </div>
        </div>
      ) : graphOpen ? (
        <NoteGraph current={active} />
      ) : null}
    </section>
  );
}

/** The center as an Artifacts tab, while the Operating System is a side section, not expanded. */
export const EDITOR_PAGE = { id: "editor", label: "Editor", icon: FileCode, view: <Center away /> };
