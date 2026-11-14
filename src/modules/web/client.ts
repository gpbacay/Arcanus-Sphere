"use client";

// Arcanus's browser: history, the page or results in view. A page opens in the live browser (live.ts), a real one on
// this computer, and is read from what it shows; where that can't run, the relay (src/app/api/web) brings its text for
// the reader. Searches always go through the relay. The chat's web skill drives the same browser, so what Arcanus
// reads is what the search engine (an artifact) shows.
import type { Page, Result } from "@/shared/html";
import { openArtifact } from "@/shared/pane";
import { Store, errorText } from "@/shared/store";
import { openLive } from "./live";

/** The search engine's tab: its file in .arcanus/artifacts/. */
export const SEARCH = "search-engine.html";

/** `live`: the page is in the live browser, shown as it is; otherwise it is in the reader, as text. */
export type View = { kind: "page"; page: Page; live?: boolean } | { kind: "results"; query: string; results: Result[]; engine: string; brief?: string };

export const browser = new Store({
  view: null as View | null,
  /** The address or search being loaded, if any. */
  loading: "",
  error: "",
  /** Addresses, and searches as "search:<words>". */
  history: [] as string[],
  at: -1,
});

/** "example.com/x" or "https://…" is an address; anything else is a search. file:<path> (a file of my source), disk:<path> (a file on This PC) and
 *  data:text/html,… (a page from my other files) are pages only the live browser opens: see openFile in workspace. */
export function toTarget(input: string): string {
  const text = input.trim();
  if (/^(?:search|file|disk):/.test(text) || /^https?:\/\/|^data:text\/html[;,]/i.test(text)) return text;
  // This computer and the network it is on (localhost:3001, 192.168.1.5:8080) answer plain http; the web, https.
  if (/^(?:localhost|127(?:\.\d+){3}|\[::1\]|10(?:\.\d+){3}|192\.168(?:\.\d+){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d+){2})(:\d+)?(\/\S*)?$/i.test(text)) return `http://${text}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(text)) return `https://${text}`;
  return `search:${text}`;
}

async function relay<T>(params: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/web?${params}`, { headers: { "x-arcanus": "web" } });
  } catch {
    throw new Error("No connection to the internet.");
  }
  const data = await res.json().catch(() => ({ error: `The browser relay answered ${res.status}.` }));
  if (!res.ok || data.error) throw new Error(data.error ?? `The browser relay answered ${res.status}.`);
  return data as T;
}

async function page(url: string): Promise<View> {
  const shown = await openLive(url);
  if (!shown && !/^https?:/i.test(url)) throw new Error("A file opens only in my live browser: Arcanus at localhost, with a Chromium-based browser installed.");
  return shown ? { kind: "page", page: shown, live: true } : { kind: "page", page: await relay<Page>(`url=${encodeURIComponent(url)}`) };
}

let seq = 0;
async function load(target: string): Promise<View> {
  const mine = ++seq;
  browser.set({ loading: target, error: "" });
  try {
    const query = target.startsWith("search:") ? target.slice(7) : "";
    const view: View = query
      ? { kind: "results", query, ...(await relay<{ results: Result[]; engine: string; brief?: string }>(`q=${encodeURIComponent(query)}`)) }
      : await page(target);
    if (mine === seq) browser.set({ view, loading: "" });
    return view;
  } catch (err) {
    if (mine === seq) browser.set({ loading: "", error: errorText(err) });
    throw err;
  }
}

/** Open an address or a search as a new history entry, and show the search engine. */
export function go(input: string): Promise<View> {
  const target = toTarget(input);
  const { history, at } = browser.state;
  browser.set({ history: [...history.slice(0, at + 1), target], at: at + 1 });
  openArtifact(SEARCH);
  return load(target);
}

export function step(delta: -1 | 1) {
  const { history, at } = browser.state;
  if (!history[at + delta]) return;
  browser.set({ at: at + delta });
  load(history[at + delta]).catch(() => undefined);
}

export const reload = () => void (browser.state.history[browser.state.at] && load(browser.state.history[browser.state.at]).catch(() => undefined));

/** Read a page in Arcanus's browser. */
export async function browse(url: string): Promise<Page> {
  const view = await go(url);
  if (view.kind !== "page") throw new Error("That address didn't open a page.");
  return view.page;
}

/** Search the web in Arcanus's browser. `brief` is the page text free-search read, when it ran. */
export async function search(query: string) {
  const view = await go(`search:${query}`);
  return view.kind === "results" ? view : { results: [] as Result[], engine: "", query, brief: undefined as string | undefined };
}
