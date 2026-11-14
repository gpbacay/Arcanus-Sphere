"use client";

// Version control for Arcanus's own source, laid out as an editor's: the changes with a commit box, the branch and its
// sync with the remote, the commit graph, and GitHub. It is git on the computer Arcanus runs from (source.ts), so it
// shows the same repository your terminal and editor do, and pushes with the same sign-in.
import { ArrowDown, ArrowUp, Check, ChevronDown, Cloud, CloudUpload, ExternalLink, FileCode, GitBranch, RefreshCw, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorText, useStore } from "@/shared/store";
import { Grip } from "@/shared/ui/grip";
import { Info } from "@/shared/ui/info";
import { PopMenu } from "@/shared/ui/pop-menu";
import { SOURCE, git, remove, workspace } from "./fs";
import { lanes, type Row } from "./graph";
import { ide, openFile } from "./ide";
import { githubAccount, source, sourceGit, type Repo } from "./source";

type Change = { code: string; path: string };
type Commit = { hash: string; parents: string[]; refs: string[]; subject: string; author: string; when: string };
type State = { branch: string; upstream: string; ahead: number; behind: number; changes: Change[]; commits: Commit[] };

const WHAT: Record<string, string> = { M: "Modified", A: "Added", D: "Deleted", R: "Renamed", "?": "Untracked", U: "In conflict" };
/** The letter an editor shows: an untracked file is U, a conflict ! (git's own U). */
const LETTER: Record<string, string> = { "?": "U", U: "!" };
const LANE = ["var(--accent)", "var(--think)", "var(--ok)", "#c58bff", "var(--danger)"];
const SEP = "\x1f";

