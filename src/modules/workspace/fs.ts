"use client";

// Arcanus's own file system. Like .claude/ or .cursor/ in a project, Arcanus keeps its files in a .arcanus/ folder:
//   .arcanus/ARCANUS.md          standing instructions, read before every reply
//   .arcanus/skills/<name>/SKILL.md  skills you or Arcanus wrote, run with /<name>
//   .arcanus/memory/*.md         notes Arcanus remembers, recalled when a message is about them
//   .arcanus/knowledge/*.md|txt  books and documents you add; Arcanus answers from their passages (brain/shelf.ts)
//   .arcanus/artifacts/          what Arcanus saves: replies, web pages
//   .arcanus/source/             Arcanus's own source code: the project it runs from, with its git history (source.ts)
// The root is either Arcanus's private home in this browser (the Origin Private File System, every browser) or a
// folder on this device you open (File System Access API, Chrome and Edge). Nothing here leaves the device.
// .arcanus/source is not in either: it is mounted from the server Arcanus runs from, at localhost only, so the same
// list, read, write, rename and remove work on the code that is running.
// ponytail: OPFS writes use createWritable(), which older Safari lacks; Safari then shows the error in the Operating System.
import { scopedHome, scopedKey } from "@/modules/account";
import { BUILT_IN_GUARDRAILS, parseSkill, slug, stripComments, type SkillFile } from "@/modules/harness";
import { kept } from "@/shared/idb";
import { Store, errorText } from "@/shared/store";
import { connectSource, source, sourceFs, sourceGit } from "./source";

