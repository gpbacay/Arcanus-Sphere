// Arcanus's own source: the project this server runs from, as files Arcanus can read and write, and its git history.
// The browser can't reach the disk, and the code that is running lives there, so this route is the way in.
//   GET  /api/source                          -> { name, branch }
//   POST /api/source { op: "list", path }     -> { entries }
//   POST /api/source { op: "read", path }     -> { text }          (404 when it isn't there)
//   POST /api/source { op: "write", path, text } | { op: "mkdir", path } | { op: "remove", path } | { op: "rename", path, to }
//   POST /api/source { op: "files" }          -> { files }         (every file git tracks or would track)
//   POST /api/source { op: "search", query, matchCase?, wholeWord?, regex?, limit? } -> { hits, more } (git grep)
//   POST /api/source { op: "git", args }      -> { out, code }     (one git command, see gitArgs)
//
// Like /api/device it is a pages/ route that answers only this machine (shared/loopback.ts). Paths never leave the
// project and never enter .git, node_modules, .next or a .env file (workspace/command.ts). With `next dev`, a saved
// file is the running code a moment later.
// ponytail: a symlink inside the project that points outside it is followed. Check realpath if the project ever holds one.
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { NextApiRequest, NextApiResponse } from "next";
// eslint-disable-next-line no-restricted-imports -- the public API also carries the browser client; the server needs only this pure part
import { gitArgs, hidden, sourceParts } from "@/modules/workspace/command";
import { fromThisMachine } from "@/shared/loopback";

const ROOT = process.cwd();
const MAX_READ = 2_000_000;
const MAX_HITS = 200;

export const config = { api: { bodyParser: { sizeLimit: "4mb" } } }; // a file is up to 2 MB, and JSON escapes it

function at(rel: unknown, needsName = false) {
  if (typeof rel !== "string") throw new Error("A path is needed.");
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!fromThisMachine(req, "source")) return res.status(403).json({ error: "My source opens only in Arcanus at localhost, on the computer it runs on." });
  try {
    if (req.method === "GET") {
      const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
      return res.json({ name: path.basename(ROOT), branch: branch.code ? "" : branch.out });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST." });
    const body = (req.body ?? {}) as { op?: unknown; path?: unknown; to?: unknown; text?: unknown; query?: unknown; args?: unknown; matchCase?: unknown; wholeWord?: unknown; regex?: unknown; limit?: unknown };
    switch (body.op) {
      case "list": {
        const found = await fs.readdir(at(body.path ?? ""), { withFileTypes: true });
        return res.json({ entries: found.filter((e) => !hidden(e.name)).map((e) => ({ name: e.name, kind: e.isDirectory() ? "directory" : "file" })) });
      }
      case "read": {
        const file = at(body.path, true);
        const stat = await fs.stat(file);
        if (!stat.isFile()) return res.status(404).json({ error: `${body.path} is a folder.` });
        if (stat.size > MAX_READ) throw new Error(`${path.basename(file)} is too large to open as text (${Math.round(stat.size / 1e6)} MB).`);
        const bytes = await fs.readFile(file);
        if (bytes.includes(0)) throw new Error(`${path.basename(file)} isn't text.`);
        return res.json({ text: bytes.toString("utf8") });
      }
      case "write": {
        if (typeof body.text !== "string") throw new Error("Text is needed.");
        const file = at(body.path, true);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, body.text);
        return res.json({ ok: true });
      }
      case "mkdir":
        await fs.mkdir(at(body.path, true), { recursive: true });
        return res.json({ ok: true });
      case "remove":
        await fs.rm(at(body.path, true), { recursive: true });
        return res.json({ ok: true });
      case "rename": {
        const [from, to] = [at(body.path, true), at(body.to, true)];
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
      default:
        return res.status(400).json({ error: "Send { op } as list, read, write, mkdir, remove, rename, files, search or git." });
    }
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException)?.code === "ENOENT";
    return res.status(missing ? 404 : 500).json({ error: missing ? "That isn't in my source." : err instanceof Error ? err.message : String(err) });
  }
}