/** "## main...origin/main [ahead 1, behind 2]" -> its parts. A branch with no commits yet, or no remote, has fewer. */
function head(line: string) {
  const m = line.match(/^## (?:No commits yet on |Initial commit on )?(\S+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/);
  const counts = m?.[3] ?? "";
  return { branch: m?.[1] ?? line.replace(/^## /, ""), upstream: m?.[2] ?? "", ahead: Number(counts.match(/ahead (\d+)/)?.[1] ?? 0), behind: Number(counts.match(/behind (\d+)/)?.[1] ?? 0) };
}

async function read(): Promise<State> {
  const [status, log] = await Promise.all([
    sourceGit(["status", "--porcelain=v1", "-b", "-uall"]),
    sourceGit(["log", "--topo-order", "-n", "150", `--pretty=format:%H${SEP}%P${SEP}%D${SEP}%s${SEP}%an${SEP}%cr`, "HEAD", "--branches", "--remotes"]),
  ]);
  if (status.code) throw new Error(status.out);
  const [first = "", ...lines] = status.out.split("\n");
  return {
    ...head(first),
    // "R  old -> new" names the new file; a name git quoted (spaces, accents) loses its quotes.
    changes: lines.filter(Boolean).map((line) => ({ code: line.slice(0, 2).trim()[0] ?? "M", path: (line.slice(3).split(" -> ").pop() ?? "").replace(/^"|"$/g, "") })),
    // A repository with no commits yet has no HEAD: no history, not an error.
    commits: log.code
      ? []
      : log.out.split("\n").flatMap((line) => {
          const [hash, parents, refs, subject, author, when] = line.split(SEP);
          return hash ? [{ hash, parents: parents ? parents.split(" ") : [], refs: refs ? refs.split(", ").filter((r) => !r.endsWith("/HEAD")) : [], subject, author, when }] : [];
        }),
  };
}

/** Git beside the terminal: the branch and its sync, then the Changes and Git Graph accordions that are switched on. */
export function Git({ changes = true, graph: showGraph = true }: { changes?: boolean; graph?: boolean }) {
  const version = useStore(workspace, (s) => s.version);
  const [state, setState] = useState<State | null>(null);
  const [shown, setShown] = useState<{ title: string; text: string } | null>(null);
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const graphH = useStore(ide, (s) => s.gitGraphH);
  const graphBox = useRef<HTMLOListElement>(null);
  const sizeGraph = (h: number) => ide.set({ gitGraphH: Math.min(900, Math.max(60, h)) });

  useEffect(() => {
    let current = true;
    read().then(
      (s) => current && setState(s),
      (err) => current && setNote(errorText(err)),
    );
    return () => {
      current = false;
    };
  }, [version]);

  /** Run git commands one after another; the last one's words are shown. A failure stops the rest. True when all worked. */
  async function run(...commands: string[][]) {
    setBusy(true);
    setNote("");
    let ok = true;
    try {
      for (const args of commands) {
        const { out, code } = await git(...args);
        setNote(out.split("\n").slice(0, 8).join("\n"));
        if (code) {
          ok = false;
          break;
        }
      }
    } catch (err) {
      ok = false;
      setNote(errorText(err));
    }
    setBusy(false);
    return ok;
  }

  async function commit(push: boolean) {
    if (!message.trim()) return;
    const sync = !push ? [] : state?.upstream ? [["push"]] : [["push", "-u", "origin", "HEAD"]];
    if (await run(["add", "-A"], ["commit", "-m", message.trim()], ...sync)) setMessage("");
  }

  async function show(change: Change) {
    if (change.code === "?") return openFile(`${SOURCE}/${change.path}`).catch((err) => setNote(errorText(err))); // a new file has no earlier version to compare
    const { out } = await sourceGit(["diff", "HEAD", "--", change.path]);
    setShown({ title: change.path, text: out || "No difference in its text." });
  }

  async function discard(change: Change) {
    if (!window.confirm(`Discard your changes to ${change.path}? This can't be undone.`)) return;
    if (change.code === "?") await remove(`${SOURCE}/${change.path}`).catch((err) => setNote(errorText(err)));
    else await run(["restore", "--staged", "--worktree", "--source=HEAD", "--", change.path]);
    setShown(null);
  }

  if (!state) return <div className="pane-body">{note ? <p className="pane-note" role="alert">{note}</p> : <p className="pane-note">Reading git…</p>}</div>;
  const graph = lanes(state.commits);

  return (
    <div className="scm">
      <div className="scm-sync">
        <GitBranch size={14} aria-hidden />
        <span className="truncate" title={state.upstream ? `${state.branch}, following ${state.upstream}` : `${state.branch}, not on a remote yet`}>
          {state.branch}
        </span>
        {state.behind ? <span title={`${state.behind} commits to pull`}>↓{state.behind}</span> : null}
        {state.ahead ? <span title={`${state.ahead} commits to push`}>↑{state.ahead}</span> : null}
        <span className="scm-gap" />
        <button type="button" className="icon-btn" aria-label="Fetch" title="Fetch: see what the remote has" disabled={busy} onClick={() => void run(["fetch", "--prune"])}>
          <RefreshCw size={14} />
        </button>
        <button type="button" className="icon-btn" aria-label="Pull" title="Pull" disabled={busy || !state.upstream} onClick={() => void run(["pull", "--ff-only"])}>
          <ArrowDown size={15} />
        </button>
        {state.upstream ? (
          <button type="button" className="icon-btn" aria-label="Push" title="Push" disabled={busy} onClick={() => void run(["push"])}>
            <ArrowUp size={15} />
          </button>
        ) : (
          <button type="button" className="icon-btn" aria-label="Publish the branch" title="Publish the branch to origin" disabled={busy} onClick={() => void run(["push", "-u", "origin", "HEAD"])}>
            <CloudUpload size={15} />
          </button>
        )}
      </div>

      {changes || shown ? (
        <div className="pane-body scm-scroll">
          {changes ? (
            <details className="scm-section" open>
              <summary>Changes</summary>
              <form
                className="scm-commit"
                onSubmit={(e) => {
                  e.preventDefault();
                  void commit(false);
                }}
              >
                <textarea
                  className="field"
                  rows={2}
                  value={message}
                  placeholder={`Message (Ctrl+Enter to commit on "${state.branch}")`}
                  aria-label="Commit message"
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && e.ctrlKey && (e.preventDefault(), void commit(false))}
                />
                <div className="scm-commit-btn">
                  <button type="submit" className="btn btn-primary" disabled={busy || !message.trim() || !state.changes.length} title="Stage every change and commit it">
                    <Check size={14} aria-hidden /> Commit
                  </button>
                  <PopMenu
                    label="More commit actions"
                    disabled={busy || !message.trim() || !state.changes.length}
                    className="btn btn-primary"
                    trigger={<ChevronDown size={14} />}
                    items={[{ label: state.upstream ? "Commit & Push" : "Commit & Publish", icon: CloudUpload, run: () => commit(true) }]}
                  />
                </div>
              </form>
              {note ? (
                <pre className="git-note" role="status">
                  {note}
                </pre>
              ) : null}
              <h3 className="scm-title">
                Changes <span className="scm-count">{state.changes.length}</span>
              </h3>
              {state.changes.length ? (
                <ul className="entries scm-changes">
                  {state.changes.map((change) => {
                    const cut = change.path.lastIndexOf("/");
                    return (
                      <li key={change.path} data-code={change.code}>
                        <button type="button" title={`${change.path} · ${WHAT[change.code] ?? change.code}`} aria-pressed={shown?.title === change.path} onClick={() => void show(change)}>
                          <span className="truncate">{change.path.slice(cut + 1)}</span>
                          <span className="scm-dir truncate">{cut > 0 ? change.path.slice(0, cut).replace(/\//g, "\\") : ""}</span>
                        </button>
                        {change.code !== "D" ? (
                          <button type="button" className="icon-btn scm-hover" aria-label={`Open ${change.path}`} title="Open in the editor" onClick={() => void openFile(`${SOURCE}/${change.path}`).catch((err) => setNote(errorText(err)))}>
                            <FileCode size={14} />
                          </button>
                        ) : null}
                        <button type="button" className="icon-btn scm-hover" aria-label={`Discard changes to ${change.path}`} title="Discard this change" disabled={busy} onClick={() => void discard(change)}>
                          <Undo2 size={14} />
                        </button>
                        <span className="scm-letter" title={WHAT[change.code] ?? change.code}>
                          {LETTER[change.code] ?? change.code}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="pane-note">Nothing has changed since the last commit.</p>
              )}
            </details>
          ) : null}

          {shown ? (
            <pre className="diff" aria-label={shown.title}>
              {shown.text.split("\n").map((line, i) => (
                <span key={i} data-line={line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "del" : line.startsWith("@@") ? "hunk" : undefined}>
                  {line}
                  {"\n"}
                </span>
              ))}
            </pre>
          ) : null}

          {changes ? (
            <details className="scm-section" open>
              <summary>GitHub</summary>
              <GitHub />
            </details>
          ) : null}
        </div>
      ) : null}

      {showGraph ? (
        <details className="scm-section scm-graph-section" open>
          {changes ? (
            <Grip
              label="Resize the Git Graph"
              value={graphH}
              min={60}
              max={900}
              drag={(_, y) => {
                const list = graphBox.current?.getBoundingClientRect();
                const section = graphBox.current?.parentElement?.getBoundingClientRect();
                if (list && section) sizeGraph(list.bottom - y - (list.top - section.top)); // the grip is the section's top edge
              }}
              nudge={(step) => sizeGraph(graphH - step * 20)}
            />
          ) : null}
          <summary>Git Graph</summary>
          {state.commits.length ? (
            <ol className="scm-graph" ref={graphBox} style={changes ? { height: graphH } : undefined}>
              {state.commits.map((c, i) => (
                <li key={c.hash}>
                  <button
                    type="button"
                    title={`${c.hash.slice(0, 7)} · ${c.author} · ${c.when}`}
                    aria-pressed={shown?.title === c.hash}
                    onClick={() =>
                      void sourceGit(["show", "--stat", "--format=%H%nAuthor: %an <%ae>%nDate:   %ad%n%n%B", c.hash]).then(({ out }) => setShown({ title: c.hash, text: out }))
                    }
                  >
                    <Lanes row={graph.rows[i]} width={graph.width} head={c.refs.some((r) => r.startsWith("HEAD"))} />
                    <span className="truncate">{c.subject}</span>
                    {c.refs.map((ref) => (
                      <RefBadge key={ref} name={ref} />
                    ))}
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="pane-note">No commits yet.</p>
          )}
        </details>
      ) : null}
    </div>
  );
}

/** A branch, remote branch or tag on a commit: the checked-out one marked, a remote one with a cloud. */
function RefBadge({ name }: { name: string }) {
  const local = name.startsWith("HEAD -> ") ? name.slice(8) : "";
  const tag = name.startsWith("tag: ") ? name.slice(5) : "";
  const remote = !local && !tag && name.includes("/");
  return (
    <span className="scm-ref" data-kind={local ? "head" : tag ? "tag" : remote ? "remote" : "branch"} title={name}>
      {remote ? <Cloud size={11} aria-hidden /> : <GitBranch size={11} aria-hidden />}
      {local || tag || name}
    </span>
  );
}

/** GitHub's mark (lucide has no brand icons), at the size and colour of the icons beside it. */
function Github({ size = 14 }: { size?: number; "aria-hidden"?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

const W = 14;
const H = 26;
const x = (lane: number) => W / 2 + lane * W;

/** One row of the graph: the lines through it and the commit's dot. */
function Lanes({ row, width, head }: { row: Row; width: number; head: boolean }) {
  const colour = (lane: number) => LANE[lane % LANE.length];
  return (
    <svg className="scm-lanes" width={width * W} height={H} viewBox={`0 0 ${width * W} ${H}`} aria-hidden>
      {row.top.map(([a, b], i) => (
        <path key={`t${i}`} d={`M${x(a)} 0 C${x(a)} ${H / 4} ${x(b)} ${H / 4} ${x(b)} ${H / 2}`} stroke={colour(a)} />
      ))}
      {row.bottom.map(([a, b], i) => (
        <path key={`b${i}`} d={`M${x(a)} ${H / 2} C${x(a)} ${(H * 3) / 4} ${x(b)} ${(H * 3) / 4} ${x(b)} ${H}`} stroke={colour(b)} />
      ))}
      <circle cx={x(row.col)} cy={H / 2} r={head ? 4.5 : 3.5} stroke={colour(row.col)} fill={head ? colour(row.col) : "#0a0f16"} />
    </svg>
  );
}

/** "git@github.com:me/repo.git" or "https://github.com/me/repo.git" -> the repository's page. */
const pageOf = (remote: string) => remote.replace(/^git@([^:]+):/, "https://$1/").replace(/\.git$/, "");

/** GitHub: sign this computer's git in with a token, then point the source's origin at a repository, or make one. */
function GitHub() {
  const version = useStore(workspace, (s) => s.version);
  const project = useStore(source, (s) => s.name);
  const [account, setAccount] = useState<{ login: string; remote: string; stale?: boolean } | null>(null);
  const [token, setToken] = useState("");
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [picked, setPicked] = useState("");
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false); // "private" is the default: a public repository is a choice
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    githubAccount.status().then(
      (a) => current && setAccount(a),
      (err) => current && setNote(errorText(err)),
    );
    return () => {
      current = false;
    };
  }, [version]);

  const act = (work: () => Promise<unknown>) => async () => {
    setBusy(true);
    setNote("");
    try {
      await work();
      setAccount(await githubAccount.status());
    } catch (err) {
      setNote(errorText(err));
    }
    setBusy(false);
  };
  const choose = act(async () => {
    setChoosing(true);
    setName(project);
    setRepos(await githubAccount.repos());
  });
  /** Make `url` the source's origin, adding it or replacing the one there. */
  const setOrigin = async (url: string) => {
    const { code, out } = await git("remote", account?.remote ? "set-url" : "add", "origin", url);
    if (code) throw new Error(out);
    setChoosing(false);
  };

  if (!account) return note ? <p className="pane-note" role="alert">{note}</p> : <p className="pane-note">Asking git…</p>;

  if (!account.login)
    return (
      <form
        className="scm-github"
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            await githubAccount.connect(token);
            setToken("");
          })();
        }}
      >
        <div className="pane-note scm-intro">
          <span>{account.stale ? "This computer's GitHub sign-in no longer works." : "Connect GitHub to push Arcanus's code."}</span>
          <Info label="About the GitHub token">
            <p>
              Connect your GitHub to push Arcanus&apos;s code to your own repository. Make a token with the <code>repo</code> scope; it is kept in
              git&apos;s credential store on this computer, the one your terminal uses, and never stored in this browser.
            </p>
          </Info>
        </div>
        <a className="scm-link" href="https://github.com/settings/tokens/new?scopes=repo&description=Arcanus" target="_blank" rel="noreferrer">
          <ExternalLink size={13} aria-hidden /> Create a token on GitHub
        </a>
        <input className="field" type="password" value={token} placeholder="ghp_… or github_pat_…" aria-label="GitHub token" autoComplete="off" onChange={(e) => setToken(e.target.value)} />
        <button type="submit" className="btn btn-primary" disabled={busy || !token.trim()}>
          <Github size={14} aria-hidden /> Connect GitHub
        </button>
        {note ? <p className="pane-note" role="alert">{note}</p> : null}
      </form>
    );

  return (
    <div className="scm-github">
      <p className="scm-account">
        <Github size={14} aria-hidden />
        <a href={`https://github.com/${account.login}`} target="_blank" rel="noreferrer">
          {account.login}
        </a>
        <span className="scm-gap" />
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() =>
            window.confirm("Sign this computer's git out of GitHub? Your terminal and editor use the same sign-in, so they will ask again too.") &&
            void act(() => githubAccount.disconnect())()
          }
        >
          Sign out
        </button>
      </p>
      {account.remote && !choosing ? (
        <p className="scm-remote">
          <span className="truncate" title={account.remote}>
            origin · {account.remote.replace(/^https:\/\/|^git@/, "").replace(/\.git$/, "")}
          </span>
          {/github\.com/.test(account.remote) ? (
            <a className="icon-btn" href={pageOf(account.remote)} target="_blank" rel="noreferrer" aria-label="Open the repository on GitHub" title="Open on GitHub">
              <ExternalLink size={13} />
            </a>
          ) : null}
          <button type="button" className="btn" disabled={busy} onClick={() => void choose()}>
            Change
          </button>
        </p>
      ) : !choosing ? (
        <>
          <p className="pane-note">This code isn&apos;t on GitHub yet: pick a repository of yours, or make one, and it becomes the origin you push to.</p>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void choose()}>
            Connect a repository
          </button>
        </>
      ) : (
        <div className="scm-choose">
          <label className="setting-label" htmlFor="scm-repo">
            One of your repositories
          </label>
          <div className="row">
            <select id="scm-repo" className="field" value={picked} disabled={!repos} onChange={(e) => setPicked(e.target.value)}>
              <option value="">{repos ? "Choose…" : "Reading your repositories…"}</option>
              {repos?.map((r) => (
                <option key={r.url} value={r.url}>
                  {r.name}
                  {r.private ? " · private" : ""}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-primary" disabled={busy || !picked} onClick={() => void act(() => setOrigin(picked))()}>
              Use
            </button>
          </div>
          <label className="setting-label" htmlFor="scm-new">
            Or a new one
          </label>
          <div className="row">
            <input id="scm-new" className="field" value={name} placeholder="Repository name" onChange={(e) => setName(e.target.value)} />
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !name.trim()}
              title="Make it on GitHub, make it the origin, and push this branch there"
              onClick={() =>
                void act(async () => {
                  const made = await githubAccount.create(name.trim(), !open);
                  await setOrigin(made.url);
                  const pushed = await git("push", "-u", "origin", "HEAD");
                  setNote(pushed.out.split("\n").slice(-3).join("\n"));
                })()
              }
            >
              Create & push
            </button>
          </div>
          <label className="scm-check">
            <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} /> Public
          </label>
          <button type="button" className="btn" onClick={() => setChoosing(false)}>
            Cancel
          </button>
        </div>
      )}
      {note ? <pre className="git-note">{note}</pre> : null}
    </div>
  );
}
