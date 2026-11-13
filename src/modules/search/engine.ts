"use client";

// Arcanus's search engine: its own file system first, the web when it is needed and there. Files are searched as you
// type (they are on this device, so it takes milliseconds); pressing Enter also asks ARC 1 whether the query needs the
// internet, and searches the web too when it does (or when no file matches) and the device is online. An address goes
// straight to the reader. The web side is the web module's browser, so what the chat's web skill reads shows here.
import { searchIntent } from "@/modules/brain";
import { browser, go, toTarget } from "@/modules/web";
import { searchFiles, type FileResults, type FindOptions } from "@/modules/workspace";
import { Store } from "@/shared/store";

export type Scope = "all" | "files" | "web";
/** Why the web was or wasn't searched: ARC 1's choice, the scope, no file matched, or offline. */
export type WebWhy = "arc1" | "scope" | "no files" | "offline" | "files only" | "not needed";

export const engine = new Store({
  query: "",
  options: {} as FindOptions,
  scope: "all" as Scope,
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
  if (!q || engine.state.scope === "web") return engine.set({ files: null, searching: false });
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
  const { scope } = engine.state;
  // An address opens in the reader, whatever else the box could mean.
  if (scope !== "files" && !toTarget(q).startsWith("search:")) {
    engine.set({ files: null, intent: null, web: "scope" });
    return void go(q).catch(() => undefined);
  }
  const [files, intent] = await Promise.all([scope === "web" ? null : findFiles(q), scope === "all" ? searchIntent(q) : null]);
  if (q !== engine.state.query.trim()) return; // typed on since
  const wanted = scope === "web" || intent?.where === "web" || (scope === "all" && !files?.files.length);
  const web: WebWhy = scope === "files" ? "files only" : !wanted ? "not needed" : !navigator.onLine ? "offline" : scope === "web" ? "scope" : intent?.where === "web" ? "arc1" : "no files";
  engine.set({ intent: intent && { where: intent.where, by: intent.by }, web });
  if (web === "arc1" || web === "scope" || web === "no files") void go(`search:${q}`).catch(() => undefined);
  else browser.set({ view: null, error: "", loading: "" });
}
