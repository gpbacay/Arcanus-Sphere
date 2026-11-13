"use client";

// Version control for Arcanus's own source: what changed, the change itself, commit, pull and push, and the history.
// It is git on the computer Arcanus runs from (source.ts), so it shows the same repository your terminal does.
import { FileCode, GitCommitHorizontal, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { errorText, useStore } from "@/shared/store";
import { SOURCE, git, remove, workspace } from "./fs";
import { openFile } from "./ide";
import { sourceGit } from "./source";

type Change = { code: string; path: string };
type State = { branch: string; changes: Change[]; log: string[] };

const WHAT: Record<string, string> = { M: "changed", A: "added", D: "deleted", R: "renamed", "?": "new", U: "in conflict" };

export function Git() {
  const version = useStore(workspace, (s) => s.version);
  const [state, setState] = useState<State | null>(null);
  const [diff, setDiff] = useState<{ path: string; text: string } | null>(null);
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const [status, log] = await Promise.all([sourceGit(["status", "--porcelain=v1", "-b", "-uall"]), sourceGit(["log", "--pretty=%h %s (%cr)", "-15"])]);
        if (!current) return;
        if (status.code) return setNote(status.out);
        const [head = "", ...lines] = status.out.split("\n");
        setState({
          branch: head.replace(/^## /, ""),
          // "R  old -> new" names the new file; a name git quoted (spaces, accents) loses its quotes.
          changes: lines.filter(Boolean).map((line) => ({ code: line.slice(0, 2).trim()[0] ?? "M", path: (line.slice(3).split(" -> ").pop() ?? "").replace(/^"|"$/g, "") })),
          log: log.code ? [] : log.out.split("\n").filter(Boolean),
        });
      } catch (err) {
        if (current) setNote(errorText(err));
      }
    })();
    return () => {
      current = false;
    };
  }, [version]);

  /** Run git commands one after another; the last one's words are shown. A failure stops the rest. */
  const run = (...commands: string[][]) => async () => {
    setBusy(true);
    setNote("");
    try {
      for (const args of commands) {
        const { out, code } = await git(...args);
        setNote(out.split("\n").slice(0, 6).join("\n"));
        if (code) break;
      }
    } catch (err) {
      setNote(errorText(err));
    }
    setBusy(false);
  };

  async function show(change: Change) {
    if (change.code === "?") return openFile(`${SOURCE}/${change.path}`).catch((err) => setNote(errorText(err))); // a new file has no earlier version to compare
    const { out } = await sourceGit(["diff", "HEAD", "--", change.path]);
    setDiff({ path: change.path, text: out || "No difference in its text." });
  }

  async function discard(change: Change) {
    if (!window.confirm(`Discard your changes to ${change.path}? This can't be undone.`)) return;
    if (change.code === "?") await remove(`${SOURCE}/${change.path}`).catch((err) => setNote(errorText(err)));
    else await run(["restore", "--staged", "--worktree", "--source=HEAD", "--", change.path])();
    setDiff(null);
  }

  if (!state) return <div className="pane-body">{note ? <p className="pane-note" role="alert">{note}</p> : <p className="pane-note">Reading git…</p>}</div>;

  return (
    <div className="pane-body git">
      <p className="pane-path" title="The branch, and how far it is from its remote">
        {state.branch}
      </p>
      <form
        className="git-commit"
        onSubmit={(e) => {
          e.preventDefault();
          void run(["add", "-A"], ["commit", "-m", message.trim()])().then(() => setMessage(""));
        }}
      >
        <input className="field" value={message} placeholder="What did you change?" aria-label="Commit message" onChange={(e) => setMessage(e.target.value)} />
        <button type="submit" className="btn btn-primary" disabled={busy || !message.trim() || !state.changes.length} title="Stage every change and commit it">
          <GitCommitHorizontal size={14} aria-hidden /> Commit all
        </button>
      </form>
      <div className="git-sync">
        <button type="button" className="btn" disabled={busy} onClick={run(["pull", "--ff-only"])}>
          Pull
        </button>
        <button type="button" className="btn" disabled={busy} onClick={run(["push"])}>
          Push
        </button>
      </div>
      {note ? (
        <pre className="git-note" role="status">
          {note}
        </pre>
      ) : null}

      <h3 className="git-title">Changes · {state.changes.length}</h3>
      {state.changes.length ? (
        <ul className="entries">
          {state.changes.map((change) => (
            <li key={change.path}>
              <button type="button" title={`${WHAT[change.code] ?? change.code}: show the change`} aria-pressed={diff?.path === change.path} onClick={() => void show(change)}>
                <span className="git-code" data-code={change.code}>
                  {change.code}
                </span>
                <span className="truncate">{change.path}</span>
              </button>
              {change.code !== "D" ? (
                <button type="button" className="icon-btn" aria-label={`Open ${change.path} in the editor`} title="Open in the editor" onClick={() => void openFile(`${SOURCE}/${change.path}`).catch((err) => setNote(errorText(err)))}>
                  <FileCode size={14} />
                </button>
              ) : null}
              <button type="button" className="icon-btn" aria-label={`Discard changes to ${change.path}`} title="Discard this change" disabled={busy} onClick={() => void discard(change)}>
                <Undo2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pane-note">Nothing has changed since the last commit.</p>
      )}
      {diff ? (
        <pre className="diff" aria-label={`Changes to ${diff.path}`}>
          {diff.text.split("\n").map((line, i) => (
            <span key={i} data-line={line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "del" : line.startsWith("@@") ? "hunk" : undefined}>
              {line}
              {"\n"}
            </span>
          ))}
        </pre>
      ) : null}

      <h3 className="git-title">History</h3>
      {state.log.length ? (
        <ol className="git-log">
          {state.log.map((line) => (
            <li key={line} title={line}>
              <code>{line.slice(0, line.indexOf(" "))}</code> {line.slice(line.indexOf(" ") + 1)}
            </li>
          ))}
        </ol>
      ) : (
        <p className="pane-note">No commits yet.</p>
      )}
    </div>
  );
}
