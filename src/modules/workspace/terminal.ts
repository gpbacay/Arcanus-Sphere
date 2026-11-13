"use client";

// Arcanus working its own files: the chat's file commands (/ls, /open, /write, /replace, /git …) and what it does
// when a message asks for its source in plain words ("open your source code", "what branch are you on"). Every one
// is a single action you asked for; Arcanus never chains them on its own.
// The language model is not in here. SmolLM2 is far too small to write working code, so Arcanus edits its code with
// exact text: yours in the editor, or /write and /replace. Add a model-written edit when a model that can code is on board.
import { chatLine, pin } from "@/shared/pane";
import { redirect, resolve, words, type SourceCommand } from "./command";
import { GUARDRAILS, HOME, SOURCE, expand, git, list, makeFolder, read, remove, rename, write } from "./fs";
import { closeTab, ide, openDir, openFile } from "./ide";
import { searchSource, source, sourceFiles, sourceGit } from "./source";

export const FILE_COMMANDS = [
  { name: "/source", hint: "Open my own source code, and say what state it is in" },
  { name: "/ls", hint: "List a folder: /ls [path]" },
  { name: "/open", hint: "Open a file in my editor: /open <path>" },
  { name: "/read", hint: "Open a file and read it with your messages: /read <path>" },
  { name: "/write", hint: "Write a file: /write <path> <text>" },
  { name: "/replace", hint: "Change text in a file: /replace <path> <old> => <new>" },
  { name: "/mkdir", hint: "Make a folder: /mkdir <path>" },
  { name: "/mv", hint: "Rename or move: /mv <from> <to>" },
  { name: "/rm", hint: "Delete a file or folder: /rm <path>" },
  { name: "/find", hint: "Search my source code: /find <words>" },
  { name: "/git", hint: "Run git on my source: /git status, /git commit -m \"…\"" },
];

/** A commit as Arcanus says it: when, then its subject cut to 72 characters (a subject can run to a paragraph). */
const COMMIT = "%cr: %<(72,trunc)%s";
const NO_SOURCE = "My source code is on the computer I run from. Open me at localhost there and I can read, edit and commit it.";
const needSource = () => {
  if (!source.state.available) throw new Error(NO_SOURCE);
};
/** A tab showing `path` reads the file again, unless it holds unsaved edits. */
const refresh = (path: string) => (ide.state.tabs.some((t) => t.path === path) ? openFile(path) : undefined);

/** Where the source stands: how many files, which branch, what changed, the last commit. */
async function summary() {
  const [files, status, last] = await Promise.all([sourceFiles(), sourceGit(["status", "--porcelain"]), sourceGit(["log", "-1", `--pretty=${COMMIT}`])]);
  const changed = status.out.split("\n").filter(Boolean).length;
  return `My source is ${files.length} files in ${source.state.name}, on branch ${source.state.branch || "none"}. ${changed ? `${changed} ${changed === 1 ? "file has" : "files have"} changed since my last commit` : "Nothing has changed since my last commit"}${last.code ? "" : `, ${last.out}`}.`;
}

