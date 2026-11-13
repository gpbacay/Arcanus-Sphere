// Arcanus's hands on this computer: device specs, launching installed apps, and open computer use (an MIT, offline
// computer-use MCP server driven through the OS accessibility layer: UI Automation on Windows, AX on macOS, AT-SPI on
// Linux). Nothing here touches the network.
//   GET  /api/device                      -> Specs
//   POST /api/device { open, exact? }     -> { opened }       (an installed app, by name)
//   POST /api/device { url }              -> { opened }       (an http(s) address, in this machine's browser)
//   POST /api/device { tool, args }       -> { text, error? } (one open computer use tool call)
//
// A pages/ API route, not app/: it is the router that hands over the real socket, and only a request from this
// machine may drive it. Host and x-arcanus are checked too: a site in the user's browser can't send that header
// without a CORS preflight this route never answers, and DNS rebinding arrives with a foreign Host.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, statfsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { NextApiRequest, NextApiResponse } from "next";
// eslint-disable-next-line no-restricted-imports -- the public API also carries the browser client; the server needs only this pure part
import { matchApp, type App, type Specs } from "@/modules/device/command";
import { fromThisMachine } from "@/shared/loopback";

const TOOLS = new Set(["list_apps", "get_app_state", "click", "perform_secondary_action", "scroll", "drag", "type_text", "press_key", "set_value"]);

// ------------------------------------------------------------------ specs

function specs(): Specs {
  const cpus = os.cpus();
  let name = os.version();
  if (process.platform === "win32" && Number(os.release().split(".")[2]) >= 22000) name = name.replace("Windows 10", "Windows 11"); // the registry still says 10
  const roots = process.platform === "win32" ? "CDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => `${l}:\\`).filter((r) => existsSync(r)) : ["/"];
  const disks = roots.flatMap((root) => {
    try {
      const s = statfsSync(root);
      return s.blocks ? [{ path: root.replace(/\\$/, ""), total: s.blocks * s.bsize, free: s.bavail * s.bsize }] : [];
    } catch {
      return [];
    }
  });
  return {
    host: os.hostname(),
    user: os.userInfo().username,
    os: { name, release: os.release(), arch: os.arch() },
    cpu: { model: cpus[0]?.model.trim() ?? "unknown", cores: cpus.length },
    memory: { total: os.totalmem(), free: os.freemem() },
    disks,
    uptime: os.uptime(),
  };
}

// ------------------------------------------------------------------ installed apps

let appCache: { at: number; apps: App[] } | null = null;

/** Start-menu apps on Windows (desktop and Store apps alike), /Applications on macOS, .desktop entries on Linux. */
async function installedApps(): Promise<App[]> {
  if (appCache && Date.now() - appCache.at < 5 * 60_000) return appCache.apps;
  let apps: App[] = [];
  if (process.platform === "win32") {
    const out = await new Promise<string>((resolve) =>
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress"], { windowsHide: true, timeout: 20_000, maxBuffer: 8_000_000 }, (_err, stdout) => resolve(stdout ?? "")),
    );
    const parsed: unknown = JSON.parse(out.trim() || "[]");
    apps = (Array.isArray(parsed) ? parsed : [parsed]).flatMap((a: { Name?: string; AppID?: string }) => (a?.Name && a.AppID ? [{ name: a.Name, id: a.AppID }] : []));
  } else {
    const dirs = process.platform === "darwin" ? ["/Applications", "/System/Applications", path.join(os.homedir(), "Applications")] : ["/usr/share/applications", path.join(os.homedir(), ".local/share/applications")];
    const ext = process.platform === "darwin" ? ".app" : ".desktop";
    for (const dir of dirs) {
      try {
        for (const f of readdirSync(dir)) if (f.endsWith(ext)) apps.push({ name: f.slice(0, -ext.length), id: f.slice(0, -ext.length) });
      } catch {}
    }
  }
  appCache = { at: Date.now(), apps };
  return apps;
}

/** Launch an installed app. Its id comes from the system's own list, and goes in as one argument, never a shell string. */
function launch(app: App) {
  const [cmd, args] =
    process.platform === "win32" ? ["explorer.exe", [`shell:AppsFolder\\${app.id}`]] : process.platform === "darwin" ? ["open", ["-a", app.id]] : ["gtk-launch", [app.id]];
  spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }).on("error", () => undefined).unref();
}

// ------------------------------------------------------------------ open computer use, one long-lived process

type Reply = { result?: { content?: { type: string; text?: string }[]; isError?: boolean }; error?: { message?: string } };
type Peer = { child: ChildProcess; pending: Map<number, (r: Reply) => void>; next: number; ready: Promise<Reply> };

const NATIVE: Record<string, string[]> = {
  "win32-x64": ["dist", "windows", "amd64", "open-computer-use.exe"],
  "win32-arm64": ["dist", "windows", "arm64", "open-computer-use.exe"],
  "linux-x64": ["dist", "linux", "amd64", "open-computer-use"],
  "linux-arm64": ["dist", "linux", "arm64", "open-computer-use"],
  "darwin-x64": ["dist", "Open Computer Use.app", "Contents", "MacOS", "OpenComputerUse"],
  "darwin-arm64": ["dist", "Open Computer Use.app", "Contents", "MacOS", "OpenComputerUse"],
};

