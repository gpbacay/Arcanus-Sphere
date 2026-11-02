"use client";

// The three on-device engines and their load state: ARC 1 (main thread, ~10 ms per decision), SmolVLM and Paradee
// (each in its own Web Worker). Components read state with useEngine(); nothing here runs on the server.
import { useSyncExternalStore } from "react";
import { loadBrain } from "./brain";
import { forSpeech } from "./tools";

export type LoadState = {
  status: "idle" | "loading" | "ready" | "error";
  loaded: number;
  total: number;
  device?: string;
  error?: string;
};

const IDLE: LoadState = { status: "idle", loaded: 0, total: 0 };

class Store<T> {
  private listeners = new Set<() => void>();
  constructor(public state: T) {}
  set(patch: Partial<T>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  get = () => this.state;
}

export function useEngine<T>(store: Store<T>) {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 240);

/** Start a worker and resolve once it posts "ready"; progress and errors land in `store`. */
function boot(store: Store<LoadState>, make: () => Worker, onMessage: (data: { type: string; [k: string]: unknown }) => void) {
  return new Promise<Worker>((resolve, reject) => {
    const worker = make();
    store.set({ ...IDLE, status: "loading", error: undefined });
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") store.set({ loaded: data.loaded, total: data.total });
      else if (data.type === "ready") {
        store.set({ status: "ready", device: data.device });
        resolve(worker);
      } else if (data.type === "error" && data.id == null) {
        store.set({ status: "error", error: errorText(data.message) });
        worker.terminate();
        reject(new Error(String(data.message)));
      } else onMessage(data);
    };
    worker.onerror = (event) => {
      store.set({ status: "error", error: event.message || "The worker crashed." });
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage({ type: "load" });
  });
}

// ------------------------------------------------------------------ ARC 1
export const brainState = new Store<LoadState>(IDLE);

export function startBrain() {
  if (brainState.state.status === "idle" || brainState.state.status === "error") {
    brainState.set({ status: "loading", error: undefined });
    loadBrain().then(
      () => brainState.set({ status: "ready", device: "wasm" }),
      (err) => brainState.set({ status: "error", error: errorText(err) })
    );
  }
}

// ---------------------------------------------------------------- SmolVLM
export type Turn = { role: "system" | "user" | "assistant"; content: string };
export type Written = { text: string; tokens: number; firstMs: number; perSecond: number };
type Pending = { onToken: (text: string) => void; resolve: (r: Written) => void; reject: (e: Error) => void };

class Llm {
  state = new Store<LoadState>(IDLE);
  private worker: Promise<Worker> | null = null;
  private pending = new Map<number, Pending>();
  private seq = 0;

  start() {
    this.worker ??= boot(this.state, () => new Worker(new URL("../workers/llm.worker.ts", import.meta.url), { type: "module" }), (data) => {
      const job = this.pending.get(data.id as number);
      if (!job) return;
      if (data.type === "token") job.onToken(data.text as string);
      else if (data.type === "done") job.resolve(data as never);
      else if (data.type === "error") job.reject(new Error(String(data.message)));
      if (data.type !== "token") this.pending.delete(data.id as number);
    });
    this.worker.catch(() => (this.worker = null));
    return this.worker;
  }

  async generate(turns: Turn[], image: string | undefined, onToken: (text: string) => void) {
    const worker = await this.start();
    const id = ++this.seq;
    return new Promise<Written>((resolve, reject) => {
      this.pending.set(id, { onToken, resolve, reject });
      worker.postMessage({ type: "generate", id, turns, image });
    });
  }

  stop() {
    void this.worker?.then((w) => w.postMessage({ type: "stop" }));
  }
}

// ---------------------------------------------------------------- Paradee
class Voice {
  state = new Store<LoadState & { speaking: boolean; caption: string; analyser: AnalyserNode | null }>({
    ...IDLE,
    speaking: false,
    caption: "",
    analyser: null,
  });
  private worker: Promise<Worker> | null = null;
  private ctx: AudioContext | null = null;
  private gen = 0;
  private nextAt = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private timers = new Set<number>();

  start() {
    this.worker ??= boot(this.state as unknown as Store<LoadState>, () => new Worker(new URL("../workers/tts.worker.ts", import.meta.url), { type: "module" }), (data) => {
      if (data.type === "audio" && data.gen === this.gen) this.play(data.samples as Float32Array, data.rate as number, data.text as string);
    });
    this.worker.catch(() => (this.worker = null));
    return this.worker;
  }

  /** Create or resume the AudioContext. Call from a click or key handler: browsers only allow audio after a gesture. */
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.75;
      analyser.connect(this.ctx.destination);
      this.state.set({ analyser });
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  /** Queue `text` to be spoken after whatever is already queued. */
  say(text: string) {
    const spoken = forSpeech(text);
    if (!spoken) return;
    const gen = this.gen;
    void this.start().then((w) => w.postMessage({ type: "speak", gen, text: spoken }), () => undefined);
  }

  /** Stop speaking now and drop every queued sentence. */
  cancel() {
    this.gen++;
    void this.worker?.then((w) => w.postMessage({ type: "cancel", gen: this.gen }), () => undefined);
    for (const source of this.sources) source.stop();
    this.sources.clear();
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.nextAt = 0;
    this.state.set({ speaking: false, caption: "" });
  }

  private play(samples: Float32Array, rate: number, text: string) {
    const ctx = this.ctx;
    const analyser = this.state.state.analyser;
    if (!ctx || !analyser) return;
    const buffer = ctx.createBuffer(1, samples.length, rate);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(analyser);
    const at = Math.max(ctx.currentTime + 0.03, this.nextAt);
    source.start(at);
    this.nextAt = at + buffer.duration;
    this.sources.add(source);
    this.state.set({ speaking: true });
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      this.state.set({ caption: text });
    }, (at - ctx.currentTime) * 1000);
    this.timers.add(timer);
    source.onended = () => {
      this.sources.delete(source);
      if (!this.sources.size) this.state.set({ speaking: false, caption: "" });
    };
  }
}

export const llm = new Llm();
export const voice = new Voice();
