"use client";

// The live side of Arcanus's browser: a real browser on this computer (src/pages/api/browser.ts), shown frame by
// frame in the search engine and driven by your mouse and keys. Where it can't run (Arcanus opened from another
// device, or no Chromium-based browser installed) pages fall back to the reader (client.ts).
import type { Page } from "@/shared/html";
import { Store } from "@/shared/store";

export const live = new Store({
  /** The newest frame, a JPEG as base64. */
  frame: "",
  url: "",
  title: "",
  back: false,
  forward: false,
  loading: false,
});

const HEADERS = { "x-arcanus": "browser", "content-type": "application/json" };
/** False once the server said the browser can't run here: the reader is used from then on. */
let usable = true;

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/browser", { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: `The browser answered ${res.status}.` }));
  if (data.unavailable) usable = false;
  if (!res.ok || data.error) throw Object.assign(new Error(data.error ?? `The browser answered ${res.status}.`), { unavailable: !!data.unavailable });
  return data as T;
}

/** Open an address in the live browser and read it once loaded. Null when the live browser can't run here. */
export async function openLive(url: string): Promise<Page | null> {
  if (!usable) return null;
  try {
    return await post<Page>({ action: "go", url });
  } catch (err) {
    if ((err as { unavailable?: boolean }).unavailable) return null;
    throw err;
  }
}

/** The page in the live browser as it is now, its text as shown. */
export const readLive = () => post<Page>({ action: "read" });
export const liveNav = (action: "back" | "forward" | "reload") => post({ action }).catch(() => undefined);
export const liveResize = (width: number, height: number, dpr: number) => post({ action: "resize", width, height, dpr }).catch(() => undefined);
/** One mouse, key or text event, as the server takes it. */
export const liveInput = (event: Record<string, unknown>) => post(event).catch(() => undefined);

// —— Watching: one stream from the server, shared by everything that shows the browser ——
let watchers = 0;
let stop: AbortController | null = null;

async function stream(signal: AbortSignal) {
  while (!signal.aborted) {
    try {
      const res = await fetch("/api/browser", { headers: HEADERS, signal });
      if (!res.ok || !res.body) return; // not on this computer: nothing to watch
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const raw of events) {
          const { event, ...data } = JSON.parse(raw.replace(/^data: /, ""));
          if (event === "frame") live.set({ frame: data.data });
          else if (event === "nav") live.set(data);
        }
      }
    } catch {
      if (signal.aborted) return;
    }
    await new Promise((r) => setTimeout(r, 1500)); // the server restarted: watch again
  }
}

/** Watch the live browser while something shows it. Returns the way to stop. */
export function watchLive() {
  if (watchers++ === 0) {
    stop = new AbortController();
    void stream(stop.signal);
  }
  return () => {
    if (--watchers === 0) stop?.abort();
  };
}
