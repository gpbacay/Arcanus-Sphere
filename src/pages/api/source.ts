// Arcanus's own source: the project this server runs from, as files Arcanus can read and write, and its git history.
// The browser can't reach the disk, and the code that is running lives there, so this route is the way in.
//   GET  /api/source                          -> { name, branch }
//   POST /api/source { op: "list", path }     -> { entries }
//   POST /api/source { op: "read", path }     -> { text }          (404 when it isn't there)
//   POST /api/source { op: "write", path, text } | { op: "mkdir", path } | { op: "remove", path } | { op: "rename", path, to }
//   POST /api/source { op: "files" }          -> { files }         (every file git tracks or would track)
//   POST /api/source { op: "search", query, matchCase?, wholeWord?, regex?, limit? } -> { hits, more } (git grep)
//   POST /api/source { op: "git", args }      -> { out, code }     (one git command, see gitArgs)
//   POST /api/source { op: "run", path, line } -> the output, streamed as it comes (one shell line in that folder:
//                                                npm i, npm run dev, python x.py …); closing the request kills it
//   POST /api/source { op: "github" }         -> { login, remote, stale? }   (who this computer's git is signed in to GitHub as)
//   POST /api/source { op: "github-connect", token } -> { login }  (kept in git's credential store, never sent back)
//   POST /api/source { op: "github-disconnect" } | { op: "github-repos" } -> { repos } | { op: "github-create", name, private }
//
// With pc: true, list, read, write, mkdir, remove, rename and run work on This PC instead: the computer's own drives,
// a path starting with one ("C:/Users"); listing "" lists the drives.
//
// Like /api/device it is a pages/ route that answers only this machine (shared/loopback.ts). Paths in the source never
// leave the project and never enter .git, node_modules, .next or a .env file (workspace/command.ts). With `next dev`, a saved
// file is the running code a moment later.
// ponytail: a symlink inside the project that points outside it is followed. Check realpath if the project ever holds one.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { NextApiRequest, NextApiResponse } from "next";
// eslint-disable-next-line no-restricted-imports -- the public API also carries the browser client; the server needs only this pure part
import { diskParts, gitArgs, hidden, sourceParts } from "@/modules/workspace/command";
import { fromThisMachine } from "@/shared/loopback";
import { disks } from "./device";

const ROOT = process.cwd();
const MAX_READ = 2_000_000;
const MAX_HITS = 200;

// A file is up to 2 MB, and JSON escapes it. What a command prints (npm run dev, for hours) has no limit.
export const config = { api: { bodyParser: { sizeLimit: "4mb" }, responseLimit: false } };

function at(rel: unknown, needsName = false, pc = false) {
  if (typeof rel !== "string") throw new Error("A path is needed.");
  if (pc) {
    const parts = diskParts(rel);
    if (needsName && parts.length < 2) throw new Error("That is a whole drive, not a file or folder on it.");
    return path.join(...parts);
  }
  const parts = sourceParts(rel);
  if (needsName && !parts.length) throw new Error("That is my whole source, not a file or folder in it.");
  return path.join(ROOT, ...parts);
}

/** One git command in the project. It never waits for a password or an editor: there is no one at this terminal. */
function git(args: string[]) {
  return new Promise<{ out: string; code: number }>((resolve) =>
    execFile(
      "git",
      args,
      { cwd: ROOT, windowsHide: true, timeout: 60_000, maxBuffer: 8_000_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true", GIT_PAGER: "cat" } },
      (err, stdout, stderr) => {
        const out = [stdout, stderr].map((s) => s.trimEnd()).filter(Boolean).join("\n");
        resolve({ out: out || (err ? err.message : ""), code: err ? (typeof err.code === "number" ? err.code : 1) : 0 });
      },
    ),
  );
}

/** A program and everything it started: npm run dev is a shell, then npm, then node. */
function kill(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === "win32") execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => undefined);
  else {
    try {
      process.kill(-child.pid, "SIGTERM"); // its process group: it was started detached, as the group's leader
    } catch {
      /* already gone */
    }
  }
}

/**
 * The environment a program run from the terminal gets: this server's, without what Next and npm set for this server
 * itself. A PORT left in makes `next dev` insist on 3000 (taken, by Arcanus) instead of moving to 3001; NODE_ENV would
 * make a build a development one.
 */
const OWN = /^(?:PORT|NODE_ENV|TURBOPACK|INIT_CWD|NEXT_RUNTIME|NEXT_DEPLOYMENT_ID|NEXT_PRIVATE_\w+|__NEXT_\w+|npm_lifecycle_\w+|npm_package_\w+)$/i;
// Next types NODE_ENV as always there; here it is left out on purpose.
const shellEnv = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => !OWN.test(name))) as NodeJS.ProcessEnv;

