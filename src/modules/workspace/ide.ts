"use client";

// What the Operating System has open: the folder being browsed, the files open in the editor as tabs, and which panels are
// open beside them. Kept outside React so the chat's commands (/open, /source) and Arcanus's own skills can open a
// file in the editor, and so open tabs survive closing the pane.
import { openArtifact, openPane, osDrawsEditor, pane, type State } from "@/shared/pane";
import { Store } from "@/shared/store";
import { read, remove, SOURCE, write } from "./fs";

/** The editor groups side by side, VS Code's split: 0 on the left (always there), 1 on the right (while it has a tab). */
export type Group = 0 | 1;
/** An open file. One per path, shared by the groups it is open in (`in`), so an edit in one shows in the other. */
export type Tab = { path: string; text: string; saved: string; in: Group[]; /** a markdown file shown as it reads, not as source */ preview?: boolean };
/** One line of a terminal: what was typed ("in", with the prompt it was typed at), or what came back ("out", or "err"). */
export type Line = { kind: "in"; text: string; at: string } | { kind: "out" | "err"; text: string };
/** A terminal: what was typed and answered, the line being typed, the folder it is in, and whether a command is running. */
export type Term = { id: number; log: Line[]; line: string; cwd: string; busy: boolean };
const blank = (id: number): Term => ({ id, log: [{ kind: "out", text: "Arcanus Operating System terminal\nType help for the commands.\n" }], line: "", cwd: "", busy: false });

export const ide = new Store({
  dir: "",
  tabs: [] as Tab[],
  /** The path of the tab being edited, or "" while the folder is shown. */
  active: "",
  /** The tab shown in the right group, and the group a file opened from the explorer or the chat goes into. */
  activeRight: "",
  focus: 0 as Group,
  /** The panes beside the files (the knowledge graph) and beside the terminal (git's changes and its graph), open to start. */
  graphOpen: true,
  changesOpen: true,
  gitGraphOpen: true,
  /** The right column's width and the Git Graph's height in it, in pixels: both dragged by an edge. */
  sideW: 260,
  gitGraphH: 240,
  /** The explorer: the folders open in its tree, the row last picked, and the folder a new file or folder goes in. */
  expanded: [] as string[],
  selected: "",
  into: "",
  /** The terminals open at once (one to start), the id of the one shown, the next id (an id is only a key:
   *  a terminal is named by its place in the list), whether the panel is open, and its share of the pane's height. */
  terms: [blank(1)] as Term[],
  term: 1,
  nextTerm: 2,
  termOpen: true,
  termH: 1 / 3,
  /** Folders to go Back and Forward to, the nearest last. */
  back: [] as string[],
  forward: [] as string[],
});

// Every change of `dir`, from a click, a menu or a chat command, is a visit Back returns from. Watching the store
// catches all of them in one place; a step Back or Forward moves along the history instead of adding to it.
let seen = "";
let travelling = false;
ide.subscribe(() => {
  const { dir, back } = ide.state;
  if (dir === seen) return;
  const from = seen;
  seen = dir;
  if (!travelling) ide.set({ back: [...back, from].slice(-50), forward: [] });
});

/** The editor is an Artifacts tab whenever the Operating System is not drawing it. Closing the Operating System leaves it there. */
export const centerAway = (s: State = pane.state) => !osDrawsEditor(s);
/** Bring the center into view: the Artifacts' Editor tab, while it is away from the Operating System. */
export const showCenter = () => centerAway() && openArtifact("editor");

/** Go Back (-1) or Forward (1) a folder. Narrow, the folder list comes back over the editor. */
export function travel(step: -1 | 1) {
  const { dir, back, forward } = ide.state;
  const to = (step < 0 ? back : forward).at(-1);
  if (to === undefined) return;
  travelling = true;
  ide.set({
    dir: to,
    back: step < 0 ? back.slice(0, -1) : [...back, dir],
    forward: step < 0 ? [...forward, dir] : forward.slice(0, -1),
  });
  travelling = false;
}

/** The program each terminal is running in the shell, if any: aborting it is Ctrl+C. */
export const running = new Map<number, AbortController>();

export const patchTerm = (id: number, change: (t: Term) => Partial<Term>) =>
  ide.set({ terms: ide.state.terms.map((t) => (t.id === id ? { ...t, ...change(t) } : t)) });

/** Show the terminal panel (with one terminal in it, if none is open), with `line` typed in the terminal being used. */
export function showTerminal(line?: string) {
  if (ide.state.terms.length) ide.set({ termOpen: true });
  else newTerminal();
  if (line !== undefined) patchTerm(ide.state.term, () => ({ line }));
}