/** Run a file command from the chat. Null when `name` isn't one. Resolves to the line Arcanus answers with. */
export function fileCommand(name: string, arg: string, cwd = ""): (() => Promise<string>) | null {
  const [first = "", ...rest] = arg.split(/\s+/);
  const path = expand(resolve(cwd, first));
  const usage = (text: string) => async () => text;
  switch (name) {
    case "/source":
      return async () => {
        needSource();
        openDir(SOURCE);
        return `${await summary()} It is open in the Operating System, at ${SOURCE}/.`;
      };
    case "/ls":
      return async () => (await list(path)).map((e) => (e.kind === "directory" ? `${e.name}/` : e.name)).join("\n") || "That folder is empty.";
    case "/open":
    case "/read":
      if (!first) return usage(`${name} <path> opens a file in my editor. My own code is under source/, like source/src/app/page.tsx.`);
      return async () => {
        await openFile(path);
        if (name === "/open") return `Opened ${path} in my editor.`;
        pin({ label: path, text: ide.state.tabs.find((t) => t.path === path)?.text ?? "" });
        return `Opened ${path}. I read it with your messages until you remove it.`;
      };
    case "/write":
      if (!first || !rest.length) return usage("/write <path> <text> writes a file, replacing what was there.");
      return async () => {
        const text = `${arg.slice(first.length).trim()}\n`;
        await write(path, text);
        await refresh(path);
        return `Wrote ${text.length} characters to ${path}.`;
      };
    case "/replace": {
      // The first " => " divides old from new, so the new text may hold arrows of its own.
      const body = arg.slice(first.length);
      const cut = body.indexOf(" => ");
      const [before, after] = [body.slice(0, Math.max(cut, 0)).trim(), body.slice(cut + 4).trim()];
      if (!first || cut < 0 || !before) return usage("/replace <path> <old> => <new> changes that text wherever the file has it.");
      return async () => {
        const text = await read(path);
        if (text === null) throw new Error(`${path} isn't a file.`);
        const pieces = text.split(before);
        if (pieces.length === 1) return `${path} doesn't contain "${before}". Nothing changed.`;
        await write(path, pieces.join(after));
        await refresh(path);
        return `Changed ${pieces.length - 1} ${pieces.length === 2 ? "place" : "places"} in ${path}.`;
      };
    }
    case "/mkdir":
      if (!first) return usage("/mkdir <path> makes a folder.");
      return async () => (await makeFolder(path), `Made ${path}/.`);
    case "/mv":
      if (!first || !rest[0]) return usage("/mv <from> <to> renames or moves a file.");
      return async () => {
        const to = expand(resolve(cwd, rest[0]));
        await rename(path, to);
        closeTab(path);
        return `Moved ${path} to ${to}.`;
      };
    case "/rm":
      if (!first) return usage("/rm <path> deletes a file or folder.");
      return async () => {
        if (path === HOME || path === SOURCE || path === GUARDRAILS) throw new Error(`${path} is part of me. I won't delete all of it.`);
        await remove(path);
        closeTab(path);
        return `Deleted ${path}.${path.startsWith(`${SOURCE}/`) ? " If git tracked it, /git restore brings it back." : ""}`;
      };
    case "/find":
      if (!arg) return usage("/find <words> searches my source code.");
      return async () => {
        needSource();
        const { hits, more } = await searchSource(arg);
        if (!hits.length) return `"${arg}" isn't anywhere in my source.`;
        return `${hits.length}${more ? "+" : ""} ${hits.length === 1 ? "place" : "places"}:\n${hits.slice(0, 30).map((h) => `${h.path}:${h.line}  ${h.text}`).join("\n")}${hits.length > 30 ? "\n…" : ""}`;
      };
    case "/git":
      if (!arg) return usage("/git <command> runs git on my source: /git status, /git diff, /git add -A, /git commit -m \"message\", /git log, /git push.");
      return async () => {
        needSource();
        const { out, code } = await git(...words(arg));
        return out || (code ? `git ${first} failed.` : `git ${first}: done.`);
      };
    default:
      return null;
  }
}

// ------------------------------------------------------------------ the terminal: a cmd-style shell on Arcanus's files

/** What a line did: its output, and the folder it left the terminal in, or that the screen was cleared or the terminal closed. */
export type Result = { out: string; cwd?: string; clear?: boolean; exit?: boolean };

/** A folder as the prompt shows it: arcanus:\.arcanus\source> */
export const promptOf = (cwd: string) => `arcanus:\\${cwd.replace(/\//g, "\\")}>`;
const shown = (path: string) => promptOf(path).slice(0, -1);

