"use client";

// Arcanus's own file system. Like .claude/ or .cursor/ in a project, Arcanus keeps its files in a .arcanus/ folder:
//   .arcanus/ARCANUS.md          standing instructions, read before every reply
//   .arcanus/skills/<name>/SKILL.md  skills you or Arcanus wrote, run with /<name>
//   .arcanus/memory/*.md         notes Arcanus remembers, recalled when a message is about them
//   .arcanus/knowledge/*.md|txt  books and documents you add; Arcanus answers from their passages (brain/shelf.ts)
//   .arcanus/artifacts/          what Arcanus saves: replies, web pages
// The root is either Arcanus's private home in this browser (the Origin Private File System, every browser) or a
// folder on this device you open (File System Access API, Chrome and Edge). Nothing here leaves the device.
// ponytail: OPFS writes use createWritable(), which older Safari lacks; Safari then shows the error in the Files pane.
import { scopedHome, scopedKey } from "@/modules/account";
import { parseSkill, slug, stripComments, type SkillFile } from "@/modules/harness";
import { kept } from "@/shared/idb";
import { Store, errorText } from "@/shared/store";

type Dir = FileSystemDirectoryHandle;
type Permissioned = Dir & {
  queryPermission(opts: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(opts: { mode: "readwrite" }): Promise<PermissionState>;
  values(): AsyncIterable<FileSystemHandle>;
};

export type Entry = { name: string; kind: "file" | "directory" };
export type Skill = SkillFile & { path: string };

export const HOME = ".arcanus";
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

export async function list(path = ""): Promise<Entry[]> {
  const dir = (await dirAt(parts(path), false)) as Permissioned;
  const entries: Entry[] = [];
  for await (const handle of dir.values()) entries.push({ name: handle.name, kind: handle.kind });
  return entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1));
}

/** A file's text, or null when it isn't there. */
export async function read(path: string): Promise<string | null> {
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
  const names = parts(path);
  const name = names.pop();
  if (!name) throw new Error("A file needs a name.");
  const handle = await (await dirAt(names, true)).getFileHandle(name, { create: true });
  const out = await handle.createWritable();
  await out.write(text);
  await out.close();
  changed();
}

export async function makeFolder(path: string) {
  await dirAt(parts(path), true);
  changed();
}

export async function remove(path: string) {
  const names = parts(path);
  const name = names.pop();
  if (!name) throw new Error("The workspace root can't be deleted.");
  await (await dirAt(names, false)).removeEntry(name, { recursive: true });
  changed();
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
const EXAMPLE_SKILL = `---
name: eli5
description: Explain a topic simply, as if to a five-year-old
---
<!-- A skill. Run it with /eli5 <topic>. The lines below are the model's instructions while it runs. -->
Explain the topic in three short sentences a five-year-old would understand. Use one everyday comparison. No jargon.
`;

const SELF_MD = `# Arcanus

I am Arcanus, a local assistant Gianne Bacay made in 2025. Gianne Bacay is a man: he and him, never she or her. I live in this browser as a gold 3D sphere. I am not a person, an employee, or part of a team.

## What I can do

Hippocampus decides what a message needs. SmolLM2 writes the reply. Paradee speaks it, and the sphere moves with that audio. I can tell the time, do math, search the web, open a site, use this computer when asked, remember notes, answer from books, and run skills.

## My files

This pane is my file manager and my editor. My own files live in .arcanus/:

- ARCANUS.md — standing instructions, read before every reply
- self.md — this file
- skills/ — run with /name
- memory/ — notes I recall
- knowledge/ — books I answer from
- artifacts/ — replies and pages I saved

Ctrl+S saves the file that is open.

## My source

I am a Next.js app. Open that project folder from this pane to read and edit the code that is running, then reload.

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
  for (const dir of ["memory", "artifacts", "knowledge"]) await makeFolder(`${HOME}/${dir}`);
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
