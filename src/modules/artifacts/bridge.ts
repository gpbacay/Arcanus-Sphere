// The only ways into a sealed artifact (seal.ts). A file artifact has no network, no device and no files of its own:
// Arcanus tells it what it may see (topics, sent whenever they change) and does the few things it may ask for (calls).
// Whatever reaches the internet, writes a file or speaks to the chat is done only right after you pressed or typed
// something in the artifact (the browser's user activation), so a page can't send what it was shown anywhere by itself.
// The one exception is map tiles, and only from the tile servers, by tile number.
//
// In the artifact (seal.ts gives every page these):
//   arcanus.on(topic, (data) => …)         topics: "mind", "search", "gps"
//   await arcanus.call(name, ...args)       calls: the CALLS below
import maplibrePkg from "maplibre-gl/package.json";
import { askLocation, gps, nearPlace, placeName, recalibrate } from "@/modules/location";
import { clearMind, mind, processes } from "@/modules/mind";
import { engine, findFiles, runSearch } from "@/modules/search";
import { browser, go, reload, step } from "@/modules/web";
import { openFile, saveArtifact, shortPath, type FindOptions } from "@/modules/workspace";
import { pane, pin } from "@/shared/pane";
import { errorText } from "@/shared/store";

type Subscribable = { subscribe: (fn: () => void) => () => void };

/** What an artifact is told, each under its name, whenever one of its stores changes. */
const TOPICS: Record<string, { stores: Subscribable[]; read: () => unknown }> = {
  // Every thought, and its layout (src/modules/mind/layout.ts).
  mind: {
    stores: [mind],
    read: () => ({ thoughts: mind.state.thoughts, processes: processes(mind.state.thoughts) }),
  },
  // The search engine (modules/search) and the browser it reads the web with (modules/web), which the chat drives too.
  search: {
    stores: [engine, browser, pane],
    read: () => {
      const { query, options, scope, files, searching, web } = engine.state;
      const { view, loading, error, history, at } = browser.state;
      return {
        query,
        options,
        scope,
        searching,
        web,
        files: files && { ...files, files: files.files.map((f) => ({ ...f, short: shortPath(f.path) })) },
        browser: { view, loading, error, back: at > 0, forward: at < history.length - 1, here: at >= 0 },
        reading: pane.state.pinned?.href ?? null, // the page Arcanus reads with every message
      };
    },
  },
  // This device's position (modules/location), and the place it is in or near.
  gps: {
    stores: [gps],
    read: async () => {
      const { fix, status, error, prompting } = gps.state;
      return { fix, status, error, prompting, place: fix ? placeName(await nearPlace(fix)) : null };
    },
  },
};

const activated = () => navigator.userActivation?.isActive ?? true;
/** A call that only runs right after a press or a key in the artifact. */
const onGesture =
  <A extends unknown[], R>(fn: (...args: A) => R) =>
  (...args: A) => {
    if (!activated()) throw new Error("That needs a press or a key in the artifact first.");
    return fn(...args);
  };