type Dir = FileSystemDirectoryHandle;
type Permissioned = Dir & {
  queryPermission(opts: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(opts: { mode: "readwrite" }): Promise<PermissionState>;
  values(): AsyncIterable<FileSystemHandle>;
};

export type Entry = { name: string; kind: "file" | "directory" };
export type Skill = SkillFile & { path: string };

export const HOME = ".arcanus";
/** Where Arcanus's own source code is mounted. */
export const SOURCE = `${HOME}/source`;
/** Arcanus's guardrails: built-in.md (the ones in its code) and rules.md (yours, read before every reply). */
export const GUARDRAILS = `${HOME}/guardrails`;
const MAX_READ = 2_000_000;

export const workspace = new Store({
  ready: false,
  /** "home": Arcanus's private folder in this browser. "folder": a folder on this device you opened. */
  kind: "home" as "home" | "folder",
  name: "",
  /** A folder opened on an earlier visit, waiting for a click to grant access again. */
  reconnect: "",
  error: "",
  /** Bumped on every change, so views of the files read them again. */
  version: 0,
  skills: [] as Skill[],
});

export const canOpenFolder = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

// ------------------------------------------------------------------ the root, and remembering an opened folder

let root: Promise<Dir> | null = null;

async function mount(dir: Dir, kind: "home" | "folder") {
  root = Promise.resolve(dir);
  await setUp();
  workspace.set({ ready: true, kind, name: kind === "home" ? "Arcanus home" : dir.name, reconnect: kind === "folder" ? "" : workspace.state.reconnect, error: "" });
  changed();
  return dir;
}

/** The signed-in account's private home: the browser's own file system, in a folder of its own per account. */
const home = async () => {
  let dir = await navigator.storage.getDirectory();
  for (const name of scopedHome()) dir = await dir.getDirectoryHandle(name, { create: true });
  return mount(dir, "home");
};
/** Where the signed-in account's opened folder is remembered. The owner's keeps the name it had before accounts. */
const folderKey = () => scopedKey("folder").replace(/^arcanus_folder$/, "folder");

/** The root, set up on first use: the folder opened last time if access is still granted, otherwise Arcanus home. */
export function ready(): Promise<Dir> {
  root ??= (async () => {
    void connectSource().then(() => source.state.available && changed()); // the source appears in .arcanus/ once found
    const folder = await kept<Permissioned | undefined>("readonly", (s) => s.get(folderKey())).catch(() => undefined);
    if (folder && (await folder.queryPermission({ mode: "readwrite" }).catch(() => "denied")) === "granted") return mount(folder, "folder");
    if (folder) workspace.set({ reconnect: folder.name });
    return home();
  })();
  root.catch((err: unknown) => {
    root = null;
    workspace.set({ error: errorText(err) });
  });
  return root;
}

/** Pick a folder on this device; Arcanus keeps its files in <folder>/.arcanus. Call from a click. */
export async function openFolder() {
  const picker = (window as unknown as { showDirectoryPicker(o: object): Promise<Dir> }).showDirectoryPicker;
  const dir = await picker({ id: "arcanus", mode: "readwrite" });
  await kept("readwrite", (s) => s.put(dir, folderKey()));
  await mount(dir, "folder");
}

/** Grant access again to the folder opened on an earlier visit. Call from a click. */
export async function reconnect() {
  const folder = await kept<Permissioned | undefined>("readonly", (s) => s.get(folderKey()));
  if (folder && (await folder.requestPermission({ mode: "readwrite" })) === "granted") await mount(folder, "folder");
}

/** Back to Arcanus's private home in this browser. The folder is forgotten, not touched. */
export async function backToHome() {
  await kept("readwrite", (s) => s.delete(folderKey())).catch(() => undefined);
  workspace.set({ reconnect: "" });
  await home();
}

// ------------------------------------------------------------------ files

/** "a/b/c.md" -> ["a", "b", "c.md"]. Never climbs out of the root. */
function parts(path: string) {
  const list = path.split("/").filter(Boolean);
  if (list.some((p) => p === "." || p === ".." || p.includes("\\"))) throw new Error(`Not a path inside the workspace: ${path}`);
  return list;
}

async function dirAt(names: string[], create: boolean) {
  let dir = await ready();
  for (const name of names) dir = await dir.getDirectoryHandle(name, { create });
  return dir;
}

const missing = (err: unknown) => err instanceof DOMException && (err.name === "NotFoundError" || err.name === "TypeMismatchError");

const tidy = (path: string) => path.split("/").filter(Boolean).join("/");
/** A path's place inside Arcanus's source ("" is its root) when the path is under .arcanus/source, otherwise null. */
function inSource(path: string) {
  const clean = tidy(path);
  return clean === SOURCE ? "" : clean.startsWith(`${SOURCE}/`) ? clean.slice(SOURCE.length + 1) : null;
}
/** "source/src/app" is short for ".arcanus/source/src/app": what the chat's file commands accept. */
export const expand = (path: string) => tidy(path).replace(/^source(?=\/|$)/, SOURCE);

export async function list(path = ""): Promise<Entry[]> {
  const src = inSource(path);
  const entries: Entry[] = [];
  if (src !== null) entries.push(...(await sourceFs.list(src)));
  else {
    const dir = (await dirAt(parts(path), false)) as Permissioned;
    for await (const handle of dir.values()) entries.push({ name: handle.name, kind: handle.kind });
    // The source is mounted here, not stored here: it shows beside Arcanus's other files.
    if (source.state.available && tidy(path) === HOME && !entries.some((e) => e.name === "source")) entries.push({ name: "source", kind: "directory" });
  }
  return entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1));
}

/** A file's text, or null when it isn't there. */
export async function read(path: string): Promise<string | null> {
  const src = inSource(path);
  if (src !== null) return src ? sourceFs.read(src) : null;
  const names = parts(path);
  const name = names.pop();
  if (!name) return null;
  try {
    const file = await (await (await dirAt(names, false)).getFileHandle(name)).getFile();
    if (file.size > MAX_READ) throw new Error(`${name} is too large to open as text (${Math.round(file.size / 1e6)} MB).`);
    return await file.text();
  } catch (err) {
    if (missing(err)) return null;
    throw err;
  }
}

export async function write(path: string, text: string) {
  const src = inSource(path);
  if (src !== null) await sourceFs.write(src, text);
  else {
    const names = parts(path);
    const name = names.pop();
    if (!name) throw new Error("A file needs a name.");
    const handle = await (await dirAt(names, true)).getFileHandle(name, { create: true });
    const out = await handle.createWritable();
    await out.write(text);
    await out.close();
  }
  changed();
}

export async function makeFolder(path: string) {
  const src = inSource(path);
  if (src !== null) await sourceFs.makeFolder(src);
  else await dirAt(parts(path), true);
  changed();
}