/** One line in this computer's shell (cmd on Windows, sh elsewhere), in `cwd`, its output streamed back as it comes.
 *  Nothing to type into it: a program that asks a question gets no answer. Closing the request (Ctrl+C) kills it. */
function run(cwd: string, line: string, res: NextApiResponse) {
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache, no-transform", "content-encoding": "none" });
  const child = spawn(line, {
    cwd,
    shell: true,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...shellEnv(), NO_COLOR: "1", FORCE_COLOR: "0", GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat" },
  });
  const end = (text = "") => res.writableEnded || res.end(text);
  child.stdout?.on("data", (chunk) => res.write(chunk));
  child.stderr?.on("data", (chunk) => res.write(chunk));
  child.on("error", (err) => end(`${err.message}\n`));
  child.on("close", (code) => end(code ? `\nExited with code ${code}.\n` : ""));
  res.on("close", () => child.exitCode === null && child.signalCode === null && kill(child));
}

/** `git credential <action>` for github.com, its key=value lines on stdin. It never prompts: there is no one at this terminal. */
function credential(action: "fill" | "approve" | "reject", lines: string[] = []) {
  return new Promise<Record<string, string> | null>((resolve) => {
    const child = execFile(
      "git",
      ["credential", action],
      { cwd: ROOT, windowsHide: true, timeout: 20_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" } },
      (err, stdout) => resolve(err ? null : Object.fromEntries(stdout.split("\n").flatMap((l) => (l.includes("=") ? [[l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]] : [])))),
    );
    child.stdin?.end(["protocol=https", "host=github.com", ...lines, "", ""].join("\n"));
  });
}

/** The GitHub token this computer's git already keeps (Git Credential Manager, or whatever helper it uses), or null. */
const githubToken = async () => (await credential("fill"))?.password || null;

/** A call to GitHub's API with `token`. Its error message, in GitHub's words, when it fails. */
async function github<T>(token: string, route: string, init: { method?: string; body?: object } = {}): Promise<T> {
  const res = await fetch(`https://api.github.com${route}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "Arcanus", "content-type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.errors?.[0]?.message ?? data.message ?? `GitHub answered ${res.status}.`), { status: res.status });
  return data as T;
}

type Repo = { full_name: string; clone_url: string; html_url: string; private: boolean };
const repo = (r: Repo) => ({ name: r.full_name, url: r.clone_url, page: r.html_url, private: r.private });

/** GitHub, for the Operating System's source control: who this computer's git is signed in as, and its repositories. The
 *  token stays on this computer, in git's credential store: it never goes back to the page. */
async function githubOp(body: { op?: unknown; token?: unknown; name?: unknown; private?: unknown }) {
  switch (body.op) {
    case "github": {
      const origin = await git(["remote", "get-url", "origin"]);
      const remote = origin.code ? "" : origin.out;
      const token = await githubToken();
      if (!token) return { login: "", remote };
      const user = await github<{ login: string }>(token, "/user").catch(() => null);
      return { login: user?.login ?? "", remote, stale: !user };
    }
    case "github-connect": {
      if (typeof body.token !== "string" || !/^[\w-]{20,255}$/.test(body.token.trim())) throw new Error("That doesn't look like a GitHub token.");
      const token = body.token.trim();
      const user = await github<{ login: string }>(token, "/user").catch(() => {
        throw new Error("GitHub didn't accept that token. Check it was copied whole and hasn't expired.");
      });
      await credential("approve", [`username=${user.login}`, `password=${token}`]);
      if ((await githubToken()) !== token)
        throw new Error("GitHub accepted the token, but git on this computer has no credential helper to keep it. Run: git config --global credential.helper manager (Windows) or store, then connect again.");
      return { login: user.login };
    }
    case "github-disconnect":
      await credential("reject");
      return { ok: true };
    case "github-repos": {
      const token = await githubToken();
      if (!token) throw new Error("Connect GitHub first.");
      const repos = await github<Repo[]>(token, "/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member");
      return { repos: repos.map(repo) };
    }
    case "github-create": {
      const token = await githubToken();
      if (!token) throw new Error("Connect GitHub first.");
      if (typeof body.name !== "string" || !/^[\w.-]{1,100}$/.test(body.name)) throw new Error("A repository name is letters, digits, dots, dashes and underscores.");
      return { repo: repo(await github<Repo>(token, "/user/repos", { method: "POST", body: { name: body.name, private: body.private !== false } })) };
    }
    default:
      return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!fromThisMachine(req, "source")) return res.status(403).json({ error: "My source opens only in Arcanus at localhost, on the computer it runs on." });
  try {
    if (req.method === "GET") {
      const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
      return res.json({ name: path.basename(ROOT), branch: branch.code ? "" : branch.out });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST." });
    const body = (req.body ?? {}) as { op?: unknown; path?: unknown; to?: unknown; text?: unknown; line?: unknown; query?: unknown; args?: unknown; matchCase?: unknown; wholeWord?: unknown; regex?: unknown; limit?: unknown; token?: unknown; name?: unknown; private?: unknown; pc?: unknown };
    const pc = body.pc === true;
    switch (body.op) {
      case "list": {
        if (pc && !body.path) return res.json({ entries: disks().map((d) => ({ name: d.path === "/" ? "root" : d.path, kind: "directory", free: d.free, total: d.total })) });
        const found = await fs.readdir(at(body.path ?? "", false, pc), { withFileTypes: true });
        return res.json({ entries: found.filter((e) => pc || !hidden(e.name)).map((e) => ({ name: e.name, kind: e.isDirectory() ? "directory" : "file" })) });
      }
      case "read": {
        const file = at(body.path, true, pc);
        const stat = await fs.stat(file);
        if (!stat.isFile()) return res.status(404).json({ error: `${body.path} is a folder.` });
        if (stat.size > MAX_READ) throw new Error(`${path.basename(file)} is too large to open as text (${Math.round(stat.size / 1e6)} MB).`);
        const bytes = await fs.readFile(file);
        if (bytes.includes(0)) throw new Error(`${path.basename(file)} isn't text.`);
        return res.json({ text: bytes.toString("utf8") });
      }
      case "write": {
        if (typeof body.text !== "string") throw new Error("Text is needed.");
        const file = at(body.path, true, pc);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, body.text);
        return res.json({ ok: true });
      }
      case "mkdir":
        await fs.mkdir(at(body.path, true, pc), { recursive: true });
        return res.json({ ok: true });
      case "remove":
        await fs.rm(at(body.path, true, pc), { recursive: true });
        return res.json({ ok: true });
      case "rename": {
        const [from, to] = [at(body.path, true, pc), at(body.to, true, pc)];
        // Windows ignores case, so "Page.tsx" -> "page.tsx" finds itself there: that is a rename, not a clash.
        const taken = from.toLowerCase() !== to.toLowerCase() && (await fs.stat(to).then(() => true, () => false));
        if (taken) throw new Error(`${body.to} is already there.`);
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.rename(from, to);
        return res.json({ ok: true });
      }
      case "files": {
        const listed = await git(["ls-files", "--cached", "--others", "--exclude-standard"]);
        if (listed.code) throw new Error(listed.out);
        return res.json({ files: listed.out.split("\n").filter(Boolean) });
      }
      case "search": {
        if (typeof body.query !== "string" || !body.query.trim()) throw new Error("Words to search for are needed.");
        // git grep: tracked and untracked files, never ignored ones; -I skips binaries. The search engine's options:
        // -F reads the words as they are unless `regex` (then -P, Perl's patterns, like the browser's), -i unless
        // `matchCase`, -w for `wholeWord`.
        const flags = [body.matchCase ? "" : "-i", body.wholeWord ? "-w" : "", body.regex ? "-P" : "-F"].filter(Boolean);
        const found = await git(["grep", "-n", "-I", ...flags, "--untracked", "-e", body.regex ? body.query : body.query.trim()]);
        if (found.code > 1) throw new Error(found.out);
        const limit = Math.min(Math.max(Number(body.limit) || MAX_HITS, 1), 2000);
        // A file with Windows line endings keeps its \r in what git prints, and "." never matches one.
        const hits = found.out.split(/\r?\n/).flatMap((line) => {
          const m = line.match(/^(.+?):(\d+):(.*)$/);
          return m ? [{ path: m[1], line: Number(m[2]), text: m[3].trim().slice(0, 200) }] : [];
        });
        return res.json({ hits: hits.slice(0, limit), more: hits.length > limit });
      }
      case "git":
        return res.json(await git(gitArgs(body.args)));
      case "run": {
        if (typeof body.line !== "string" || !body.line.trim()) throw new Error("A command is needed.");
        const cwd = at(body.path ?? "", false, pc);
        if (!(await fs.stat(cwd)).isDirectory()) throw new Error(`${body.path} is a file, not a folder.`);
        return run(cwd, body.line, res);
      }
      default: {
        const answer = await githubOp(body);
        if (answer) return res.json(answer);
        return res.status(400).json({ error: "Send { op } as list, read, write, mkdir, remove, rename, files, search, git, run, or github, github-connect, github-disconnect, github-repos, github-create." });
      }
    }
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException)?.code === "ENOENT";
    return res.status(missing ? 404 : 500).json({ error: missing ? "That isn't there." : err instanceof Error ? err.message : String(err) });
  }
}
