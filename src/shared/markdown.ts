// Markdown as a small tree: assistant replies, and the files previewed in the Operating System. Pure data, no React,
// so markdown.check.ts can run it in Node.
// ponytail: a scanner, not a markdown library. Covers what replies and notes use: links and [[links]], emphasis,
// strikethrough, code, headings, lists and task lists, quotes, rules and tables. Nested lists come out flat; raw HTML
// and images stay text.

/** `w`: a [[link]] to a note, by the name or path written in it (the workspace resolves it). `task`: a task list's box. */
export type Inline = string | { b: Inline[] } | { i: Inline[] } | { s: Inline[] } | { c: string } | { a: string; v: Inline[] } | { w: string; v: Inline[] } | { task: boolean } | { br: 1 };

export type Align = "left" | "center" | "right" | undefined;
export type Block =
  | { p: Inline[] }
  | { h: 1 | 2 | 3 | 4 | 5 | 6; v: Inline[] }
  | { ul: Inline[][] }
  | { ol: Inline[][]; start: number }
  | { q: Inline[] }
  | { pre: string }
  | { hr: 1 }
  | { table: { head: Inline[][]; align: Align[]; rows: Inline[][][] } };

const OPEN = /[\s([{"']/;
const CLOSE = /[\s.,;:!?)\]}"']/;

function safe(href: string): string | null {
  try {
    const url = new URL(href);
    if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname.includes(".")) return url.href;
  } catch {
    /* not a link */
  }
  return null;
}

/** Trailing sentence punctuation stays outside the link. A ")" stays when it closes one opened inside the url. */
function peel(raw: string): [string, string] {
  let href = raw;
  let tail = "";
  for (;;) {
    const c = href.at(-1);
    if (!c) break;
    const extraParen = c === ")" && (href.match(/\)/g)?.length ?? 0) > (href.match(/\(/g)?.length ?? 0);
    if (extraParen || ".,;:!?".includes(c)) {
      tail = c + tail;
      href = href.slice(0, -1);
      continue;
    }
    break;
  }
  return [href, tail];
}

function push(out: Inline[], v: string) {
  if (!v) return;
  const last = out.at(-1);
  if (typeof last === "string") out[out.length - 1] = last + v;
  else out.push(v);
}

export function inlines(src: string): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  while (i < src.length) {
    const at = src.slice(i).search(/[`*_[\n~]|https?:\/\//);
    if (at > 0) {
      push(out, src.slice(i, i + at));
      i += at;
      continue;
    }
    if (at < 0) {
      push(out, src.slice(i));
      break;
    }
    if (src.startsWith("http://", i) || src.startsWith("https://", i)) {
      const raw = /^https?:\/\/[^\s<>"']+/.exec(src.slice(i))![0];
      const [href, tail] = peel(raw);
      const ok = safe(href);
      if (ok) out.push({ a: ok, v: [href] });
      else push(out, href);
      push(out, tail);
      i += raw.length;
      continue;
    }
    if (src[i] === "\n") {
      out.push({ br: 1 });
      i++;
      continue;
    }
    if (src[i] === "`") {
      const j = src.indexOf("`", i + 1);
      if (j > i + 1 && !src.slice(i + 1, j).includes("\n")) {
        out.push({ c: src.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
    }
    if (src.startsWith("[[", i)) {
      const wiki = /^\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/.exec(src.slice(i));
      if (wiki) {
        out.push({ w: wiki[1].trim(), v: [(wiki[2] ?? wiki[1]).trim()] });
        i += wiki[0].length;
        continue;
      }
    }
    if (src[i] === "[") {
      const link = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/.exec(src.slice(i));
      const ok = link ? safe(link[2]) : null;
      if (link && ok) {
        out.push({ a: ok, v: inlines(link[1]) });
        i += link[0].length;
        continue;
      }
    }
    if (src.startsWith("~~", i)) {
      const j = src.indexOf("~~", i + 2);
      if (j > i + 2) {
        out.push({ s: inlines(src.slice(i + 2, j)) });
        i = j + 2;
        continue;
      }
    }
    const mark = src.startsWith("**", i) || src.startsWith("__", i) ? src.slice(i, i + 2) : src[i];
    const prev = src[i - 1];
    const next = src[i + mark.length];
    const open = (mark.length === 2 || !prev || OPEN.test(prev)) && !!next && next !== " " && next !== "\n";
    if (open && (mark === "*" || mark === "**" || mark === "_" || mark === "__")) {
      const j = src.indexOf(mark, i + mark.length);
      const after = src[j + mark.length];
      if (j > i + mark.length && (mark.length === 2 || !after || CLOSE.test(after))) {
        const inner = inlines(src.slice(i + mark.length, j));
        out.push(mark.length === 2 ? { b: inner } : { i: inner });
        i = j + mark.length;
        continue;
      }
    }
    push(out, src[i]);
    i++;
  }
  return out;
}

const ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const DIVIDER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
/** A table row's cells: "| a | b |" -> ["a", "b"]. A "\|" stays in its cell. */
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));

function item(text: string): Inline[] {
  const box = /^\[([ xX])\]\s+/.exec(text);
  return box ? [{ task: box[1] !== " " }, ...inlines(text.slice(box[0].length))] : inlines(text);
}

/**
 * `breaks`: a line break inside a paragraph is kept, as in a chat reply. Off, as in a markdown file, the lines of a
 * paragraph run together and only a line ending in two spaces or a backslash breaks.
 */
export function parseMarkdown(src: string, { breaks = true } = {}): Block[] {
  const blocks: Block[] = [];
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const para: string[] = [];
  const flush = () => {
    if (!para.length) return;
    const text = breaks ? para.join("\n") : para.map((l, k) => (k === para.length - 1 ? l : / {2,}$|\\$/.test(l) ? `${l.replace(/\s+$|\\$/, "")}\n` : `${l} `)).join("");
    blocks.push({ p: inlines(text.trim()) });
    para.length = 0;
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      flush();
      i++;
      continue;
    }
    if (/^\s*```/.test(line)) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push({ pre: body.join("\n") });
      continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ h: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6, v: inlines(heading[2]) });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      flush();
      blocks.push({ hr: 1 });
      i++;
      continue;
    }
    if (line.includes("|") && DIVIDER.test(lines[i + 1] ?? "") && lines[i + 1].includes("-")) {
      flush();
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c): Align => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : undefined));
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]).map(inlines));
      blocks.push({ table: { head: head.map(inlines), align, rows } });
      continue;
    }
    const first = ITEM.exec(line);
    // A list may follow a paragraph's line directly, as in "For example:\n- one"; a numbered one only from 1, so a
    // sentence that wraps onto "2024. Then" stays a sentence.
    if (first && (!para.length || !/\d/.test(first[1]) || /^1[.)]$/.test(first[1]))) {
      flush();
      const ordered = /\d/.test(first[1]);
      const items: Inline[][] = [];
      while (i < lines.length) {
        const next = ITEM.exec(lines[i]);
        if (next) {
          if (/\d/.test(next[1]) !== ordered) break;
          items.push(item(next[2]));
        } else if (/^\s+\S/.test(lines[i]) && items.length) items[items.length - 1].push(" ", ...inlines(lines[i].trim())); // an item's own next line
        else break;
        i++;
      }
      blocks.push(ordered ? { ol: items, start: parseInt(first[1], 10) } : { ul: items });
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      flush();
      const quoted: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) quoted.push(lines[i++].replace(/^\s{0,3}>\s?/, ""));
      blocks.push({ q: inlines(quoted.join("\n")) });
      continue;
    }
    para.push(line.trimStart());
    i++;
  }
  flush();
  return blocks;
}
