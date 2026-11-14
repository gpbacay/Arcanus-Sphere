// "@name" in the composer attaches a file. The name is whatever is being typed at the caret, after @,
// and only when @ starts the draft or follows a space, so an email address is left alone.

const MENTION = /(?:^|\s)@([^\s@]*)$/;

/** The file name being typed at `cursor`. Null when there isn't one. "" is a bare "@". */
export function mentionQuery(draft: string, cursor = draft.length): string | null {
  const m = draft.slice(0, cursor).match(MENTION);
  return m ? m[1] : null;
}

/** Remove that @name. The caret stays where the name was. */
export function withoutMention(draft: string, cursor = draft.length): { text: string; cursor: number } {
  const upto = draft.slice(0, cursor);
  const m = upto.match(MENTION);
  if (!m || m.index === undefined) return { text: draft, cursor };
  const at = m.index + (upto[m.index] === "@" ? 0 : 1);
  const next = (draft.slice(0, at) + draft.slice(cursor)).replace(/[^\S\n]{2,}/g, " ");
  if (at === 0) return { text: next.replace(/^[^\S\n]+/, "").replace(/[^\S\n]+$/, ""), cursor: 0 };
  const text = next.replace(/[^\S\n]+$/, "");
  return { text, cursor: Math.min(at, text.length) };
}

/** Up to eight files for the menu: the name first, then the path, open files first when @ is still bare. */
export function rankFiles(paths: string[], query: string, open: readonly string[] = []): string[] {
  const q = query.toLowerCase();
  const front = new Set(open);
  const score = (path: string) => {
    const name = (path.split("/").pop() ?? path).toLowerCase();
    if (!q) return front.has(path) ? 2 : 1;
    if (name.startsWith(q)) return 4;
    if (name.includes(q)) return 3;
    if (path.toLowerCase().includes(q)) return 2;
    return 0;
  };
  return paths
    .filter((path) => score(path) > 0)
    .sort((a, b) => score(b) - score(a) || a.length - b.length || a.localeCompare(b))
    .slice(0, 8);
}
