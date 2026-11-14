"use client";

// The notes in Arcanus's file system and the [[links]] between them (links.ts), read once per change of the files.
// The graph view draws them, a [[link]] in a previewed note opens its file, and a reply's context follows them: a note
// Arcanus reads brings the notes it links to, so a subject split over small files is read whole.
import { HOME, prose, read, workspace, write } from "./fs";
import { openFile } from "./ide";
import { linkGraph, neighbors, resolve, type Graph, type Note } from "./links";
import { walk } from "./search";

const MD = /\.(md|markdown)$/i;
let cached: { version: number; notes: Promise<Note[]> } | null = null;

/** Every markdown file: in Arcanus home its own folder, in an opened folder the whole of it. Not the source. */
export function allNotes(): Promise<Note[]> {
  const { version, kind } = workspace.state;
  if (cached?.version !== version) {
    const notes = (async () => {
      const paths: string[] = [];
      await walk(kind === "home" ? HOME : "", paths);
      const found = await Promise.all(paths.filter((p) => MD.test(p)).map(async (path) => ({ path, text: (await read(path).catch(() => null)) ?? "" })));
      return found;
    })();
    cached = { version, notes };
    notes.catch(() => (cached = null));
  }
  return cached.notes;
}

export const noteGraph = async (): Promise<Graph> => linkGraph(await allNotes());

/** Open what a [[link]] in `from` means. A link no file answers yet makes that file, beside `from`, as Obsidian does. */
export async function openNote(target: string, from: string) {
  const notes = await allNotes();
  const found = resolve(target, notes.map((n) => n.path), from);
  if (found) return openFile(found);
  const name = target.replace(/#.*$/, "").trim();
  const path = [from.split("/").slice(0, -1).join("/"), MD.test(name) ? name : `${name}.md`].filter(Boolean).join("/");
  await write(path, `# ${name.split("/").pop()}\n\n`);
  await openFile(path);
}

/** The notes linked to or from these files, not counting them: one step out in the graph. As the model reads them. */
export async function linkedNotes(paths: string[]): Promise<Note[]> {
  const notes = await allNotes();
  const graph = linkGraph(notes);
  const near = new Set(paths.flatMap((p) => neighbors(p, graph)).filter((p) => !paths.includes(p)));
  return [...near].flatMap((p) => notes.filter((n) => n.path === p).map((n) => ({ path: n.path, text: prose(n.text) })).filter((n) => n.text));
}
