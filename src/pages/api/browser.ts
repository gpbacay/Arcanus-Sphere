// Arcanus's own web browser: a real Chromium-based browser on this computer, without a window, driven over the
// Chrome DevTools Protocol (CDP) with Node's own WebSocket. No dependency and no download: it uses a browser already
// installed (Chromium, Brave, Chrome or Edge; ARCANUS_BROWSER names another), started the first time a page is opened.
// The search engine artifact shows it live, frame by frame (CDP screencast), and sends your mouse and keys back.
//   GET  /api/browser                                   -> an event stream: { frame } and { nav } (while you watch)
//   POST /api/browser { action: "go", url }             -> Page { url, title, text } once it has loaded (see address())
//   POST /api/browser { action: "back" | "forward" | "reload" }
//   POST /api/browser { action: "read" }                -> Page: the page as it is now, its text as shown
//   POST /api/browser { action: "resize", width, height, dpr }
//   POST /api/browser { action: "mouse" | "key" | "text", ... }   one input event (only the fields listed below)
//
// Only this machine may drive it (shared/loopback.ts). The browser keeps its own profile (logins, cookies) in
// ~/.arcanus-browser, apart from yours.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { NextApiRequest, NextApiResponse } from "next";
// eslint-disable-next-line no-restricted-imports -- the public API also carries the browser client; the server needs only this pure part
import { diskParts, sourceParts } from "@/modules/workspace/command";
import { fromThisMachine } from "@/shared/loopback";

export const config = { api: { responseLimit: false } };

type Json = Record<string, unknown>;
type Cdp = { send: (method: string, params?: Json) => Promise<Json>; on: (method: string, fn: (params: Json) => void) => void };
type Size = { width: number; height: number; dpr: number };
/** `closed`: the browser exited or its connection dropped; the next request starts it again. */
type Session = { chrome: ChildProcess; page: Cdp; loading: boolean; closed: boolean; loaded?: () => void };
type Watcher = (event: "frame" | "nav", data: Json) => void;

const PROFILE = path.join(os.homedir(), ".arcanus-browser");
const LOCAL = process.env.LOCALAPPDATA ?? "";
const PROGRAMS = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"]].filter(Boolean) as string[];
/** Chromium first: the open one. Then the other Chromium-based browsers people have. */
const CANDIDATES =
  process.platform === "win32"
    ? [
        path.join(LOCAL, "Chromium", "Application", "chrome.exe"),
        ...PROGRAMS.map((p) => path.join(p, "Chromium", "Application", "chrome.exe")),
        ...[LOCAL, ...PROGRAMS].map((p) => path.join(p, "BraveSoftware", "Brave-Browser", "Application", "brave.exe")),
        ...[LOCAL, ...PROGRAMS].map((p) => path.join(p, "Google", "Chrome", "Application", "chrome.exe")),
        ...PROGRAMS.map((p) => path.join(p, "Microsoft", "Edge", "Application", "msedge.exe")),
      ]
    : process.platform === "darwin"
      ? ["Chromium", "Brave Browser", "Google Chrome", "Microsoft Edge"].map((app) => `/Applications/${app}.app/Contents/MacOS/${app}`)
      : ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium", "/usr/bin/brave-browser", "/usr/bin/google-chrome", "/usr/bin/microsoft-edge"];

// Links that would open a new tab or window open here instead: this browser shows one page.
// ponytail: one tab. Tabs would need Target.* and a tab strip in the artifact.
const ONE_TAB = `document.addEventListener("click", (e) => { const a = e.target.closest && e.target.closest("a[target]"); if (a) a.target = "_self"; }, true);
window.open = (url) => { if (url) location.href = url; return null; };`;

// Kept on globalThis: a dev server reloading this file must not lose the browser it started (or start a second one).
const state = globalThis as typeof globalThis & { arcanusBrowser?: { session: Promise<Session> | null; watchers: Set<Watcher>; size: Size } };
const shared = (state.arcanusBrowser ??= { session: null, watchers: new Set(), size: { width: 1024, height: 700, dpr: 1 } });