export async function remove(path: string) {
  const src = inSource(path);
  if (src !== null) await sourceFs.remove(src);
  else {
    const names = parts(path);
    const name = names.pop();
    if (!name) throw new Error("The workspace root can't be deleted.");
    await (await dirAt(names, false)).removeEntry(name, { recursive: true });
  }
  changed();
}

/** Rename or move. In the source, anything; in a browser folder, a text file. */
export async function rename(from: string, to: string) {
  const [a, b] = [inSource(from), inSource(to)];
  if (a !== null && b !== null) await sourceFs.rename(a, b);
  else {
    // ponytail: a browser folder has no rename that every browser supports, so the file is copied as text and the
    // old one removed. Folders and files that aren't text stay put; use handle.move() once it covers them everywhere.
    const text = await read(from);
    if (text === null) throw new Error(`${from} is a folder or isn't there. Outside my source, only a file can be renamed.`);
    if ((await read(to)) !== null) throw new Error(`${to} is already there.`);
    await write(to, text);
    await remove(from);
  }
  changed();
}

/** One git command on Arcanus's source (see gitArgs in command.ts). Views of the files read them again after it. */
export async function git(...args: string[]) {
  const result = await sourceGit(args);
  changed();
  return result;
}

// ------------------------------------------------------------------ .arcanus: instructions, skills, memory, artifacts

const ARCANUS_MD = `<!-- ARCANUS.md: your standing instructions. Arcanus reads this file before every reply, so what you write
     here shapes all of them. Add plain lines below this comment, one idea per line. For example:

       My name is Sam.
       Answer in British English.
       Keep replies to two short sentences.
       I am learning Spanish, so give me the Spanish word too.
       If you are not sure, say so instead of guessing.

     Good lines say who you are, how you want answers to sound, and what to avoid. Keep the file short: the model
     is small, and every line you add slows each reply a little. Comments like this one are never sent. -->
`;
const RULES_MD = `<!-- guardrails/rules.md: guardrails you add. Arcanus reads them before every reply, typed or spoken, ahead of
     ARCANUS.md, and must never break them. Write plain lines below this comment, one rule per line. For example:

       Never give medical, legal or financial advice; suggest asking an expert.
       Never repeat a password, a card number or an address back.
       Keep every reply suitable for children.

     The guardrails already in Arcanus's code are in built-in.md, beside this file. Keep this file short: the model is
     small, and every line you add slows each reply a little. Comments like this one are never sent. -->
`;
const EXAMPLE_SKILL = `---
name: eli5
description: Explain a topic simply, as if to a five-year-old
---
<!-- A skill. Run it with /eli5 <topic>. The lines below are the model's instructions while it runs. -->
Explain the topic in three short sentences a five-year-old would understand. Use one everyday comparison. No jargon.
`;

/** lore.md: where Arcanus comes from and why it is called Arcanus, in its own voice. Read when asked (brain, about):
 *  only the section that answers the question, since a small model given all of it answered none of it. */
const LORE_MD = `<!-- lore.md: my origin and my name, in my own words. I read the section that answers what you asked: "# My name"
     for why I am called Arcanus, "# My origin" for who made me and why. Editing it changes what I say. Write as me
     ("I", "my"), and put the answer in the first sentence of each section: a small model uses that one most.
     Comments like this one are never read. -->
# My name

I am named Arcanus after ARCANE, the neuromimetic AI library Gianne Bacay built. He wanted an AI that puts ARCANE to work, so he made me and named me after it. Arcanus is ARCANE made live.

# My origin

Gianne Bacay created me in the year 2025. He first built ARCANE, his neuromimetic AI library, which works the way a brain does. He wanted an AI that puts ARCANE to work, so he made me, and every conversation with me tests it.

# My form

I live in your browser as a glowing gold sphere, and I run on your device. I talk with you voice to voice, in real time, and I was made to step into the real world through augmented, virtual and mixed reality.
`;
/** The lore.md seeded before sections were picked by the question: replaced, since its pronoun rule was read back. */
const LORE_BEFORE = "Gianne Bacay created me in the year 2025. He is a man: he and him, never she or her.";

