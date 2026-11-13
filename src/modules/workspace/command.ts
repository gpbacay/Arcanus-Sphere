// The pure part of Arcanus's hold on its own source: which paths and git commands the source route (/api/source)
// accepts, and which messages ask for the source at all. No browser and no Node APIs, so command.check.ts runs it in
// Node, and both the server route and the router (brain/routes.ts) import it.

// ------------------------------------------------------------------ paths

/** What Arcanus never lists, reads or writes in its project: git's own store, installed packages, build output, secrets. */
const HIDDEN = /^(?:\.git|node_modules|\.next|\.env(?:\..*)?)$/i;
export const hidden = (name: string) => HIDDEN.test(name) && name.toLowerCase() !== ".env.example";

/**
 * "src/app/page.tsx" -> ["src", "app", "page.tsx"]. Throws on a path that climbs out of the project or names a hidden
 * place. Windows reads ".git." and ".git " as ".git", "GIT~1" as its short name, and "a:b" as a drive or a stream, so
 * those are refused too.
 */
export function sourceParts(path: string): string[] {
  const list = path.split(/[\\/]+/).filter(Boolean);
  for (const part of list) {
    if (/^\.+$|[. ]$|[:\0]|~\d/.test(part) || hidden(part)) throw new Error(`Not a path in my source: ${path}`);
  }
  return list;
}

// ------------------------------------------------------------------ git

const GIT = ["status", "diff", "log", "show", "add", "restore", "commit", "branch", "switch", "checkout", "stash", "pull", "push", "fetch", "merge", "reset", "rm", "mv", "tag", "blame", "grep", "ls-files", "rev-parse", "remote"];
/** Options that run another program or write a file anywhere on the disk. */
const UNSAFE = /^(?:--output|--exec|--upload-pack|--receive-pack|--ext-diff|--textconv|--config|-c$)|ext::/i;

/** The arguments of one git command Arcanus may run on its source: a known subcommand first, so no global options. */
export function gitArgs(args: unknown): string[] {
  if (!Array.isArray(args) || !args.length || !args.every((a): a is string => typeof a === "string")) throw new Error("git needs a command, like status.");
  if (!GIT.includes(args[0])) throw new Error(`I don't run git ${args[0]}. I run: ${GIT.join(", ")}.`);
  const bad = args.find((a) => UNSAFE.test(a));
  if (bad) throw new Error(`I don't run git with ${bad}.`);
  return args;
}

/** A command line as arguments: `commit -m "fix the orb"` -> ["commit", "-m", "fix the orb"]. */
export const words = (line: string) => [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);

// ------------------------------------------------------------------ messages that ask for the source

export type SourceCommand =
  | { kind: "open"; path?: string }
  | { kind: "status" }
  | { kind: "log" }
  | { kind: "find"; query: string }
  | { kind: "commit"; message: string };

const MINE = "(?:your|arcanus'?s?)\\s+(?:own\\s+)?";
const CODE = "(?:source(?:\\s+code)?|code(?:base)?|repo(?:sitory)?)";
const OPEN = new RegExp(`^(?:open|show(?: me)?|let me see|view|browse|edit|look at)\\s+${MINE}${CODE}(?:\\s+files?)?$`, "i");
const FILE = /^(?:open|read|show(?: me)?|edit|view)\s+(?:(?:your|the|my)\s+)?(?:own\s+)?(?:source\s+)?(?:file\s+)?((?:[\w.@()[\]-]+\/)*[\w.@()[\]-]+\.(?:tsx?|jsx?|mjs|css|json|md|txt))$/i;
const FIND = new RegExp(`^(?:find|search(?: for)?|grep|where is|where's|where do you)\\s+(.+?)\\s+in ${MINE}${CODE}$`, "i");
const STATUS = new RegExp(`^git status$|^(?:what|which)(?: git)? branch are you on$|^what(?:'s| has| have)?(?: you)? changed in ${MINE}${CODE}$|^(?:show(?: me)?|what are) your (?:uncommitted |code |source )?changes$`, "i");
const LOG = /^git log$|^(?:show(?: me)?|list|what (?:is|was|are|were)|what's) your (?:last|latest|recent|previous) commits?$|^(?:show(?: me)?|list) your (?:commits|git history|git log)$|^what did you (?:last )?commit(?: last)?$/i;
const COMMIT = /^(?:git\s+)?commit(?:\s+(?:all|your|the|my|these))?(?:\s+(?:code|source))?\s+(?:changes|code|work|everything)(?:\s+(?:with\s+(?:the\s+)?message|saying|as)\s+["“']?(.+?)["”']?)?$/i;

/**
 * What a message asks Arcanus to do with its own source, or null when it asks for nothing of the kind. Strict on
 * purpose: "where is your source code" and "who wrote your code" are questions about Arcanus (the about route), and
 * "open github" is the web. Only a message that names its code, git, or a source file by name is taken.
 */
export function sourceCommand(input: string): SourceCommand | null {
  const text = input.trim().replace(/[.!?]+$/, "").replace(/^(?:please|can you|could you|would you)\s+/i, "").trim();
  let m = text.match(COMMIT);
  if (m) return { kind: "commit", message: m[1]?.trim() ?? "" };
  if (STATUS.test(text)) return { kind: "status" };
  if (LOG.test(text)) return { kind: "log" };
  m = text.match(FIND);
  if (m) return { kind: "find", query: m[1].replace(/^["“']|["”']$/g, "") };
  m = text.match(FILE);
  if (m) return { kind: "open", path: m[1] };
  return OPEN.test(text) ? { kind: "open" } : null;
}

// ------------------------------------------------------------------ the terminal's command line

/**
 * A path as cmd reads it, from the folder it is typed in: "..\x", "/src", "a/b", "arcanus:\a". "" is the top of the
 * workspace. A drive ("C:\", "arcanus:") means the top, as it does in cmd; ".." never climbs out of it.
 */
export function resolve(cwd: string, arg: string): string {
  const drive = arg.match(/^[a-z][\w-]*:(.*)$/i);
  const absolute = drive ? true : /^[\\/]/.test(arg);
  const out = absolute ? [] : cwd.split("/").filter(Boolean);
  for (const part of (drive ? drive[1] : arg).split(/[\\/]+/).filter(Boolean)) {
    if (part === "..") out.pop();
    else if (part !== ".") out.push(part);
  }
  return out.join("/");
}

/** "echo hi > a.txt" -> { command: "echo hi", to: "a.txt" }; ">>" appends. Only a ">" outside double quotes counts. */
export function redirect(line: string): { command: string; to?: string; append?: boolean } {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ">" && !quoted) {
      const append = line[i + 1] === ">";
      return { command: line.slice(0, i).trim(), to: line.slice(i + (append ? 2 : 1)).trim().replace(/^"|"$/g, ""), append };
    }
  }
  return { command: line.trim() };
}