class Unavailable extends Error {}

/** `promise`, or a failure after `ms`: a browser that stops answering must not hold every request forever. */
function within<T>(promise: Promise<T>, ms: number, what: string) {
  return new Promise<T>((ok, fail) => {
    const timer = setTimeout(() => fail(new Unavailable(`${what} took too long.`)), ms);
    promise.then(ok, fail).finally(() => clearTimeout(timer));
  });
}

function connect(url: string, onClose: () => void): Promise<Cdp> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let seq = 0;
    const waiting = new Map<number, { ok: (r: Json) => void; fail: (e: Error) => void }>();
    const handlers = new Map<string, ((p: Json) => void)[]>();
    ws.onmessage = ({ data }) => {
      const m = JSON.parse(String(data));
      if (m.id) {
        const w = waiting.get(m.id);
        waiting.delete(m.id);
        if (m.error) w?.fail(new Error(m.error.message));
        else w?.ok(m.result ?? {});
      } else handlers.get(m.method)?.forEach((fn) => fn(m.params ?? {}));
    };
    ws.onerror = () => reject(new Unavailable("The browser's debugging connection failed."));
    ws.onclose = () => {
      waiting.forEach((w) => w.fail(new Error("The browser closed.")));
      onClose();
    };
    ws.onopen = () =>
      resolve({
        send: (method, params = {}) =>
          within(
            new Promise((ok, fail) => {
              waiting.set(++seq, { ok, fail });
              ws.send(JSON.stringify({ id: seq, method, params }));
            }),
            20_000,
            method,
          ),
        on: (method, fn) => handlers.set(method, [...(handlers.get(method) ?? []), fn]),
      });
  });
}

const broadcast: Watcher = (event, data) => shared.watchers.forEach((w) => w(event, data));

/** A page written out whole has its whole text for an address: it shows as data:text/html. */
const short = (url: string) => (url.startsWith("data:") ? "data:text/html" : url);

async function navState(s: Session): Promise<Json> {
  const { entries, currentIndex } = (await s.page.send("Page.getNavigationHistory")) as { entries: { url: string; title: string }[]; currentIndex: number };
  const here = entries[currentIndex];
  return { url: short(here?.url ?? ""), title: here?.title ?? "", back: currentIndex > 0, forward: currentIndex < entries.length - 1, loading: s.loading };
}

async function cast(s: Session) {
  await s.page.send("Page.stopScreencast").catch(() => undefined);
  if (!shared.watchers.size) return;
  const { width, height, dpr } = shared.size;
  await s.page.send("Page.startScreencast", { format: "jpeg", quality: 72, maxWidth: Math.round(width * dpr), maxHeight: Math.round(height * dpr) });
}

async function resize(s: Session) {
  const { width, height, dpr } = shared.size;
  await s.page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
  await cast(s);
}

