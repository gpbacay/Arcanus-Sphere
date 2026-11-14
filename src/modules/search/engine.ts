"use client";

// Arcanus's search engine: its own file system first, the web when it is needed and there. Files are searched as you
// type (they are on this device, so it takes milliseconds); pressing Enter also asks ARC 1 whether the query needs the
// internet, and searches the web too when it does (or when no file matches) and the device is online. A query about
// a file or artifact already open does not: that stays in the files. An address
// (example.com, http://localhost:3001) goes straight to the browser: one box for all three. The web side is the web module's browser, so what the chat's web skill reads shows here.
import { searchIntent } from "@/modules/brain";
import { aboutOpen } from "@/modules/harness";
import { browser, go, toTarget } from "@/modules/web";
import { ide, searchFiles, type FileResults, type FindOptions } from "@/modules/workspace";
import { pane, shownAt } from "@/shared/pane";
import { Store } from "@/shared/store";

/** Why the web was or wasn't searched: ARC 1's choice, no file matched, or offline. */
export type WebWhy = "arc1" | "no files" | "offline" | "not needed";

export const engine = new Store({
  query: "",
  options: {} as FindOptions,
  files: null as FileResults | null,
  searching: false,
  /** ARC 1's reading of the last query searched with Enter. */
  intent: null as { where: "files" | "web"; by: string } | null,
  web: null as WebWhy | null,
});

let seq = 0;

/** Search the files only, as the query is typed. */
export async function findFiles(query = engine.state.query) {
  const mine = ++seq;
  const q = query.trim();
  if (!q) return engine.set({ files: null, searching: false });
  engine.set({ searching: true });
  // Arcanus's own files show the moment they are read; the source's join them when the server answers.
  const files = await searchFiles(q, engine.state.options, (partial) => mine === seq && engine.set({ files: partial })).catch(
    (err: unknown) => ({ files: [], matches: 0, more: false, error: String(err) }) as FileResults,
  );
  if (mine === seq) engine.set({ files, searching: false });
  return files;
}

/** The whole search, as Enter runs it: files, then the web if ARC 1 says it is needed (or nothing local matched). */
export async function runSearch(query = engine.state.query) {
  const q = query.trim();
  if (!q) return;
  // An address opens in the browser, whatever else the box could mean.
  if (!toTarget(q).startsWith("search:")) {
    engine.set({ files: null, intent: null, web: null });
    return void go(q).catch(() => undefined);
  }
  const [files, intent] = await Promise.all([findFiles(q), searchIntent(q)]);
  if (q !== engine.state.query.trim()) return; // typed on since
  // A query about a file or artifact already open stays in the files. The browser is not opened for it.
  const artifact = shownAt(pane.state, "artifacts") ? pane.state.artifact : "";
  const local = aboutOpen(q, ide.state.tabs.map((t) => t.path), /\.html?$/i.test(artifact) ? artifact : "");
  const wanted = !local && (intent?.where === "web" || !files?.files.length);
  const web: WebWhy = !wanted ? "not needed" : !navigator.onLine ? "offline" : intent?.where === "web" ? "arc1" : "no files";
  engine.set({ intent: intent && { where: intent.where, by: intent.by }, web });
  if (web === "arc1" || web === "no files") void go(`search:${q}`).catch(() => undefined);
  else browser.set({ view: null, error: "", loading: "" });
}