/** What self.md said about the source before it was in Arcanus's files, and what it says now. */
const SELF_SOURCE_BEFORE = "I am a Next.js app. Open that project folder from this pane to read and edit the code that is running, then reload.";
const SELF_SOURCE =
  "I am a Next.js app, and my own source code is in my files at .arcanus/source/ whenever I am opened at localhost on the computer I run from. The editor in this pane opens it, saving a file changes the code that is running, and the Git view shows what changed and commits it. From the chat: /source, /open, /find, /replace and /git.";

const SELF_MD = `# Arcanus

I am Arcanus, a local assistant Gianne Bacay made in 2025. Gianne Bacay is a man: he and him, never she or her. I live in this browser as a gold 3D sphere. I am not a person, an employee, or part of a team.

## What I can do

Hippocampus decides what a message needs. SmolLM2 writes the reply. Paradee speaks it, and the sphere moves with that audio. I can tell the time, do math, search the web, open a site, use this computer when asked, remember notes, answer from books, and run skills.

## My files

This pane is my file manager and my editor. My own files live in .arcanus/:

- ARCANUS.md — standing instructions, read before every reply
- guardrails/ — my guardrails: built-in.md, the ones in my code, and rules.md, yours
- self.md — this file
- lore.md — my origin and my name, read when you ask about them
- skills/ — run with /name
- memory/ — notes I recall
- knowledge/ — books I answer from
- artifacts/ — replies and pages I saved
- source/ — my own source code, at localhost

Ctrl+S saves the file that is open. Writing [[a note's name]] in a note links it to that note, so a subject can be split over small files; the graph button shows every note and its links, and when I read a note I read the notes it links to.

## My source

${SELF_SOURCE}

- src/app — the page
- src/modules/brain — Hippocampus, skills, and what I know
- src/modules/chat — the conversation
- src/modules/llm — SmolLM2
- src/modules/voice — Paradee
- src/modules/listen — Moonshine, loaded when you talk
- src/modules/sphere — the orb
- src/modules/workspace — these files
- src/modules/web — the browser
- src/modules/harness — who I am allowed to be
`;

/** Make .arcanus/ and its starter files when they are missing. Never overwrites. */
async function setUp() {
  if ((await read(`${HOME}/ARCANUS.md`)) === null) await write(`${HOME}/ARCANUS.md`, ARCANUS_MD);
  const self = await read(`${HOME}/self.md`);
  // The first seed omitted that Gianne is a man, and a small model then said she. Replace only that seed.
  if (self === null || self.startsWith("I am Arcanus, a local assistant Gianne Bacay made in 2025. I live in this browser")) await write(`${HOME}/self.md`, SELF_MD);
  // A self.md from before the source was in these files still says to open the project folder. Only that sentence changes.
  else if (self.includes(SELF_SOURCE_BEFORE)) await write(`${HOME}/self.md`, self.replace(SELF_SOURCE_BEFORE, SELF_SOURCE));
  const told = await read(`${HOME}/lore.md`);
  if (told === null || told.includes(LORE_BEFORE)) await write(`${HOME}/lore.md`, LORE_MD);
  for (const dir of ["memory", "artifacts", "knowledge"]) await makeFolder(`${HOME}/${dir}`);
  if ((await read(`${GUARDRAILS}/rules.md`)) === null) await write(`${GUARDRAILS}/rules.md`, RULES_MD);
  // built-in.md says what the code enforces, so it is rewritten whenever the code says something else.
  if ((await read(`${GUARDRAILS}/built-in.md`)) !== BUILT_IN_GUARDRAILS) await write(`${GUARDRAILS}/built-in.md`, BUILT_IN_GUARDRAILS);
  const skills = await list(`${HOME}/skills`).catch(() => null);
  if (!skills) await write(`${HOME}/skills/eli5/SKILL.md`, EXAMPLE_SKILL);
}

let reading = 0;
async function readSkills() {
  const mine = ++reading;
  const skills: Skill[] = [];
  for (const entry of await list(`${HOME}/skills`).catch(() => [])) {
    const path = entry.kind === "directory" ? `${HOME}/skills/${entry.name}/SKILL.md` : /\.md$/i.test(entry.name) ? `${HOME}/skills/${entry.name}` : "";
    const text = path ? await read(path).catch(() => null) : null;
    if (text?.trim()) skills.push({ ...parseSkill(text, entry.name.replace(/\.md$/i, "")), path });
  }
  if (mine === reading) workspace.set({ skills });
}

