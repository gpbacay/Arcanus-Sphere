// Boots the built app in a real Chrome and checks what no unit check can: signing up, the greeting, the models
// loading, a reply without the language model, a reply written by it, and conversations surviving a reload.
// Run: npm run build && npm run e2e      (add `-- --offline` to prove a boot with every outside host blocked;
//                                         run it online once first, so the models are in the profile's cache)
// It starts `next start` on port 3111 itself and drives Chrome over the DevTools protocol (Node 22 has WebSocket).
// CHROME=<path> picks the browser. The profile is kept in the temp folder, so later runs find the models cached.
// ponytail: one pass on a desktop-sized window. Live voice needs a fake microphone, and a phone layout its own run.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 3111, DEBUG = 9333, URL_ = `http://localhost:${PORT}/`;
const offline = process.argv.includes("--offline");
const chromePath =
  process.env.CHROME ??
  ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
if (!chromePath) throw new Error("Chrome not found. Set CHROME to its path.");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const started = Date.now();
const log = (...a) => console.log(`${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s`, ...a);

const server = spawn(process.execPath, [join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)], { cwd: root, stdio: "ignore" });
const chrome = spawn(
  chromePath,
  [
    // A real GPU, or software rendering starves the models and every timing is wrong.
    "--headless=new", "--enable-gpu", "--use-angle=d3d11", "--ignore-gpu-blocklist", "--no-first-run", "--window-size=1400,900",
    `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmpdir(), "arcanus-e2e-profile")}`,
    ...(offline ? ["--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost"] : []),
    "about:blank",
  ],
  { stdio: "ignore" },
);
const stop = (code) => (chrome.kill(), server.kill(), process.exit(code));

try {
  for (let i = 0; i < 60 && !(await fetch(URL_).then((r) => r.ok, () => false)); i++) await sleep(500);
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    target = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).then((l) => l.find((t) => t.type === "page"), () => null);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let seq = 0;
  const waiting = new Map();
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id) {
      waiting.get(m.id)?.(m.result ?? m);
      waiting.delete(m.id);
    } else if (m.method === "Runtime.exceptionThrown") log("page error:", m.params.exceptionDetails.exception?.description?.slice(0, 200));
  };
  const send = (method, params = {}) => new Promise((r) => (waiting.set(++seq, r), ws.send(JSON.stringify({ id: seq, method, params }))));
  const page = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;
  const text = (selector) => page(`[...document.querySelectorAll(${JSON.stringify(selector)})].at(-1)?.textContent ?? ""`);
  /** Wait until `read()` returns something truthy, and return it. */
  const until = async (what, read, seconds = 20) => {
    for (const end = Date.now() + seconds * 1000; Date.now() < end; await sleep(250)) {
      const value = await read();
      if (value) return value;
    }
    throw new Error(`Timed out after ${seconds} s waiting for ${what}`);
  };
  const click = async (selector) => {
    const [x, y] = JSON.parse(await page(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return JSON.stringify([r.x+r.width/2,r.y+r.height/2])})()`));
    for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  };
  const type = async (selector, value) => {
    await page(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await send("Input.insertText", { text: value });
  };
  const enter = () => send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: String.fromCharCode(13) });
  const ask = async (message) => {
    const before = await page(`document.querySelectorAll('.msg[data-role=assistant]:not([data-kind])').length`);
    await type(".composer textarea", message);
    await enter();
    await until(`a reply to "${message}"`, () => page(`!document.querySelector('.msg[aria-busy]') && document.querySelectorAll('.msg[data-role=assistant]:not([data-kind])').length > ${before}`), 180);
    return { reply: await text(".msg[data-role=assistant]:not([data-kind]) .msg-bubble"), trace: await text(".msg[data-role=assistant]:not([data-kind]) .msg-trace") };
  };

  await send("Runtime.enable");
  await send("Page.enable");
  // A clean slate for accounts and conversations; the model caches (Cache Storage) are kept.
  await send("Storage.clearDataForOrigin", { origin: URL_.slice(0, -1), storageTypes: "local_storage,indexeddb,file_systems" });
  await send("Page.navigate", { url: URL_ });

  // Signing in: a wrong password is refused, a new account is let in.
  await until("the sign-in form", () => page(`!!document.querySelector('.signin-pane')`));
  await type(".signin-pane input", "e2e-tester");
  await type(".signin-pane input[type=password]", "not-my-password");
  await click(".signin-pane .btn-primary");
  await until("the wrong password to be refused", async () => /incorrect/.test(await text(".signin-error")));
  await click(".signin-switch button");
  await type(".signin-pane input[type=password]", "-and-more"); // "not-my-password-and-more": the same field, now a new password
  await click(".signin-pane .btn-primary");
  const signedIn = Date.now();
  const since = () => `${((Date.now() - signedIn) / 1000).toFixed(1)} s after signing in`;

  // The greeting waits for no model.
  const greeting = await until("the greeting", () => text(".msg[data-kind=boot] .msg-bubble"), 5);
  if (!/I'm Arcanus/.test(greeting)) throw new Error(`Not a greeting: ${greeting}`);
  log(`greeting ${since()}: ${greeting}`);

  // The models: a first run downloads them unless `npm run models` put them on this server.
  const boot = await until("the models to load", async () => ((await text(".msg[data-kind=boot] .msg-trace button")).startsWith("Boot log") ? text(".msg[data-kind=boot] .msg-trace button") : ""), offline ? 60 : 900);
  if (!/3\/4 ready/.test(boot)) throw new Error(`A model failed: ${boot} · ${await text(".msg[data-kind=boot] .msg-trace")}`);
  log(`models ready ${since()}: ${boot}`);

  // Answered without the language model, and right.
  const sum = await ask("What's (12 + 8) * 3?");
  if (!/\b60\b/.test(sum.reply)) throw new Error(`Wrong sum: ${sum.reply}`);
  log("math:", sum.reply);

  // Written by SmolLM2.
  const written = await ask("Why is the sky blue?");
  const speed = written.trace.match(/First word in [\d.]+ s[^·]*· \d+ tokens at [\d.]+ tok\/s/)?.[0];
  if (!written.reply.trim() || !speed) throw new Error(`SmolLM2 didn't write a reply: ${JSON.stringify(written)}`);
  log(`SmolLM2: ${speed}\n        ${written.reply.replace(/\s+/g, " ").slice(0, 200)}`);

  // A reload keeps the account signed in and its conversation saved.
  await sleep(800); // the save is batched
  await send("Page.reload");
  await until("the conversation after a reload", async () => /\b60\b/.test(await page(`document.querySelector('.thread')?.textContent ?? ""`)), 20);
  log("reload: still signed in, conversation kept");

  console.log(`e2e ok${offline ? " (offline)" : ""}`);
  stop(0);
} catch (err) {
  console.error(`e2e FAILED: ${err instanceof Error ? err.message : err}`);
  stop(1);
}
