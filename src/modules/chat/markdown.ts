// Assistant replies as a small markdown tree. Pure data, no React, so markdown.check.ts can run it in Node.
// ponytail: a scanner, not a markdown library. Covers what a reply actually uses: links, emphasis,
// code, headings, lists, quotes. Tables and raw HTML stay text.

export type Inline = string | { b: Inline[] } | { i: Inline[] } | { c: string } | { a: string; v: Inline[] } | { br: 1 };

export type Block = { p: Inline[] } | { h: 1 | 2 | 3; v: Inline[] } | { ul: Inline[][] } | { ol: Inline[][] } | { q: Inline[] } | { pre: string };

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
    const at = src.slice(i).search(/[`*_[\n]|https?:\/\//);
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
    if (src[i] === "[") {
      const link = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/.exec(src.slice(i));
      const ok = link ? safe(link[2]) : null;
      if (link && ok) {
        out.push({ a: ok, v: inlines(link[1]) });
        i += link[0].length;
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

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const para: string[] = [];
  const flush = () => {
    if (!para.length) return;
    blocks.push({ p: inlines(para.join("\n")) });
    para.length = 0;
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line) && !para.length) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push({ pre: body.join("\n") });
      continue;
    }
    if (!line.trim()) {
      flush();
      i++;
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading && !para.length) {
      blocks.push({ h: heading[1].length as 1 | 2 | 3, v: inlines(heading[2]) });
      i++;
      continue;
    }
    const item = /^(\s*)([-*]|\d+\.)\s+(.+)$/.exec(line);
    if (item && !para.length) {
      const ordered = /\d/.test(item[2]);
      const items: Inline[][] = [];
      while (i < lines.length) {
        const next = /^(\s*)([-*]|\d+\.)\s+(.+)$/.exec(lines[i]);
        if (!next || /\d/.test(next[2]) !== ordered) break;
        items.push(inlines(next[3]));
        i++;
      }
      blocks.push(ordered ? { ol: items } : { ul: items });
      continue;
    }
    if (line.startsWith(">") && !para.length) {
      const quoted: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) quoted.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ q: inlines(quoted.join("\n")) });
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return blocks;
}