async function launch(): Promise<Session> {
  const exe = [process.env.ARCANUS_BROWSER, ...CANDIDATES].find((p) => p && existsSync(p));
  if (!exe) throw new Unavailable("No Chromium-based browser is installed. Install Chromium (free and open source), or set ARCANUS_BROWSER to one.");
  const portFile = path.join(PROFILE, "DevToolsActivePort");
  rmSync(portFile, { force: true });
  const chrome = spawn(
    exe,
    ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "--disable-features=Translate", "about:blank"],
    { stdio: "ignore", windowsHide: true },
  );
  process.once("exit", () => chrome.kill());

  let port = "";
  for (let i = 0; i < 150 && !port; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (chrome.exitCode !== null) throw new Unavailable(`The browser (${path.basename(exe)}) closed as it started.`);
    if (existsSync(portFile)) port = readFileSync(portFile, "utf8").split("\n")[0].trim();
  }
  if (!port) throw new Unavailable("The browser didn't open its debugging port.");
  const targets = (await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())) as { type: string; webSocketDebuggerUrl: string }[];
  const target = targets.find((t) => t.type === "page");
  if (!target) throw new Unavailable("The browser has no page to show.");

  // eslint-disable-next-line prefer-const -- the connection's close handler needs the session it belongs to
  let s: Session;
  const page = await connect(target.webSocketDebuggerUrl, () => s && (s.closed = true));
  s = { chrome, page, loading: false, closed: false };
  chrome.once("exit", () => (s.closed = true));
  await Promise.all([page.send("Page.enable"), page.send("Runtime.enable")]);
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: ONE_TAB });
  const { frameTree } = (await page.send("Page.getFrameTree")) as { frameTree: { frame: { id: string } } };
  const mainFrame = frameTree.frame.id;
  page.on("Page.loadEventFired", () => s.loaded?.());
  page.on("Page.screencastFrame", ({ data, sessionId }) => {
    void page.send("Page.screencastFrameAck", { sessionId }).catch(() => undefined);
    broadcast("frame", { data });
  });
  page.on("Page.javascriptDialogOpening", () => void page.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => undefined));
  const tell = () => void navState(s).then((nav) => broadcast("nav", nav), () => undefined);
  page.on("Page.frameStartedLoading", ({ frameId }) => frameId === mainFrame && ((s.loading = true), tell()));
  page.on("Page.frameStoppedLoading", ({ frameId }) => frameId === mainFrame && ((s.loading = false), tell()));
  page.on("Page.frameNavigated", ({ frame }) => !(frame as Json).parentId && tell());
  page.on("Page.navigatedWithinDocument", tell);
  await resize(s);
  return s;
}

/** The browser that is running, if one is and it still answers. */
const current = async () => (shared.session ? await within(shared.session, 30_000, "The browser").catch(() => null) : null);

/** The running browser, started (again) when there is none or it closed. */
async function session(): Promise<Session> {
  const running = await current();
  if (running && !running.closed) return running;
  running?.chrome.kill();
  shared.session = within(launch(), 30_000, "Starting the browser");
  shared.session.catch(() => (shared.session = null));
  return shared.session;
}

const READ = `({ url: location.protocol === "data:" ? "data:text/html" : location.href, title: document.title || location.hostname, text: (document.body ? document.body.innerText : "").slice(0, 30000) })`;
async function read(s: Session) {
  const { result } = (await s.page.send("Runtime.evaluate", { expression: READ, returnByValue: true })) as { result: { value: Json } };
  return result.value;
}

/** A web address; an HTML page written out whole (data:text/html,…); or file:<path>, a file of Arcanus's source, as the
 *  file:/// address it has on this disk, so its own css, scripts and images load beside it; disk:<path>, the same for a
 *  file on This PC ("C:/Users/me/page.html"). */
function address(url: string) {
  if (/^https?:\/\/|^data:text\/html[;,]/i.test(url)) return url;
  if (url.startsWith("file:")) return pathToFileURL(path.join(process.cwd(), ...sourceParts(url.slice(5)))).href;
  if (url.startsWith("disk:")) return pathToFileURL(path.join(...diskParts(url.slice(5)))).href; // a file on This PC
  throw new Error(`${url.slice(0, 200)} isn't a web address.`);
}

async function go(s: Session, target: string) {
  const url = address(target);
  const loaded = new Promise<void>((done) => {
    s.loaded = done;
    setTimeout(done, 15_000); // a page that never finishes loading is read as it is
  });
  const { errorText, loaderId } = (await s.page.send("Page.navigate", { url })) as { errorText?: string; loaderId?: string };
  if (errorText) throw new Error(`${url} didn't open (${errorText}).`);
  if (loaderId) await loaded; // no loader: the same page, moved to an anchor
  return read(s);
}