function changed() {
  workspace.set({ version: workspace.state.version + 1 });
  void readSkills();
}

/** ARCANUS.md without its comments: empty when there are no instructions. */
export const instructions = async () => stripComments((await read(`${HOME}/ARCANUS.md`).catch(() => null)) ?? "");
/** guardrails/rules.md without its comments: empty when you have added none. */
export const guardrails = async () => stripComments((await read(`${GUARDRAILS}/rules.md`).catch(() => null)) ?? "");

/** lore.md's sections, by heading ("my name" -> its text, on one line). Empty when the file is missing or blank. */
export async function lore(): Promise<Record<string, string>> {
  const text = stripComments((await read(`${HOME}/lore.md`).catch(() => null)) ?? "");
  const sections: Record<string, string> = {};
  for (const part of text.split(/^#+\s*/m)) {
    const [head, ...body] = part.split("\n");
    const said = body.join(" ").replace(/\s+/g, " ").trim();
    if (head.trim() && said) sections[head.trim().toLowerCase()] = said;
  }
  return sections;
}

/** Every note in .arcanus/memory. */
export async function memories(): Promise<{ id: string; text: string }[]> {
  const notes = [];
  for (const entry of await list(`${HOME}/memory`).catch(() => [])) {
    if (entry.kind !== "file" || !/\.(md|txt)$/i.test(entry.name)) continue;
    const text = stripComments((await read(`${HOME}/memory/${entry.name}`).catch(() => null)) ?? "");
    if (text) notes.push({ id: entry.name, text });
  }
  return notes;
}

const KNOWLEDGE = `${HOME}/knowledge`;
const TEXT = /\.(md|txt)$/i;

/** The books in .arcanus/knowledge, each with a stamp that changes when its file does. Text is read only on demand. */
export async function books(): Promise<{ id: string; stamp: string; text: () => Promise<string> }[]> {
  const dir = (await dirAt(parts(KNOWLEDGE), false).catch(() => null)) as Permissioned | null;
  const found = [];
  for await (const handle of dir?.values() ?? []) {
    if (handle.kind !== "file" || !TEXT.test(handle.name)) continue;
    const file = await (handle as FileSystemFileHandle).getFile();
    if (file.size <= MAX_READ) found.push({ id: handle.name, stamp: `${file.size}:${file.lastModified}`, text: () => file.text() });
  }
  return found;
}

/** Copy books (.md or .txt, up to 2 MB each) into .arcanus/knowledge. Returns what was added and what was refused. */
export async function addBooks(files: Iterable<File>) {
  const added: string[] = [];
  const refused: string[] = [];
  for (const file of files) {
    if (!TEXT.test(file.name)) refused.push(`${file.name} (only .txt and .md)`);
    else if (file.size > MAX_READ) refused.push(`${file.name} (over 2 MB)`);
    else {
      await write(`${KNOWLEDGE}/${file.name}`, await file.text());
      added.push(file.name);
    }
  }
  return { added, refused };
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");

/** Keep a note in .arcanus/memory. Returns its path. */
export async function remember(note: string) {
  const path = `${HOME}/memory/${stamp()}-${slug(note.split(/\s+/).slice(0, 6).join(" ")) || "note"}.md`;
  await write(path, `${note.trim()}\n`);
  return path;
}

/** Save something Arcanus made or found in .arcanus/artifacts. Returns its path. */
export async function saveArtifact(title: string, text: string) {
  const path = `${HOME}/artifacts/${slug(title) || "artifact"}-${stamp()}.md`;
  await write(path, text);
  return path;
}

/** Write .arcanus/skills/<name>/SKILL.md. Returns the skill's name and path. */
export async function createSkill(name: string, instructions: string) {
  const id = slug(name);
  if (!id) throw new Error("A skill needs a name made of letters or numbers.");
  const description = instructions.split(/(?<=[.!?])\s|\n/)[0].slice(0, 90);
  const path = `${HOME}/skills/${id}/SKILL.md`;
  await write(path, `---\nname: ${id}\ndescription: ${description}\n---\n${instructions.trim()}\n`);
  return { name: id, path };
}
