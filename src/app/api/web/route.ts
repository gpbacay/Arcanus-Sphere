// Arcanus's browser relay: the one part of the app that runs on a server. A browser page can't read other sites
// (CORS), so this fetches a page or a search for it and hands back text. It runs only when you browse or ask Arcanus
// to look something up; your chats never come here.
//   GET /api/web?url=https://…  -> Page   (title + readable text with links)
//   GET /api/web?q=…            -> { results, engine, brief? }   (free-search, else DuckDuckGo, else Wikipedia)
//   GET /api/web?open=https://… -> { opened, url }   (the machine's browser)
// ponytail: DNS is checked before each hop, not pinned for the connection (rebinding can slip through). No rate limit:
// add one before deploying this somewhere public.
import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { readBrief, readDuckDuckGo, readHtml, readWikipedia, type Page, type Result } from "@/shared/html";
import { freeSearch } from "./free-search";

export const dynamic = "force-dynamic";

const MAX_BYTES = 3_000_000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Arcanus/0.1";

function privateAddress(ip: string): boolean {
  const v4 = ip.replace(/^::ffff:/i, "");
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

/** Only public http(s) addresses: the relay must not become a way into the machine or network it runs on. */
async function checkTarget(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https pages open.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (!addresses.length || addresses.some(privateAddress)) throw new Error("Private and local network addresses don't open here.");
}

/** Fetch with each redirect checked the same way as the first address. */
async function get(href: string, accept = "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5") {
  let url = new URL(href);
  for (let hop = 0; hop < 6; hop++) {
    await checkTarget(url);
    const res = await fetch(url, { redirect: "manual", headers: { "user-agent": UA, accept, "accept-language": "en" }, signal: AbortSignal.timeout(12_000) });
    const next = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && next) {
      url = new URL(next, url);
      continue;
    }
    return { res, url };
  }
  throw new Error("Too many redirects.");
}

/** The body as text, cut off at MAX_BYTES. */
async function body(res: Response) {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size > MAX_BYTES) {
      await reader.cancel();
      break;
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Open `url` in the machine's browser. The address is one argument, never a shell string. */
function launch(url: string) {
  const child = process.platform === "win32"
    ? spawn("rundll32", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore", windowsHide: true })
    : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" });
  child.unref();
}

async function search(q: string): Promise<{ results: Result[]; engine: string; brief?: string }> {
  try {
    const brief = (await freeSearch().research(q)).slice(0, 3500);
    const results = readBrief(brief);
    if (brief) return { results, engine: "free-search", brief };
  } catch {
    /* uvx missing, or the engines blocked this process: DuckDuckGo below */
  }
  try {
    const { res } = await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`);
    const results = readDuckDuckGo(await body(res));
    if (results.length) return { results, engine: "DuckDuckGo" };
  } catch {
    /* DuckDuckGo sometimes answers bots with a challenge page: Wikipedia below */
  }
  const { res } = await get(`https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=8&srsearch=${encodeURIComponent(q)}`, "application/json");
  return { results: readWikipedia(JSON.parse(await body(res))), engine: "Wikipedia" };
}

function pageFromMarkdown(url: string, markdown: string): Page {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || new URL(url).hostname;
  return { url, title, text: markdown.slice(0, 60_000) };
}

const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

export async function GET(request: Request) {
  // Only Arcanus's own page may use the relay, so other sites can't borrow it from a visitor's browser.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return reply({ error: "Not available to other sites." }, 403);
  const params = new URL(request.url).searchParams;
  const q = params.get("q")?.trim().slice(0, 300);
  const open = params.get("open")?.trim();
  const target = params.get("url")?.trim();
  try {
    if (open) {
      const url = new URL(open);
      await checkTarget(url);
      launch(url.href);
      return reply({ opened: true, url: url.href });
    }
    if (q) return reply(await search(q));
    if (!target) return reply({ error: "Pass ?url=, ?q=, or ?open=." }, 400);
    try {
      const markdown = await freeSearch().fetch(target);
      if (markdown.trim()) return reply(pageFromMarkdown(target, markdown));
    } catch {
      /* the relay's own fetch below */
    }
    const { res, url } = await get(target);
    if (!res.ok) return reply({ error: `The site answered ${res.status}.` }, 502);
    const type = res.headers.get("content-type") ?? "";
    const text = await body(res);
    if (/html|xml/.test(type) || /^\s*</.test(text)) return reply(readHtml(text, url.href));
    if (/^text\/|json/.test(type)) return reply({ url: url.href, title: url.pathname.split("/").pop() || url.hostname, text: text.slice(0, 60_000) });
    return reply({ error: `That isn't a text page (${type.split(";")[0] || "unknown type"}).` }, 415);
  } catch (err) {
    return reply({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
}
