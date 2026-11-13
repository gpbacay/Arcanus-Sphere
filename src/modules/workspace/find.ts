// Searching Arcanus's files, the way a code editor's search does: words or a pattern, matched by case and whole word if
// asked, in the files a glob lets in. Pure (no browser), so find.check.ts runs it in Node. fs.ts walks the files and
// feeds them through here; the source is searched by git grep on the server with the same options.

export type FindOptions = {
  /** "Aa": upper and lower case must match. */
  matchCase?: boolean;
  /** "ab": only whole words. */
  wholeWord?: boolean;
  /** ".*": the query is a regular expression. */
  regex?: boolean;
  /** Globs, comma-separated: "*.md, memory". Empty lets every file in. */
  include?: string;
  /** Globs, comma-separated, kept out. */
  exclude?: string;
};

/** One line that matched: its number (from 1), its text, and where the first match starts and ends in it. */
export type LineHit = { line: number; text: string; from: number; to: number };
/** A file with what matched in it: its name (`named`), its lines, or both. */
export type FileHit = { path: string; named: boolean; lines: LineHit[] };

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The query as a regular expression, or the reason it isn't one (a broken pattern). */
export function matcher(query: string, o: FindOptions = {}): RegExp | string {
  const source = o.regex ? query : escape(query);
  try {
    return new RegExp(o.wholeWord ? `\\b(?:${source})\\b` : source, o.matchCase ? "g" : "gi");
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * One glob as a test on a path. As in a code editor: "*.ts" and "memory" match at any depth; a glob with a "/" matches
 * from the root ("src/**\/exclude"); a folder lets in everything under it. "**" crosses folders, "*" and "?" don't.
 */
function globTest(glob: string): (path: string) => boolean {
  const g = glob.trim().replace(/^\.?\//, "").replace(/\/+$/, "");
  const body = g
    .split(/(\*\*\/?|\*|\?)/)
    .map((part) => (part === "**/" || part === "**" ? "(?:.*/)?" + (part === "**" ? ".*" : "") : part === "*" ? "[^/]*" : part === "?" ? "[^/]" : escape(part)))
    .join("");
  const rooted = g.includes("/") ? `^${body}` : `(?:^|/)${body}`;
  const re = new RegExp(`${rooted}(?:/|$)`, "i");
  return (path) => re.test(path);
}

const globs = (list = "") => list.split(",").map((g) => g.trim()).filter(Boolean).map(globTest);

/** Whether a file's path is let in by `include` and not kept out by `exclude`. */
export function admits(path: string, o: FindOptions = {}): boolean {
  const ins = globs(o.include);
  if (ins.length && !ins.some((t) => t(path))) return false;
  return !globs(o.exclude).some((t) => t(path));
}

const MAX_LINES = 100; // per file
const MAX_TEXT = 220; // characters of a line shown

/** The lines of `text` that match `re`. A long line is cut around its match, so the match always shows. */
export function lineHits(text: string, re: RegExp): LineHit[] {
  const hits: LineHit[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length && hits.length < MAX_LINES; i++) {
    re.lastIndex = 0;
    const m = re.exec(lines[i]);
    if (!m || !m[0]) continue;
    const start = Math.max(0, m.index - 60);
    const shown = lines[i].slice(start, start + MAX_TEXT);
    const lead = shown.length - shown.trimStart().length;
    hits.push({ line: i + 1, text: shown.trim(), from: m.index - start - lead, to: m.index - start - lead + m[0].length });
  }
  return hits;
}

/** A file's hits for the query, or null when neither its name nor a line matches. */
export function fileHit(path: string, text: string | null, re: RegExp): FileHit | null {
  re.lastIndex = 0;
  const named = re.test(path.split("/").pop() ?? path);
  const lines = text === null ? [] : lineHits(text, re);
  return named || lines.length ? { path, named, lines } : null;
}

/** Most useful first: files whose name matches, then by how many lines match. */
export const ranked = (hits: FileHit[]) => [...hits].sort((a, b) => Number(b.named) - Number(a.named) || b.lines.length - a.lines.length || a.path.localeCompare(b.path));