// Kept on globalThis so a dev reload doesn't start a second one. Element indexes live in this process's memory, so
// it must stay the same process between "look at Notepad" and "click Save".
const g = globalThis as { __arcanusOcu?: Peer };

function send(peer: Peer, method: string, params: unknown, ms = 30_000): Promise<Reply> {
  return new Promise((resolve) => {
    const id = ++peer.next;
    const timer = setTimeout(() => {
      peer.pending.delete(id);
      resolve({ error: { message: "Computer use took too long to answer." } });
    }, ms);
    peer.pending.set(id, (r) => {
      clearTimeout(timer);
      resolve(r);
    });
    peer.child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

function computer(): Peer {
  const live = g.__arcanusOcu;
  if (live && live.child.exitCode === null && !live.child.killed) return live;
  const native = NATIVE[`${process.platform}-${process.arch}`];
  const exe = native && path.join(process.cwd(), "node_modules", "open-computer-use", ...native);
  if (!exe || !existsSync(exe)) throw new Error(`Computer use isn't installed for ${process.platform}-${process.arch}. Run npm install.`);
  // Global input lets keys and typing reach apps that ignore posted window messages (Calculator, new Notepad). It
  // needs the app in front, so focus actions come with it: Arcanus brings the app forward, and may move the real
  // pointer. Set ARCANUS_GLOBAL_INPUT=0 to keep computer use in the background.
  const global = process.env.ARCANUS_GLOBAL_INPUT === "0" ? "0" : "1";
  const env = { ...process.env, OPEN_COMPUTER_USE_ALLOW_GLOBAL_POINTER_FALLBACKS: global, OPEN_COMPUTER_USE_WINDOWS_ALLOW_FOCUS_ACTIONS: global };
  const child = spawn(exe, ["mcp"], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true, env });
  const peer: Peer = { child, pending: new Map(), next: 0, ready: Promise.resolve({}) };
  const fail = () => {
    for (const done of peer.pending.values()) done({ error: { message: "Computer use stopped." } });
    peer.pending.clear();
    if (g.__arcanusOcu === peer) g.__arcanusOcu = undefined;
  };
  child.on("exit", fail).on("error", fail);
  child.stdin?.on("error", () => undefined);
  createInterface({ input: child.stdout! }).on("line", (line) => {
    let msg: Reply & { id?: number };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof msg.id !== "number") return;
    peer.pending.get(msg.id)?.(msg);
    peer.pending.delete(msg.id);
  });
  peer.ready = send(peer, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "Arcanus", version: "0.1.0" } }).then((r) => {
    child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    return r;
  });
  g.__arcanusOcu = peer;
  return peer;
}

async function callComputer(tool: string, args: Record<string, unknown>) {
  const peer = computer();
  const init = await peer.ready;
  if (init.error) throw new Error(init.error.message ?? "Computer use didn't start.");
  const r = await send(peer, "tools/call", { name: tool, arguments: args });
  if (r.error) return { text: "", error: r.error.message ?? `${tool} failed.` };
  // Screenshots are dropped: Arcanus reads the accessibility tree, and a PNG would only weigh the reply down.
  const text = (r.result?.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").trim();
  return r.result?.isError ? { text: "", error: text || `${tool} failed.` } : { text };
}

// ------------------------------------------------------------------ the route

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!fromThisMachine(req, "device")) return res.status(403).json({ error: "Device control works only in Arcanus opened at localhost on this computer." });
  try {
    if (req.method === "GET") return res.json(specs());
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST." });
    const body = (req.body ?? {}) as { open?: unknown; exact?: unknown; url?: unknown; tool?: unknown; args?: unknown };
    if (typeof body.url === "string") {
      const url = new URL(body.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") return res.status(400).json({ error: "Only http and https addresses open." });
      // The address is one argument, never a shell string.
      const child = process.platform === "win32"
        ? spawn("rundll32", ["url.dll,FileProtocolHandler", url.href], { detached: true, stdio: "ignore", windowsHide: true })
        : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url.href], { detached: true, stdio: "ignore" });
      child.unref();
      return res.json({ opened: url.href });
    }
    if (typeof body.open === "string" && body.open.trim()) {
      const app = matchApp(await installedApps(), body.open, body.exact === true);
      if (!app) return res.status(404).json({ error: `No installed app called "${body.open}".` });
      launch(app);
      return res.json({ opened: app.name });
    }
    if (typeof body.tool === "string" && TOOLS.has(body.tool)) {
      const args = body.args && typeof body.args === "object" ? (body.args as Record<string, unknown>) : {};
      return res.json(await callComputer(body.tool, args));
    }
    return res.status(400).json({ error: "Send { open } or { tool, args }." });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
