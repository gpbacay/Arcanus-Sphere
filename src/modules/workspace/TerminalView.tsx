"use client";

import { Plus, SquareTerminal, Trash2, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { errorText, useStore } from "@/shared/store";
import { closeTerminal, ide, newTerminal, patchTerm, running, showTerminal, type Term } from "./ide";
import { browseFile, complete, promptOf, runLine } from "./terminal";

/** A terminal is named by its place among those open, so three open ones are 1, 2 and 3 however many came and went. */
const name = (terms: Term[], t: Term) => `arcanus ${terms.indexOf(t) + 1}`;

/** Type a line at a terminal's prompt and run it (the terminal shown, unless told). Enter on nothing is a new prompt. */
export async function exec(typed: string, from?: number) {
  const text = typed.trim();
  showTerminal();
  const id = from ?? ide.state.term;
  const here = () => ide.state.terms.find((t) => t.id === id);
  if (!here()) return;
  if (here()?.busy) return; // a program is running there: Ctrl+C first
  patchTerm(id, (t) => ({ line: "", busy: !!text, log: [...t.log, { kind: "in", text, at: promptOf(t.cwd) }] }));
  if (!text) return;
  const stop = new AbortController();
  running.set(id, stop);
  // A program's output comes in pieces: each adds to the answer under the line typed. Only the newest 200 000
  // characters are kept, so a dev server left running for hours doesn't fill the page.
  const stream = (text: string) =>
    patchTerm(id, (t) => {
      const last = t.log.at(-1);
      return { log: last?.kind === "out" ? [...t.log.slice(0, -1), { kind: "out", text: (last.text + text).slice(-200_000) }] : [...t.log, { kind: "out", text }] };
    });
  try {
    const out = await runLine(text, here()?.cwd ?? "", stream, stop.signal);
    patchTerm(id, (t) => ({
      busy: false,
      cwd: out.cwd ?? t.cwd,
      log: out.clear ? [] : out.out ? [...t.log, { kind: "out", text: out.out }] : trimmed(t.log),
    }));
    if (out.exit) closeTerminal(id);
  } catch (err) {
    patchTerm(id, (t) => ({ busy: false, log: [...t.log, { kind: "err", text: errorText(err) }] }));
  } finally {
    running.delete(id);
  }
}

/** A program's answer ends with a newline, which would show as an empty row. */
const trimmed = (log: Term["log"]) => {
  const last = log.at(-1);
  return last?.kind === "out" ? [...log.slice(0, -1), { ...last, text: last.text.replace(/\s+$/, "") }] : log;
};

/** Open a file the way its kind asks: a page in my browser; a program run in a terminal, from its own folder
 *  (a new terminal when this one is busy); anything else, nothing. */
export async function runFile(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "html" || ext === "htm") return void (await browseFile(path));
  const runner = RUNNERS[ext];
  if (!runner) return;
  if (ide.state.terms.find((t) => t.id === ide.state.term)?.busy || !ide.state.terms.length) newTerminal();
  const at = path.lastIndexOf("/");
  patchTerm(ide.state.term, () => ({ cwd: path.slice(0, Math.max(at, 0)) }));
  await exec(`${runner} "${path.slice(at + 1)}"`);
}

/** How a file of each kind is run, by the programs people install for it. */
export const RUNNERS: Record<string, string> = { js: "node", mjs: "node", cjs: "node", ts: "node", py: "python", rb: "ruby", php: "php", go: "go run", sh: "bash", ps1: "powershell -File", bat: "call", cmd: "call", java: "java", lua: "lua", pl: "perl", r: "Rscript", dart: "dart run" };

/** A diff's added and removed lines, and its hunk marks, are coloured; the rest of an answer is plain. */
const rowTone = (row: string) => (/^\+(?!\+\+)/.test(row) ? "add" : /^-(?!--)/.test(row) ? "del" : row.startsWith("@@") ? "hunk" : undefined);

/** The terminal panel along the foot of the pane: a third of its height to start, dragged to taller or shorter. Several
 *  terminals can be open at once; with more than one, they are listed down the right. */