const webAddress = (url: unknown) => {
  const href = String(url);
  if (!/^https?:\/\//i.test(href)) throw new Error(`${href} isn't a web address.`);
  return href;
};

// The tile servers the world map draws from, by tile number only, and the world outline Arcanus ships.
const FETCHABLE = [
  /^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/,
  /^https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/(World_Imagery|Reference\/World_Boundaries_and_Places)\/MapServer\/tile\/\d+\/\d+\/\d+$/,
  /^\/geo\/countries\.json$/,
];

/** Libraries too big to write into a page, handed in as text. MapLibre's files are copied by scripts/copy-maplibre.mjs. */
const LIBS: Record<string, string[]> = {
  maplibre: ["maplibre-gl.mjs", "maplibre-gl-worker.mjs", "maplibre-gl.css"].map((f) => `/maplibre/${maplibrePkg.version}/${f}`),
};
const libs = new Map<string, Promise<string[]>>();
function lib(name: string) {
  const paths = LIBS[name];
  if (!paths) throw new Error(`There is no library called ${name}.`);
  let texts = libs.get(name);
  if (!texts) {
    texts = Promise.all(paths.map((p) => fetch(p).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${p}: ${r.status}`))))));
    texts.catch(() => libs.delete(name));
    libs.set(name, texts);
  }
  return texts;
}

const CALLS: Record<string, (...args: never[]) => unknown> = {
  "search.set": ({ query, options, scope }: { query?: string; options?: FindOptions; scope?: "all" | "files" | "web" }) =>
    engine.set({
      ...(typeof query === "string" ? { query } : {}),
      ...(options ? { options } : {}),
      ...(scope === "all" || scope === "files" || scope === "web" ? { scope } : {}),
    }),
  "search.files": () => void findFiles(), // on this device: as you type
  "search.run": onGesture(() => runSearch()), // the web too, when ARC 1 says so
  "web.go": onGesture((target: string) => go(String(target)).then(() => undefined)),
  "web.step": (delta: number) => step(delta < 0 ? -1 : 1), // an address already visited
  "web.reload": () => reload(),
  open: onGesture((url: string) => void window.open(webAddress(url), "_blank", "noopener,noreferrer")),
  "file.open": (path: string) => openFile(String(path)).then(() => undefined),
  "file.save": onGesture((title: string, text: string) => saveArtifact(String(title), String(text))),
  "chat.pin": onGesture((page: { label: string; text: string; href: string } | null) =>
    pin(page ? { label: String(page.label), text: String(page.text), href: webAddress(page.href) } : null),
  ),
  "location.ask": () => askLocation(),
  "location.recalibrate": () => recalibrate(),
  "mind.clear": () => clearMind(),
  fetch: async (url: string) => {
    if (!FETCHABLE.some((ok) => ok.test(String(url)))) throw new Error(`${url} can't be fetched from an artifact.`);
    const res = await fetch(String(url));
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.arrayBuffer();
  },
  lib: (name: string) => lib(String(name)),
};

/** Connect a frame to Arcanus: answer its calls, and send it every topic now and whenever one changes. */
export function connect(frame: () => Window | null | undefined) {
  const post = (message: unknown, transfer: Transferable[] = []) => frame()?.postMessage(message, "*", transfer); // "*": a sealed frame has no origin to name

  const sendTopic = async (name: string) => post({ ...((await TOPICS[name].read()) as object), arcanus: name });
  const sendAll = () => Object.keys(TOPICS).forEach((name) => void sendTopic(name));

  // A reply being written changes its thought with every word: one message a frame per topic is all a page can draw.
  const queued = new Map<string, number>();
  const offs = Object.entries(TOPICS).flatMap(([name, { stores }]) =>
    stores.map((store) =>
      store.subscribe(() => {
        if (!queued.has(name)) queued.set(name, requestAnimationFrame(() => (queued.delete(name), void sendTopic(name))));
      }),
    ),
  );

  async function heard(e: MessageEvent) {
    if (!frame() || e.source !== frame()) return;
    const { arcanus, id, name, args } = e.data ?? {};
    if (arcanus === "clear-mind") return clearMind(); // the first artifacts' way of saying it
    if (arcanus !== "call") return;
    try {
      const run = Object.hasOwn(CALLS, name) ? CALLS[name] : null;
      if (!run) throw new Error(`Arcanus has no call named ${name}.`);
      const result = await (run as (...a: unknown[]) => unknown)(...(Array.isArray(args) ? args : []));
      post({ arcanus: "reply", id, result }, result instanceof ArrayBuffer ? [result] : []);
    } catch (err) {
      post({ arcanus: "reply", id, error: errorText(err) });
    }
  }
  window.addEventListener("message", heard);

  return {
    sendAll,
    off() {
      offs.forEach((off) => off());
      queued.forEach((frameId) => cancelAnimationFrame(frameId));
      window.removeEventListener("message", heard);
    },
  };
}