const HELP: [string, string][] = [
  ["CD", "Shows the name of the current folder, or changes it."],
  ["CLS", "Clears the screen."],
  ["COPY", "Copies a file."],
  ["DATE", "Shows the date."],
  ["DEL", "Deletes a file."],
  ["DIR", "Lists the files and folders in a folder. /B lists names only."],
  ["ECHO", "Shows a message. Add > file or >> file to write it to a file."],
  ["EXIT", "Closes this terminal."],
  ["MD", "Makes a folder."],
  ["MOVE", "Moves a file."],
  ["RD", "Removes a folder. /S removes what is in it too."],
  ["REN", "Renames a file."],
  ["TIME", "Shows the time."],
  ["TYPE", "Shows what is in a file."],
  ["VER", "Shows what this is."],
  ["OPEN", "Opens a file in my editor."],
  ["READ", "Opens a file and reads it with your messages."],
  ["WRITE", "Writes a file: write <path> <text>"],
  ["REPLACE", "Changes text in a file: replace <path> <old> => <new>"],
  ["FIND", "Searches my source code."],
  ["GIT", "Runs git on my source."],
  ["SOURCE", "Opens my source code, and says what state it is in."],
];
/** What the terminal runs: the builtins above, and my own programs, which are the file commands of the chat. */
const PROGRAMS = ["open", "read", "write", "replace", "find", "git", "source"];
const NAMES = HELP.map(([n]) => n.toLowerCase());
const PROTECTED = [HOME, SOURCE, GUARDRAILS];
const NO_FILE = "The system cannot find the file specified.";
const NO_PATH = "The system cannot find the path specified.";

const isFolder = (path: string) => list(path).then(() => true, () => false);
const dirOf = (path: string) => path.split("/").slice(0, -1).join("/");
const nameOf = (path: string) => path.split("/").pop() ?? path;
const guarded = (path: string) => {
  if (!path || PROTECTED.includes(path)) throw new Error("Access is denied.");
};

/** The commands cmd has, on Arcanus's files. Null when `name` isn't one of them. */
async function builtin(name: string, arg: string, cwd: string): Promise<Result | null> {
  const flags = new Set((arg.match(/(?:^|\s)\/[a-z](?=\s|$)/gi) ?? []).map((f) => f.trim().toLowerCase()));
  const rest = arg.replace(/(?:^|\s)\/[a-z](?=\s|$)/gi, " ").trim();
  const at = (p: string) => expand(resolve(cwd, p));
  switch (name) {
    case "cd":
    case "chdir": {
      if (!rest) return { out: shown(cwd) };
      const to = at(rest);
      if (!(await isFolder(to))) throw new Error(NO_PATH);
      return { out: "", cwd: to };
    }
    case "cls":
      return { out: "", clear: true };
    case "exit":
      return { out: "", exit: true };
    case "ver":
      return { out: "Arcanus Operating System" };
    case "date":
      return { out: `${flags.has("/t") ? "" : "The current date is: "}${new Date().toLocaleDateString()}` };
    case "time":
      return { out: `${flags.has("/t") ? "" : "The current time is: "}${new Date().toLocaleTimeString()}` };
    case "help":
      return { out: `For more on a command, see its line here.\n${HELP.map(([n, d]) => `${n.padEnd(8)} ${d}`).join("\n")}\nThe other commands of the chat start with /, like /remember: they go to the chat.` };
    case "echo":
      return { out: arg === "." ? "" : arg || "ECHO is on." }; // "echo." is the blank line
    case "dir": {
      const target = at(rest);
      const entries = await list(target).catch(() => null);
      if (!entries) {
        if ((await read(target)) === null) throw new Error("File Not Found");
        return { out: flags.has("/b") ? nameOf(target) : ` Directory of ${shown(dirOf(target))}\n\n         ${nameOf(target)}\n               1 File(s)` };
      }
      if (flags.has("/b")) return { out: entries.map((e) => e.name).join("\n") };
      const dots = target ? [{ name: ".", kind: "directory" }, { name: "..", kind: "directory" }] : [];
      const rows = [...dots, ...entries].map((e) => `${e.kind === "directory" ? "<DIR>" : ""}`.padEnd(9) + e.name);
      const folders = entries.filter((e) => e.kind === "directory").length;
      return { out: ` Directory of ${shown(target)}\n\n${rows.join("\n")}\n${String(entries.length - folders).padStart(15)} File(s)\n${String(folders + dots.length).padStart(15)} Dir(s)` };
    }
    case "type": {
      if (!rest) throw new Error("The syntax of the command is incorrect.");
      const text = await read(at(rest));
      if (text === null) throw new Error(NO_FILE);
      return { out: text.replace(/\s+$/, "") };
    }
    case "md":
    case "mkdir": {
      if (!rest) throw new Error("The syntax of the command is incorrect.");
      const path = at(rest);
      if ((await isFolder(path)) || (await read(path)) !== null) throw new Error(`A subdirectory or file ${rest} already exists.`);
      await makeFolder(path);
      return { out: "" };
    }
    case "rd":
    case "rmdir": {
      const path = at(rest);
      guarded(path);
      const entries = await list(path).catch(() => null);
      if (!entries) throw new Error(NO_FILE);
      if (entries.length && !flags.has("/s")) throw new Error("The directory is not empty.");
      await remove(path);
      return { out: "" };
    }
    case "del":
    case "erase": {
      if (!rest) throw new Error("The syntax of the command is incorrect.");
      const path = at(rest);
      guarded(path);
      if ((await read(path)) === null) throw new Error(`Could Not Find ${shown(path)}`);
      await remove(path);
      closeTab(path);
      return { out: "" };
    }
    case "ren":
    case "rename": {
      const [from, to] = words(rest);
      if (!from || !to || /[\\/]/.test(to)) throw new Error("The syntax of the command is incorrect.");
      const path = at(from);
      guarded(path);
      if (!(await isFolder(path)) && (await read(path)) === null) throw new Error(NO_FILE);
      await rename(path, [dirOf(path), to].filter(Boolean).join("/"));
      closeTab(path);
      return { out: "" };
    }
    case "move":
    case "copy": {
      const [from, to] = words(rest);
      if (!from || !to) throw new Error("The syntax of the command is incorrect.");
      const path = at(from);
      const text = await read(path);
      if (text === null) throw new Error(NO_FILE);
      const into = at(to);
      const target = (await isFolder(into)) ? [into, nameOf(path)].filter(Boolean).join("/") : into;
      if (target === path) throw new Error("The file cannot be copied onto itself.");
      if (name === "copy") await write(target, text);
      else {
        guarded(path);
        await rename(path, target);
        closeTab(path);
      }
      return { out: `        1 file(s) ${name === "copy" ? "copied" : "moved"}.` };
    }
    default:
      return null;
  }
}

