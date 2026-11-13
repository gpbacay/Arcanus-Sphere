"use client";

// The search engine's file side: every file in Arcanus's file system, by name and by line (find.ts matches). The
// browser's folders are walked and read here; the source is searched where it lives, by git grep on the server, which
// is far faster than reading each file across the network.
import { HOME, SOURCE, list, read, workspace } from "./fs";
import { admits, fileHit, matcher, ranked, type FileHit, type FindOptions, type LineHit } from "./find";
import { searchSource, source, sourceFiles } from "./source";

export type FileResults = { files: FileHit[]; matches: number; more: boolean; error?: string };

// What is read as text. Anything else can still match by its name.
const TEXT = /\.(?:md|markdown|txt|json|jsonl|csv|tsv|ya?ml|toml|ini|log|html?|css|svg|xml|[cm]?[jt]sx?|py|sh|ps1|sql)$|^[^.]+$/i;
// ponytail: a walk stops at 3,000 files, which a browser folder never nears; an opened project folder might.
const MAX_FILES = 3000;
const SKIP = /^(?:node_modules|\.git|\.next|dist|build)$/;

async function walk(dir: string, out: string[]) {
  for (const entry of await list(dir).catch(() => [])) {
    if (out.length >= MAX_FILES) return;
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    if (path === SOURCE) continue; // the source is searched on the server
    if (entry.kind === "directory") {
      if (!SKIP.test(entry.name)) await walk(path, out);
    } else out.push(path);
  }
}

/** The source's hits, as file hits under .arcanus/source. Its lines come from git grep; their match is found again here. */
// The source's file names, kept a minute: they change far less often than a query does, so typing doesn't ask again.
let names: { at: number; list: Promise<string[]> } | null = null;
const sourceNames = () => {
  if (!names || Date.now() - names.at > 60_000) names = { at: Date.now(), list: sourceFiles() };
  names.list.catch(() => (names = null));
  return names.list;
};

async function sourceHits(query: string, re: RegExp, o: FindOptions): Promise<{ files: FileHit[]; more: boolean }> {
  const [names, grep] = await Promise.all([sourceNames(), searchSource(query, { matchCase: o.matchCase, wholeWord: o.wholeWord, regex: o.regex, limit: 2000 })]);
  const byPath = new Map<string, LineHit[]>();
  for (const h of grep.hits) {
    re.lastIndex = 0;
    const m = re.exec(h.text);
    const lines = byPath.get(h.path) ?? [];
    lines.push({ line: h.line, text: h.text, from: m?.index ?? 0, to: (m?.index ?? 0) + (m?.[0].length ?? 0) });
    byPath.set(h.path, lines);
  }
  const files: FileHit[] = [];
  for (const path of new Set([...names, ...byPath.keys()])) {
    const full = `${SOURCE}/${path}`;
    if (!admits(full, o)) continue;
    re.lastIndex = 0;
    const named = re.test(path.split("/").pop() ?? path);
    const lines = byPath.get(path) ?? [];
    if (named || lines.length) files.push({ path: full, named, lines });
  }
  return { files, more: grep.more };
}

const results = (files: FileHit[], more: boolean): FileResults => {
  const sorted = ranked(files);
  return { files: sorted, matches: sorted.reduce((n, f) => n + f.lines.length + Number(f.named && !f.lines.length), 0), more };
};

/**
 * Search Arcanus's file system for `query`: its files in the browser (or the folder opened from the Files pane), and its
 * own source code when it is reachable. Files whose name matches come first, then those with the most matching lines.
 * `onLocal` gets the browser's files as soon as they are read (milliseconds), before the source answers.
 */
export async function searchFiles(query: string, o: FindOptions = {}, onLocal?: (partial: FileResults) => void): Promise<FileResults> {
  const re = matcher(query, o);
  if (typeof re === "string") return { files: [], matches: 0, more: false, error: re };
  const paths: string[] = [];
  // In Arcanus's home, only its own folder: the owner's home is the browser's root, which also holds every other
  // account's home (accounts/), and those are never searched. An opened folder is searched whole, like an editor's.
  const start = workspace.state.kind === "home" ? HOME : "";
  const fromSource = source.state.available ? sourceHits(query, matcher(query, o) as RegExp, o).catch(() => ({ files: [] as FileHit[], more: false })) : null;
  await walk(start, paths);
  const local: FileHit[] = [];
  for (const path of paths) {
    if (!admits(path, o)) continue;
    const text = TEXT.test(path.split("/").pop() ?? "") ? await read(path).catch(() => null) : null;
    const hit = fileHit(path, text, re);
    if (hit) local.push(hit);
  }
  const capped = paths.length >= MAX_FILES;
  if (!fromSource) return results(local, capped);
  onLocal?.(results(local, capped));
  const src = await fromSource;
  return results([...local, ...src.files], capped || src.more);
}

/** Where Arcanus's own files start, for a hit's path shown short ("memory/a.md" for ".arcanus/memory/a.md"). */
export const shortPath = (path: string) => (path.startsWith(`${SOURCE}/`) ? `source/${path.slice(SOURCE.length + 1)}` : path.startsWith(`${HOME}/`) ? path.slice(HOME.length + 1) : path);
