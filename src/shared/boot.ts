// Boot order. Lives apart from store.ts so `node src/shared/boot.check.ts` can run it.

type Phase = { status: "idle" | "loading" | "ready" | "error"; off?: boolean };

export interface BootEngine {
  later?: boolean;
  state: { state: Phase };
  start(): void;
}

// ponytail: one GPU load at a time for the whole tab. Per-model locks if a second GPU ever matters.
let gpu: Promise<unknown> = Promise.resolve();

/** Run `task` after whatever WebGPU model is already loading. Two compiles at once kill the tab. */
export function afterGpu<T>(task: () => Promise<T>): Promise<T> {
  const run = gpu.then(task, task);
  gpu = run.then(() => undefined, () => undefined);
  return run;
}

/** Boot can leave this model: it is ready, it failed, it is off, or it waits until something asks for it. */
export function engineSettled(engine: BootEngine) {
  const s = engine.state.state;
  return Boolean(s.off) || s.status === "ready" || s.status === "error" || (Boolean(engine.later) && s.status === "idle");
}

/**
 * Start the models this boot needs. A model with `later` stays unloaded until something asks for it (Whisper, when
 * the mic opens, on the CPU). A WebGPU compile still waits its turn through `afterGpu`.
 * `alive` goes false when this boot was cancelled, so a model that has not started yet never does.
 */
export function bootInTurn(engines: BootEngine[], alive: () => boolean = () => true) {
  for (const engine of engines) {
    if (!alive()) return;
    if (engine.state.state.off || (engine.later && engine.state.state.status === "idle")) continue;
    if (engine.state.state.status === "idle" || engine.state.state.status === "error") engine.start();
  }
}
