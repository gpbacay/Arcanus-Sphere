// Turn "go to youtube and search ASMR" into a real browser address. Pure: no browser, no network,
// so navigate.check.ts runs it in Node. ARC 1 fills site and query; this only builds the URL.

export type WebCall = { name: "open_browser" | "search_web" | "read_page"; arguments: Record<string, string> };

/** Offered to ARC 1. It picks one and anchors the fields in the message's own words. */
export const WEB_TOOLS = [
  {
    name: "open_browser",
    description: "Open a website in the user's own browser. Use when they say go to, open, or navigate to a site, including searching on that site.",
    parameters: [
      { name: "site", type: "string", description: "The site to open, such as youtube, github, or a url", required: true },
      { name: "query", type: "string", description: "What to search for on that site", required: false },
    ],
  },
  {
    name: "search_web",
    description: "Search the internet and read pages so the answer has context from the web.",
    parameters: [{ name: "query", type: "string", description: "The words to search for", required: true }],
  },
  {
    name: "read_page",
    description: "Read one web page so the answer has that page as context.",
    parameters: [{ name: "url", type: "string", description: "The page address", required: true }],
  },
];

const SITES: { names: string[]; home: string; search: (q: string) => string }[] = [
  { names: ["youtube", "yt"], home: "https://www.youtube.com/", search: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` },
  { names: ["google"], home: "https://www.google.com/", search: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  { names: ["github"], home: "https://github.com/", search: (q) => `https://github.com/search?q=${encodeURIComponent(q)}&type=repositories` },
  { names: ["wikipedia", "wiki"], home: "https://en.wikipedia.org/", search: (q) => `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(q)}` },
  { names: ["reddit"], home: "https://www.reddit.com/", search: (q) => `https://www.reddit.com/search/?q=${encodeURIComponent(q)}` },
  { names: ["maps"], home: "https://maps.google.com/", search: (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` },
];

const GO = /^(?:please\s+)?(?:go to|navigate to|take me to|pull up|open|browse to)\s+([\s\S]+)$/i;
const AND_SEARCH = /^(.*?)(?:\s+and\s+|\s*,\s*)(?:search(?:\s+for)?|look up|find)\s+(.+)$/i;
const ASK = /^(?:please\s+)?(?:search(?:\s+(?:the\s+)?(?:web|internet|online))?(?:\s+for)?|google|look\s+up|find\s+online)\s+([\s\S]+)$/i;

const keyOf = (site: string) =>
  site.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").replace(/\.(?:com|org|net)$/, "");

const known = (site: string) => {
  const key = keyOf(site.split(/\s+and\s+|\s+search\b/i)[0] ?? site);
  return SITES.find((s) => s.names.includes(key));
};

/** An address the user's browser can open. A known site with a query uses that site's search. */
export function browserUrl(site: string, query = ""): string {
  const q = query.trim().replace(/^(?:search(?:\s+for)?|look up|find)\s+/i, "").trim();
  const raw = site.trim();
  const hit = known(raw);
  if (hit) return q ? hit.search(q) : hit.home;
  if (/^https?:\/\//i.test(raw)) {
    const url = new URL(raw);
    const on = known(url.hostname);
    return q && on ? on.search(q) : q ? `https://www.google.com/search?q=${encodeURIComponent(`${url.hostname} ${q}`)}` : url.href;
  }
  if (!q && /^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(raw)) return `https://${raw}`;
  if (!q && /^[a-z0-9-]+$/i.test(raw)) return `https://www.${raw.toLowerCase()}.com/`;
  const words = [raw, q].filter(Boolean).join(" ");
  if (!words) throw new Error("Which site should I open?");
  return `https://www.google.com/search?q=${encodeURIComponent(words)}`;
}

/**
 * The web action spelled out in the message, or null when it isn't a command.
 * Used when ARC 1 holds a tool back, and as the tool ARC 1 is asked to fill when the command is plain.
 */
export function commandTool(text: string): WebCall | null {
  const go = text.trim().match(GO);
  if (go) {
    const rest = go[1].replace(/[?.!]+$/, "").trim();
    const and = rest.match(AND_SEARCH);
    if (and) return { name: "open_browser", arguments: { site: and[1].trim(), query: and[2].trim() } };
    const link = rest.match(/\bhttps?:\/\/\S+/i)?.[0];
    return { name: "open_browser", arguments: link ? { site: link } : { site: rest } };
  }
  const link = text.match(/\bhttps?:\/\/[^\s<>"')\]]+/i)?.[0];
  if (link) return { name: "read_page", arguments: { url: link } };
  const ask = text.trim().match(ASK);
  if (ask) return { name: "search_web", arguments: { query: ask[1].replace(/\s+(?:online|on the (?:web|internet))\s*[?.!]*$/i, "").trim() } };
  if (/\b(?:search|google|look up|on the (?:web|internet)|online)\b/i.test(text)) {
    const query = text.replace(/\b(?:please\s+)?(?:search(?:\s+(?:the\s+)?(?:web|internet|online))?(?:\s+for)?|google|look up|find online)\b/gi, " ").replace(/\s+/g, " ").trim();
    return query ? { name: "search_web", arguments: { query } } : null;
  }
  return null;
}

const filled = (args: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(args).flatMap(([k, v]) => (typeof v === "string" && v.trim() ? [[k, v.trim()]] : [])));

/**
 * ARC 1's tool, with arguments filled in. A navigation command already names the site and the query
 * ("go to youtube and search ASMR"); those win, because ARC 1 anchors a span and can put the same word in both fields.
 */
export function mergeCall(arc: { name: string; arguments: Record<string, unknown> } | null, fallback: WebCall | null): WebCall | null {
  if (!arc && !fallback) return null;
  if (fallback?.name === "open_browser") {
    const fromArc = arc?.name === "open_browser" ? filled(arc.arguments) : {};
    return { name: "open_browser", arguments: { ...fromArc, ...fallback.arguments } };
  }
  if (!arc || (arc.name !== "open_browser" && arc.name !== "search_web" && arc.name !== "read_page")) return fallback;
  return { name: arc.name, arguments: { ...fallback?.arguments, ...filled(arc.arguments) } };
}