/**
 * A line typed in the Operating System's terminal, run as cmd would on Arcanus's files, in the folder `cwd`. A line
 * starting with / is the chat's: a file command like /ls runs here, anything else (a /skill, /remember) goes to the chat.
 */
export async function runLine(typed: string, cwd: string): Promise<Result> {
  const line = typed.trim();
  if (line.startsWith("/")) {
    const [first, ...rest] = line.split(/\s+/);
    const run = fileCommand(first.toLowerCase(), rest.join(" "), cwd);
    if (run) return { out: await run() };
    return { out: chatLine.send(line) ? "Sent to the chat." : "The chat didn't take it: it is still answering, or not open yet." };
  }
  const { command, to, append } = redirect(line);
  if (to === "") throw new Error("The syntax of the command is incorrect.");
  // cmd splits the command from its argument at a space, a dot or a slash: "cd.." and "dir/b" are commands too.
  const m = command.match(/^([^\s\\/.:"]+)(.*)$/s);
  const name = m?.[1].toLowerCase() ?? "";
  const arg = m?.[2].trim() ?? "";
  let result = m ? await builtin(name, arg, cwd) : null;
  if (!result && PROGRAMS.includes(name)) {
    const run = fileCommand(`/${name}`, arg, cwd);
    if (run) result = { out: await run() };
  }
  if (!result) throw new Error(`'${m?.[1] ?? command.split(/\s/)[0]}' is not recognized as an internal or external command,\noperable program or batch file.`);
  if (to) {
    const file = expand(resolve(cwd, to));
    guarded(file);
    const before = append ? ((await read(file)) ?? "") : "";
    await write(file, result.out ? `${before}${result.out}\n` : before);
    return { ...result, out: "" };
  }
  return result;
}

/** What Tab can finish the line to: command names for the first word, otherwise the files and folders that begin like the last. */
export async function complete(line: string, cwd: string): Promise<string[]> {
  const [, head, word] = line.match(/^(.*?)(\S*)$/s)!;
  if (!head.trim()) return NAMES.filter((n) => n.startsWith(word.toLowerCase())).sort().map((n) => head + n);
  const cut = Math.max(word.lastIndexOf("/"), word.lastIndexOf("\\")) + 1;
  const [dir, begin] = [word.slice(0, cut), word.slice(cut).toLowerCase()];
  const entries = await list(expand(resolve(cwd, dir))).catch(() => []);
  return entries
    .filter((e) => e.name.toLowerCase().startsWith(begin))
    .map((e) => {
      const full = `${dir}${e.name}${e.kind === "directory" ? "\\" : ""}`;
      return head + (full.includes(" ") ? `"${full}"` : full);
    });
}

/** What Arcanus does, and says, when a message asks for its source in plain words. */
export async function sourceAction(command: SourceCommand): Promise<{ label: string; reply: string; results?: string[] }> {
  if (!source.state.available) return { label: "My source isn't here", reply: NO_SOURCE };
  switch (command.kind) {
    case "open": {
      if (!command.path) {
        openDir(SOURCE);
        return { label: "Opened my source", reply: `${await summary()} I opened it in the Operating System.` };
      }
      // A path in my files as it is; otherwise the source file of that name, wherever it is.
      const wanted = command.path;
      const mine = (await read(wanted).catch(() => null)) !== null ? wanted : (await read(`${HOME}/${wanted}`).catch(() => null)) !== null ? `${HOME}/${wanted}` : "";
      const found = mine ? [mine] : (await sourceFiles()).filter((f) => f === wanted || f.endsWith(`/${wanted}`)).map((f) => `${SOURCE}/${f}`);
      if (!found.length) return { label: "Looked through my source", reply: `I have no file called ${wanted}.` };
      if (found.length > 1) return { label: "Looked through my source", results: found.slice(0, 6), reply: `I have ${found.length} files called ${wanted}. Say which: ${found.slice(0, 4).map((f) => f.slice(SOURCE.length + 1)).join(", ")}.` };
      await openFile(found[0]);
      return { label: "Opened a file of mine", results: found, reply: `Opened ${found[0].replace(`${SOURCE}/`, "")} in my editor.` };
    }
    case "status": {
      const { out } = await sourceGit(["status", "--porcelain"]);
      const files = out.split("\n").filter(Boolean).map((line) => line.slice(3));
      const branch = `I am on branch ${source.state.branch || "none"}.`;
      if (!files.length) return { label: "Read my git status", reply: `${branch} Nothing has changed since my last commit.` };
      return { label: "Read my git status", results: files.slice(0, 6), reply: `${branch} ${files.length} ${files.length === 1 ? "file has" : "files have"} changed: ${files.slice(0, 3).join(", ")}${files.length > 3 ? ", and more" : ""}.` };
    }
    case "log": {
      const { out, code } = await sourceGit(["log", "-5", `--pretty=${COMMIT}`]);
      const commits = out.split("\n").map((line) => line.trim()).filter(Boolean);
      if (code || !commits.length) return { label: "Read my git history", reply: "I have no commits yet." };
      return { label: "Read my git history", results: commits, reply: `My last commit was ${commits[0]}.` };
    }
    case "find": {
      const { hits, more } = await searchSource(command.query);
      if (!hits.length) return { label: "Searched my source", reply: `"${command.query}" isn't anywhere in my source.` };
      const where = [...new Set(hits.map((h) => h.path))];
      return {
        label: "Searched my source",
        results: hits.slice(0, 6).map((h) => `${h.path}:${h.line}`),
        reply: `"${command.query}" is in ${hits.length}${more ? " or more" : ""} ${hits.length === 1 ? "place" : "places"} across ${where.length} ${where.length === 1 ? "file" : "files"}. First: ${hits[0].path}, line ${hits[0].line}.`,
      };
    }
    case "commit": {
      if (!command.message) return { label: "A commit needs a message", reply: "Tell me what to call it: commit your changes saying, then the message." };
      await git("add", "-A");
      const { out, code } = await git("commit", "-m", command.message);
      return { label: code ? "Nothing was committed" : "Committed my source", results: [out.split("\n")[0]], reply: code ? `I didn't commit: ${out.split("\n").find((l) => /nothing|error|fatal/i.test(l)) ?? out.split("\n")[0]}.` : `Committed: ${command.message}.` };
    }
  }
}