export function TerminalPanel() {
  const terms = useStore(ide, (s) => s.terms);
  const current = useStore(ide, (s) => s.term);
  const height = useStore(ide, (s) => s.termH);
  const panel = useRef<HTMLElement>(null);
  const active = terms.find((t) => t.id === current) ?? terms[0];
  const size = (h: number) => ide.set({ termH: Math.min(0.8, Math.max(0.15, h)) });

  function drag(e: React.PointerEvent<HTMLDivElement>) {
    const pane = panel.current?.parentElement?.getBoundingClientRect();
    if (e.buttons && pane) size((pane.bottom - e.clientY) / pane.height);
  }

  if (!active) return null;
  return (
    <section className="term-panel" ref={panel} style={{ height: `${height * 100}%` }} aria-label="Terminal">
      <div
        className="term-grip"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the terminal"
        aria-valuenow={Math.round(height * 100)}
        aria-valuemin={15}
        aria-valuemax={80}
        tabIndex={0}
        onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
        onPointerMove={drag}
        onKeyDown={(e) => {
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          e.preventDefault();
          size(height + (e.key === "ArrowUp" ? 0.05 : -0.05));
        }}
      />
      <div className="term-bar">
        <span>Terminal</span>
        <button type="button" className="icon-btn" aria-label="New terminal" title="New terminal" onClick={() => newTerminal()}>
          <Plus size={15} />
        </button>
        <button type="button" className="icon-btn" aria-label="Kill this terminal" title="Kill this terminal" onClick={() => closeTerminal(active.id)}>
          <Trash2 size={14} />
        </button>
        <button type="button" className="icon-btn" aria-label="Hide the terminal" title="Hide the terminal" onClick={() => ide.set({ termOpen: false })}>
          <X size={15} />
        </button>
      </div>
      <div className="term-body">
        <Shell key={active.id} term={active} />
        {terms.length > 1 ? (
          <ul className="term-list" aria-label="Terminals">
            {terms.map((t) => (
              <li key={t.id} data-active={t.id === active.id || undefined} data-busy={t.busy || undefined}>
                <button type="button" aria-current={t.id === active.id || undefined} onClick={() => ide.set({ term: t.id })}>
                  <SquareTerminal size={14} aria-hidden />
                  <span className="truncate">{name(terms, t)}</span>
                </button>
                <button type="button" className="icon-btn" aria-label={`Kill ${name(terms, t)}`} title="Kill" onClick={() => closeTerminal(t.id)}>
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

/** One terminal's screen: what was typed and answered, and the prompt right after the last answer. */
function Shell({ term }: { term: Term }) {
  const { id, log, line, cwd, busy } = term;
  const screen = useRef<HTMLDivElement>(null);
  const prompt = useRef<HTMLInputElement>(null);
  const recall = useRef(-1); // how far Up has gone back through what was typed
  const cycle = useRef<{ shown: string; options: string[]; at: number } | null>(null); // Tab's choices, one at a time

  useEffect(() => {
    screen.current?.scrollTo({ top: screen.current.scrollHeight }); // newer Chrome returns a promise: not the effect's to return
  }, [log, busy]);
  useEffect(() => {
    prompt.current?.focus(); // keep the keys here while a program runs (Ctrl+C), and after it ends
  }, [busy]);

  const set = (next: string) => patchTerm(id, () => ({ line: next }));
  const typed = log.filter((l) => l.kind === "in" && l.text);

  async function tab() {
    const c = cycle.current;
    if (c && c.shown === line) {
      c.at = (c.at + 1) % c.options.length;
      c.shown = c.options[c.at];
      return set(c.shown);
    }
    const options = await complete(line, cwd);
    if (!options.length) return;
    cycle.current = { shown: options[0], options, at: 0 };
    set(options[0]);
  }

  function keys(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      recall.current = Math.max(-1, Math.min(recall.current + (e.key === "ArrowUp" ? 1 : -1), typed.length - 1));
      set(recall.current < 0 ? "" : typed[typed.length - 1 - recall.current].text);
    } else if (e.key === "Tab") {
      e.preventDefault();
      void tab();
    } else if (e.key === "Escape") set("");
    else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      patchTerm(id, () => ({ log: [] }));
    } else if (e.key === "c" && e.ctrlKey && prompt.current?.selectionStart === prompt.current?.selectionEnd) {
      e.preventDefault(); // cmd: ^C stops the program running, or drops the line and gives a new prompt
      if (busy) return void running.get(id)?.abort();
      patchTerm(id, (t) => ({ line: "", log: [...t.log, { kind: "in", text: `${line}^C`, at: promptOf(t.cwd) }] }));
    }
  }

  return (
    <div className="term-screen" ref={screen} role="log" aria-label="Terminal output" onClick={() => !window.getSelection()?.toString() && prompt.current?.focus()}>
      {log.map((l, i) =>
        l.kind === "in" ? (
          <div key={i} className="term-in">
            <span aria-hidden>{l.at}</span>
            {l.text}
          </div>
        ) : (
          <div key={i} className="term-out" data-err={l.kind === "err" || undefined}>
            {l.text.split("\n").map((row, j) => (
              <div key={j} data-tone={rowTone(row)}>
                {row || " "}
              </div>
            ))}
          </div>
        )
      )}
      <form
        className="term-prompt"
        data-busy={busy || undefined}
        onSubmit={(e) => {
          e.preventDefault();
          recall.current = -1;
          void exec(line, id);
        }}
      >
        <span aria-hidden>{promptOf(cwd)}</span>
        <input
          ref={prompt}
          autoFocus
          value={busy ? "" : line}
          readOnly={busy} // not disabled: it keeps the keys, so Ctrl+C reaches a running program
          placeholder={busy ? "Running… Ctrl+C stops it" : undefined}
          aria-label={`Command, at ${promptOf(cwd)}`}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          onKeyDown={keys}
          onChange={(e) => set(e.target.value)}
        />
      </form>
    </div>
  );
}
