"use client";

// The code editor: CodeMirror 6, with line numbers, syntax colours, undo, find (Ctrl+F), bracket matching and folding.
// It ships with the app, so it works offline, and it is loaded only when a file is first opened (Files.tsx), so it
// costs the boot nothing.
// ponytail: one editor per open file, made new when the tab changes, so undo history and scroll don't survive a tab
// switch. Keep an EditorState per tab if that starts to matter.
import { indentWithTab } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { keymap } from "@codemirror/view";
import { EditorView, basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

function language(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (/^(?:ts|tsx|js|jsx|mjs|cjs)$/.test(ext)) return javascript({ typescript: ext.startsWith("ts"), jsx: ext.endsWith("x") });
  if (ext === "css") return css();
  if (ext === "json" || ext === "webmanifest") return json();
  if (ext === "md") return markdown();
  if (ext === "html" || ext === "svg") return html();
  return [];
}

// Arcanus's own glass and type under One Dark's syntax colours.
const look = EditorView.theme(
  {
    "&": { height: "100%", fontSize: "12px", backgroundColor: "transparent" },
    ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.55", scrollbarWidth: "thin" },
    ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "var(--text-faint)" },
    ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--surface)" },
    "&.cm-focused": { outline: "none" },
  },
  { dark: true },
);

export default function Editor({ path, text, onChange, onSave }: { path: string; text: string; onChange: (text: string) => void; onSave: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const on = useRef({ onChange, onSave });
  useEffect(() => {
    on.current = { onChange, onSave };
  });

  useEffect(() => {
    const editor = new EditorView({
      doc: text,
      parent: host.current!,
      extensions: [
        keymap.of([{ key: "Mod-s", preventDefault: true, run: () => (on.current.onSave(), true) }, indentWithTab]),
        basicSetup,
        look,
        oneDark,
        EditorView.lineWrapping,
        language(path),
        EditorView.updateListener.of((update) => update.docChanged && on.current.onChange(update.state.doc.toString())),
      ],
    });
    view.current = editor;
    return () => editor.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one editor per file; its text is kept in step below
  }, [path]);

  // The file changed under the editor (Arcanus wrote it, git restored it): show what it holds now.
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== text) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
  }, [text]);

  return <div ref={host} className="code" role="group" aria-label={`Contents of ${path}`} />;
}
