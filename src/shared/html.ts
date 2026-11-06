// Reading the web as text: a page's words and links, and a search engine's results. Pure functions with no imports,
// so html.check.ts runs them in Node. The server route (src/app/api/web) and the browser pane both use them.
// ponytail: regex reader, not a DOM. Good on articles and docs; client-rendered apps come back nearly empty.

export type Page = {
  url: string;
  title: string;
  /** One block per line: "# " starts a heading, "- " a list item. Links are written inline as [text](url). */
  text: string;
};
export type Result = { title: string; url: string; snippet: string };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", copy: "©" };

export function decode(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? whole;
    const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
  });
}

/** Tags out, entities decoded, whitespace collapsed: one line of plain text. */
export const strip = (html: string) => decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

const DROP = /<(script|style|noscript|svg|nav|footer|header|aside|form|iframe|template|button|select)\b[\s\S]*?<\/\1\s*>/gi;
const BLOCK = /<\/?(p|div|section|article|main|br|tr|table|blockquote|pre|ul|ol|dl|dd|dt|figure|figcaption|hr)\b[^>]*>/gi;

/** A page as readable text with its links inline, capped at `max` characters. */
export function readHtml(html: string, url: string, max = 60_000): Page {
  const title = strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") || url;
  let body = html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html;
  // The article itself, when the page marks it, without the site's menus around it.
  body = body.match(/<(main|article)\b[\s\S]*<\/\1>/i)?.[0] ?? body;
  body = body
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(DROP, " ")
    .replace(/<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, inner: string) => {
      const label = strip(inner).replace(/[[\]]/g, "");
      try {
        const target = new URL(decode(href), url);
        if (label && /^https?:$/.test(target.protocol)) return ` [${label}](${target.href.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\s/g, "%20")}) `;
      } catch {
        /* a broken href is just its words */
      }
      return ` ${label} `;
    })
    .replace(/<h[1-6]\b[^>]*>/gi, "\n# ")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(BLOCK, "\n")
    .replace(/<[^>]*>/g, " ");
  const lines = decode(body)
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line) => line && line !== "-" && line !== "#");
  return { url, title, text: lines.join("\n").slice(0, max) };
}

/** The page's words without link targets: what the language model reads. */
export const plainText = (text: string) => text.replace(/\[([^\]]*)\]\([^)\s]*\)/g, "$1");

/** Results from DuckDuckGo's HTML page (html.duckduckgo.com/html), ads left out. */
export function readDuckDuckGo(html: string): Result[] {
  return html
    .split(/(?=<a\b[^>]*class="result__a")/)
    .flatMap((part): Result[] => {
      const link = part.match(/^<a\b([^>]*class="result__a"[^>]*)>([\s\S]*?)<\/a>/);
      const href = decode(link?.[1].match(/href="([^"]+)"/)?.[1] ?? "");
      if (!link || !href) return [];
      let target: URL;
      try {
        target = new URL(href, "https://duckduckgo.com");
      } catch {
        return [];
      }
      const real = target.hostname.endsWith("duckduckgo.com") ? target.searchParams.get("uddg") : target.href;
      if (!real || !/^https?:/.test(real)) return [];
      return [{ title: strip(link[2]), url: real, snippet: strip(part.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? "") }];
    });
}

/** Links in a free-search brief: markdown [title](url) or "Title — <https://…>". */
export function readBrief(markdown: string): Result[] {
  const results: Result[] = [];
  const push = (title: string, url: string) => {
    const href = url.replace(/[).,]+$/, "");
    if (!/^https?:\/\//i.test(href) || results.some((r) => r.url === href)) return;
    results.push({ title: title.replace(/^\d+\s*/, "").replace(/\s+[—–-]\s*$/, "").trim() || href, url: href, snippet: "" });
  };
  for (const line of markdown.split("\n")) {
    const linked = line.match(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/);
    if (linked) push(linked[1], linked[2]);
    else {
      const auto = line.match(/^(?:[-*]\s*)?(?:\[\d+\]\s*)?(.+?)\s+[—–-]\s+<?(https?:\/\/[^\s>]+)>?/);
      if (auto) push(auto[1], auto[2]);
    }
    if (results.length >= 8) break;
  }
  return results;
}

/** Results from the Wikipedia search API (list=search, format=json). */
export function readWikipedia(json: unknown, lang = "en"): Result[] {
  const hits = (json as { query?: { search?: { title?: string; snippet?: string }[] } })?.query?.search ?? [];
  return hits.flatMap((hit) =>
    hit.title
      ? [{ title: hit.title, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`, snippet: strip(hit.snippet ?? "") }]
      : []
  );
}
