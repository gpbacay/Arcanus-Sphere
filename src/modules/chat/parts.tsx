"use client";

import { useStore, type Engine } from "@/shared/store";

const PATHS = {
  plus: "M12 5v14M5 12h14",
  pencil: "M4 20h4L18.5 9.5a2.1 2.1 0 0 0-4-4L4 16z",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  close: "M6 6l12 12M18 6L6 18",
  send: "M5 12h14M13 6l6 6-6 6",
  stop: "M7 7h10v10H7z",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01",
  voice: "M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11",
  mute: "M4 9v6h4l5 4V5L8 9zM17 9l4 6M21 9l-4 6",
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4",
  chevron: "M6 9l6 6 6-6",
  left: "M15 6l-6 6 6 6",
  right: "M9 6l6 6-6 6",
  check: "M5 12l5 5 9-10",
};

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** One engine's load state. Each pill reads only its own engine, so progress on one never re-renders the others. */
export function EnginePill({ engine }: { engine: Engine }) {
  const state = useStore(engine.state);
  const pct = state.total ? Math.min(100, Math.round((state.loaded / state.total) * 100)) : 0;
  const label = state.off
    ? "off"
    : state.status === "ready"
      ? state.device === "webgpu" ? "WebGPU" : "ready"
      : state.status === "loading"
        ? state.total ? `${pct}%` : "starting"
        : state.status === "error"
          ? "failed"
          : "waiting";
  return (
    <div
      className="engine"
      data-status={state.off ? "off" : state.status}
      style={{ "--p": state.status === "ready" ? 1 : pct / 100 } as React.CSSProperties}
      title={state.error ?? `${engine.name} · ${engine.detail}`}
    >
      <span className="engine-name">{engine.name}</span>
      <span className="engine-detail">{engine.detail}</span>
      {state.status === "error" && !state.off ? (
        <button type="button" className="engine-retry" onClick={engine.start}>
          Retry
        </button>
      ) : (
        <span className="engine-state">{label}</span>
      )}
    </div>
  );
}
