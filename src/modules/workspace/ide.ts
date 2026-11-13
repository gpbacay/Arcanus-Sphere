"use client";

// What Arcanus OS (the Files pane) has open: the folder being browsed, the files open in the editor as tabs, and whether it shows
// the files or git. Kept outside React so the chat's commands (/open, /source) and Arcanus's own skills can open a
// file in the editor, and so open tabs survive closing the pane.
import { openPane } from "@/shared/pane";
import { Store } from "@/shared/store";
import { read, write } from "./fs";

export type Tab = { path: string; text: string; saved: string };

export const ide = new Store({
  dir: "",
  tabs: [] as Tab[],
  /** The path of the tab being edited, or "" while the folder is shown. */
  active: "",
  view: "files" as "files" | "git" | "terminal",
  /** The terminal: what was typed and answered, and the line being typed. */
  log: [] as string[],
  line: "",
  /** The pane covers the stage, with the folder beside the editor. */
  wide: false,
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

/** Go Back (-1) or Forward (1) a folder. Narrow, the folder list comes back over the editor. */
export function travel(step: -1 | 1) {
  const { dir, back, forward, wide, active } = ide.state;
  const to = (step < 0 ? back : forward).at(-1);
  if (to === undefined) return;
  travelling = true;
  ide.set({
    dir: to,
    back: step < 0 ? back.slice(0, -1) : [...back, dir],
    forward: step < 0 ? [...forward, dir] : forward.slice(0, -1),
    view: "files",
    active: wide ? active : "",
  });
  travelling = false;
}

const tidy = (path: string) => path.split("/").filter(Boolean).join("/");
const patch = (path: string, change: Partial<Tab>) => ide.set({ tabs: ide.state.tabs.map((t) => (t.path === path ? { ...t, ...change } : t)) });

/** Open a file in the editor, in Arcanus OS. A tab with unsaved edits keeps them; otherwise it shows the file as it is now. */
export async function openFile(at: string) {
  const path = tidy(at);
  const text = await read(path);
  if (text === null) throw new Error(`${path} isn't a file I can open.`);
  const open = ide.state.tabs.find((t) => t.path === path);
  if (!open) ide.set({ tabs: [...ide.state.tabs, { path, text, saved: text }] });
  else if (open.text === open.saved) patch(path, { text, saved: text });
  ide.set({ active: path, view: "files", dir: path.split("/").slice(0, -1).join("/") });
  openPane("files");
}

/** Show a folder in Arcanus OS. */
export function openDir(dir: string) {
  ide.set({ dir: tidy(dir), active: "", view: "files" });
  openPane("files");
}

export const editTab = (path: string, text: string) => patch(path, { text });

export async function saveTab(path: string) {
  const tab = ide.state.tabs.find((t) => t.path === path);
  if (!tab || tab.text === tab.saved) return;
  await write(path, tab.text);
  patch(path, { saved: tab.text });
}

/** Close a tab, and any tab inside it when it is a folder that was removed or renamed. */
export function closeTab(path: string) {
  const tabs = ide.state.tabs.filter((t) => t.path !== path && !t.path.startsWith(`${path}/`));
  ide.set({ tabs, active: tabs.some((t) => t.path === ide.state.active) ? ide.state.active : (tabs.at(-1)?.path ?? "") });
}