export function newTerminal() {
  const { terms, nextTerm } = ide.state;
  ide.set({ terms: [...terms, blank(nextTerm)], term: nextTerm, nextTerm: nextTerm + 1, termOpen: true });
}

/** Kill a terminal; the one next to it is shown. The last one going hides the panel. */
export function closeTerminal(id: number) {
  const { terms, term } = ide.state;
  const at = terms.findIndex((t) => t.id === id);
  if (at < 0) return;
  running.get(id)?.abort();
  const rest = terms.filter((t) => t.id !== id);
  ide.set({ terms: rest, term: term === id ? (rest[Math.min(at, rest.length - 1)]?.id ?? 0) : term, termOpen: rest.length ? ide.state.termOpen : false });
}

const tidy = (path: string) => path.split("/").filter(Boolean).join("/");
/** The tabs, with each group still showing its tab if it has it, else its last one. A group left empty gives up the focus. */
function settle(tabs: Tab[]) {
  const { active, activeRight, focus } = ide.state;
  const pick = (g: Group, now: string) => (tabs.some((t) => t.path === now && t.in.includes(g)) ? now : (tabs.filter((t) => t.in.includes(g)).at(-1)?.path ?? ""));
  const right = pick(1, activeRight);
  ide.set({ tabs, active: pick(0, active), activeRight: right, focus: right ? focus : 0 });
}
export const show = (g: Group, path: string) => ide.set(g ? { activeRight: path, focus: 1 } : { active: path, focus: 0 });
/** Open a tab in a group as well (the Split button: the file shown on the left opens on the right too). */
export function openIn(g: Group, path: string) {
  ide.set({ tabs: ide.state.tabs.map((t) => (t.path === path && !t.in.includes(g) ? { ...t, in: [...t.in, g] } : t)) });
  show(g, path);
}

const patch = (path: string, change: Partial<Tab>) => ide.set({ tabs: ide.state.tabs.map((t) => (t.path === path ? { ...t, ...change } : t)) });

/**
 * Open a file in the editor, in the Operating System, in the group last used. A tab with unsaved edits keeps them;
 * otherwise it shows the file as it is now.
 */
export async function openFile(at: string) {
  const path = tidy(at);
  const text = await read(path);
  if (text === null) throw new Error(`${path} isn't a file I can open.`);
  const g = ide.state.focus;
  const open = ide.state.tabs.find((t) => t.path === path);
  if (!open) ide.set({ tabs: [...ide.state.tabs, { path, text, saved: text, in: [g] }] });
  else if (open.text === open.saved) patch(path, { text, saved: text });
  openIn(g, path);
  ide.set({ dir: path.split("/").slice(0, -1).join("/") });
  openPane("os");
  showCenter();
}

/** Show a folder in the Operating System. */
export function openDir(dir: string) {
  ide.set({ dir: tidy(dir), active: "" });
  openPane("os");
}

export const editTab = (path: string, text: string) => patch(path, { text });
export const togglePreview = (path: string) => patch(path, { preview: !ide.state.tabs.find((t) => t.path === path)?.preview });

export async function saveTab(path: string) {
  const tab = ide.state.tabs.find((t) => t.path === path);
  if (!tab || tab.text === tab.saved) return;
  await write(path, tab.text);
  patch(path, { saved: tab.text });
}

/** Close a file's tab in a group. Its last tab going, it asks first when the file has unsaved edits. */
export function closeFile(path: string, g: Group = 0) {
  const tab = ide.state.tabs.find((t) => t.path === path);
  if (tab && tab.in.some((other) => other !== g)) return settle(ide.state.tabs.map((t) => (t === tab ? { ...t, in: t.in.filter((x) => x !== g) } : t)));
  if (tab && tab.text !== tab.saved && !window.confirm(`Close ${path.split("/").pop()} without saving your changes?`)) return;
  closeTab(path);
}

/** Delete a file or folder, once confirmed, and close its tabs. (Arcanus's source is in git, so that can be undone.) */
export async function discard(path: string) {
  if (!window.confirm(`Delete ${path}?${path.startsWith(`${SOURCE}/`) ? "" : " This can't be undone."}`)) return;
  await remove(path);
  closeTab(path);
}

/** Close a tab, and any tab inside it when it is a folder that was removed or renamed. */
export function closeTab(path: string) {
  settle(ide.state.tabs.filter((t) => t.path !== path && !t.path.startsWith(`${path}/`)));
}
