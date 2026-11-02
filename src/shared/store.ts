// The shared kernel's state primitive. Every module keeps state that lives outside React (engine load progress,
// conversations, the reply being written) in a Store, and components read it with useStore().
import { useSyncExternalStore } from "react";

export class Store<T> {
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

/**
 * Read a store from a component. With `select`, the component re-renders only when the selected value changes, so a
 * streamed token re-renders the reply being written and nothing else. `select` must return a primitive or a value
 * already in the state, never a new object.
 */
export function useStore<T, S = T>(store: Store<T>, select: (state: T) => S = (state) => state as unknown as S) {
  const read = () => select(store.state);
  return useSyncExternalStore(store.subscribe, read, read);
}

// ------------------------------------------------------------------ engines

export type LoadState = {
  status: "idle" | "loading" | "ready" | "error";
  loaded: number;
  total: number;
  device?: string;
  error?: string;
  /** Switched off by the user: not started, shown as off. */
  off?: boolean;
};

export const IDLE: LoadState = { status: "idle", loaded: 0, total: 0 };

/** An on-device model a module owns. The app boots each one on its own, so one failing never holds up the rest. */
export interface Engine {
  name: string;
  detail: string;
  state: Store<LoadState>;
  /** Start loading. Safe to call again, and the way to retry after an error. */
  start(): void;
}

export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 240);

/** Start a worker and resolve once it posts "ready"; progress and errors land in `store`. */
export function startWorker(store: Store<LoadState>, make: () => Worker, onMessage: (data: { type: string; [k: string]: unknown }) => void) {
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
