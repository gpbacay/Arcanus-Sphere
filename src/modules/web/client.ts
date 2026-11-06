"use client";

// Arcanus's browser: history, the page or results in view, and the calls to the relay (src/app/api/web). The chat's
// web skill drives the same browser, so what Arcanus reads is what the Browser pane shows.
import type { Page, Result } from "@/shared/html";
import { openPane } from "@/shared/pane";
import { Store, errorText } from "@/shared/store";

export type View = { kind: "page"; page: Page } | { kind: "results"; query: string; results: Result[]; engine: string };

export const browser = new Store({
  view: null as View | null,
  /** The address or search being loaded, if any. */
  loading: "",
  error: "",
  /** Addresses, and searches as "search:<words>". */
  history: [] as string[],
  at: -1,
});

/** "example.com/x" or "https://…" is an address; anything else is a search. */
export function toTarget(input: string): string {
  const text = input.trim();
  if (/^search:/.test(text) || /^https?:\/\//i.test(text)) return text;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(text)) return `https://${text}`;
  return `search:${text}`;
}

async function relay<T>(params: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/web?${params}`);
  } catch {
    throw new Error("No connection to the internet.");
  }
  const data = await res.json().catch(() => ({ error: `The browser relay answered ${res.status}.` }));
  if (!res.ok || data.error) throw new Error(data.error ?? `The browser relay answered ${res.status}.`);
  return data as T;
}

let seq = 0;
async function load(target: string): Promise<View> {
  const mine = ++seq;
  browser.set({ loading: target, error: "" });
  try {
    const query = target.startsWith("search:") ? target.slice(7) : "";
    const view: View = query
      ? { kind: "results", query, ...(await relay<{ results: Result[]; engine: string }>(`q=${encodeURIComponent(query)}`)) }
      : { kind: "page", page: await relay<Page>(`url=${encodeURIComponent(target)}`) };
    if (mine === seq) browser.set({ view, loading: "" });
    return view;
  } catch (err) {
    if (mine === seq) browser.set({ loading: "", error: errorText(err) });
    throw err;
  }
}

/** Open an address or a search as a new history entry, and show the Browser pane. */
export function go(input: string): Promise<View> {
  const target = toTarget(input);
  const { history, at } = browser.state;
  browser.set({ history: [...history.slice(0, at + 1), target], at: at + 1 });
  openPane("browser");
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

/** Search the web in Arcanus's browser. */
export async function search(query: string) {
  const view = await go(`search:${query}`);
  return view.kind === "results" ? view : { results: [], engine: "", query };
}