async function step(s: Session, delta: -1 | 1) {
  const { entries, currentIndex } = (await s.page.send("Page.getNavigationHistory")) as { entries: { id: number }[]; currentIndex: number };
  const to = entries[currentIndex + delta];
  if (to) await s.page.send("Page.navigateToHistoryEntry", { entryId: to.id });
}

const num = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const MOUSE = new Set(["mousePressed", "mouseReleased", "mouseMoved", "mouseWheel"]);
const KEY = new Set(["keyDown", "keyUp", "rawKeyDown", "char"]);
const BUTTONS = new Set(["none", "left", "middle", "right"]);

async function input(s: Session, body: Json) {
  if (body.action === "text") return s.page.send("Input.insertText", { text: String(body.text ?? "") });
  if (body.action === "mouse" && MOUSE.has(String(body.type))) {
    return s.page.send("Input.dispatchMouseEvent", {
      type: body.type,
      x: num(body.x),
      y: num(body.y),
      button: BUTTONS.has(String(body.button)) ? body.button : "none",
      buttons: num(body.buttons),
      clickCount: num(body.clickCount),
      deltaX: num(body.deltaX),
      deltaY: num(body.deltaY),
      modifiers: num(body.modifiers),
    });
  }
  if (body.action === "key" && KEY.has(String(body.type))) {
    const text = str(body.text);
    return s.page.send("Input.dispatchKeyEvent", {
      type: body.type,
      key: str(body.key),
      code: str(body.code),
      windowsVirtualKeyCode: num(body.keyCode),
      nativeVirtualKeyCode: num(body.keyCode),
      modifiers: num(body.modifiers),
      ...(text ? { text, unmodifiedText: text } : {}),
    });
  }
  throw new Error("That isn't an input this browser takes.");
}

function watch(req: NextApiRequest, res: NextApiResponse) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "content-encoding": "none", connection: "keep-alive" });
  const watcher: Watcher = (event, data) => res.write(`data: ${JSON.stringify({ event, ...data })}\n\n`);
  shared.watchers.add(watcher);
  res.write(`data: ${JSON.stringify({ event: "hello" })}\n\n`);
  // Watching doesn't start the browser; a running one starts sending frames, and says where it is.
  void shared.session?.then(async (s) => (shared.watchers.size === 1 && (await cast(s)), watcher("nav", await navState(s))), () => undefined);
  req.on("close", () => {
    shared.watchers.delete(watcher);
    if (!shared.watchers.size) void shared.session?.then((s) => s.page.send("Page.stopScreencast"), () => undefined).catch(() => undefined);
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!fromThisMachine(req, "browser")) return res.status(403).json({ error: "Arcanus's browser works only in Arcanus opened at localhost on this computer.", unavailable: true });
  if (req.method === "GET") return watch(req, res);
  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST." });
  const body = (req.body ?? {}) as Json;
  try {
    if (body.action === "resize") {
      shared.size = { width: Math.min(4096, Math.max(200, Math.round(num(body.width, 1024)))), height: Math.min(4096, Math.max(150, Math.round(num(body.height, 700)))), dpr: Math.min(3, Math.max(1, num(body.dpr, 1))) };
      const running = await current();
      if (running && !running.closed) await resize(running);
      return res.json({});
    }
    if (!shared.session && body.action !== "go") return res.json({}); // nothing open yet: nothing to act on
    const s = await session();
    if (body.action === "go") return res.json(await go(s, String(body.url ?? "")));
    if (body.action === "read") return res.json(await read(s));
    if (body.action === "back" || body.action === "forward") return res.json(await step(s, body.action === "back" ? -1 : 1).then(() => ({})));
    if (body.action === "reload") return res.json(await s.page.send("Page.reload").then(() => ({})));
    await input(s, body);
    return res.json({});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(err instanceof Unavailable ? 503 : 400).json({ error: message, unavailable: err instanceof Unavailable });
  }
}
