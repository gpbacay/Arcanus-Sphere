// free-search-mcp (https://github.com/sweetcornna/free-search-mcp) over stdio.
// The browser can't speak stdio, so the relay owns one process. ponytail: one global process, no pool;
// if uvx isn't installed the relay keeps its DuckDuckGo fetch.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

type CallResult = { content?: { text?: string }[]; isError?: boolean };

class FreeSearch {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buf = "";
  private id = 0;
  private pending = new Map<number, Pending>();
  private ready: Promise<void> | null = null;
  private starting: Promise<void> | null = null;
  private connected = false;

  private fail(error: Error) {
    this.ready = null;
    this.starting = null;
    this.connected = false;
    this.child = null;
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }

  /** Resolves once the process is running. Rejects immediately when uvx isn't there. */
  private start() {
    if (this.child && this.child.exitCode == null && !this.child.killed) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      const bin = process.env.FREE_SEARCH_BIN || "uvx";
      const args = process.env.FREE_SEARCH_BIN ? [] : ["free-search-mcp"];
      const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      this.child = child;
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => this.onData(chunk));
      child.stderr.on("data", () => undefined);
      child.once("spawn", () => resolve());
      child.on("error", (err) => {
        reject(err);
        if (this.child === child) this.fail(err);
      });
      child.on("exit", () => {
        if (this.child === child) this.fail(new Error("free-search stopped"));
      });
    });
    return this.starting;
  }

  private onData(chunk: string) {
    this.buf += chunk;
    for (;;) {
      const nl = this.buf.indexOf("\n");
      if (nl < 0) break;
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line.startsWith("{")) continue;
      let msg: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof msg.id !== "number") continue;
      const waiter = this.pending.get(msg.id);
      if (!waiter) continue;
      this.pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(msg.error.message || "free-search error"));
      else waiter.resolve(msg.result);
    }
  }

  private async rpc(method: string, params: unknown, timeout: number): Promise<unknown> {
    await this.start();
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("free-search timed out"));
      }, timeout);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.child?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  private init() {
    this.ready ??= (async () => {
      await this.rpc("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "Arcanus", version: "0.1.0" },
      }, 120_000);
      this.child?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
      this.connected = true;
    })().catch((err: unknown) => {
      this.ready = null;
      throw err;
    });
    return this.ready;
  }

  private async call(name: string, args: Record<string, unknown>, timeout: number): Promise<string> {
    await this.init();
    const result = (await this.rpc("tools/call", { name, arguments: args }, timeout)) as CallResult;
    const text = (result.content ?? []).map((part) => part.text ?? "").join("\n").trim();
    if (!text || result.isError) throw new Error(text || `${name} returned nothing`);
    return text;
  }

  /** A short research brief: sources plus the text of the top pages. */
  research(question: string) {
    return this.call("research", { question, depth: 2 }, 45_000);
  }

  /** One page as Markdown. Skipped until a search has connected, so a link doesn't wait on the first install. */
  fetch(url: string) {
    if (!this.connected) throw new Error("free-search is not connected yet");
    return this.call("fetch", { url }, 20_000);
  }
}

const slot = globalThis as typeof globalThis & { __freeSearch?: FreeSearch };

export const freeSearch = () => (slot.__freeSearch ??= new FreeSearch());
