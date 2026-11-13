"use client";

// What the Files pane has open: the folder being browsed, the files open in the editor as tabs, and whether it shows
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
  view: "files" as "files" | "git",
  /** The pane covers the stage, with the folder beside the editor. */
  wide: false,
});

const tidy = (path: string) => path.split("/").filter(Boolean).join("/");
const patch = (path: string, change: Partial<Tab>) => ide.set({ tabs: ide.state.tabs.map((t) => (t.path === path ? { ...t, ...change } : t)) });

/** Open a file in the editor, in the Files pane. A tab with unsaved edits keeps them; otherwise it shows the file as it is now. */
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

/** Show a folder in the Files pane. */
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
