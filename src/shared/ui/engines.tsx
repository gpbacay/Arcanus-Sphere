"use client";

import { Power } from "lucide-react";
import { power, setPower } from "@/shared/power";
import { useStore, type Engine } from "@/shared/store";

/** One on-device model's load state. Each pill reads only its own engine, so progress on one never re-renders the others. */
export function EnginePill({ engine }: { engine: Engine }) {
  const state = useStore(engine.state);
  const pct = state.total ? Math.min(100, Math.round((state.loaded / state.total) * 100)) : 0;
  const status = state.off ? "off" : state.status;
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
      data-status={status}
      style={{ "--p": state.status === "ready" ? 1 : pct / 100 } as React.CSSProperties}
      title={state.error ?? `${engine.name} · ${engine.detail}`}
    >
      <span className="engine-dot" aria-hidden />
      <span className="engine-name">{engine.name}</span>
      {state.status === "error" && !state.off ? (
        <button type="button" className="engine-retry" onClick={engine.start}>
          Retry
        </button>
      ) : (
        <span className="engine-state">{label}</span>
      )}
      <span className="engine-detail">{engine.detail}</span>
    </div>
  );
}

/** Arcanus's on/off switch. */
function PowerButton() {
  const on = useStore(power, (s) => s.on);
  const changing = useStore(power, (s) => s.changing);
  return (
    <button
      type="button"
      className="power"
      data-on={on || undefined}
      data-changing={changing || undefined}
      aria-pressed={on}
      aria-label={on ? "Turn Arcanus off" : "Turn Arcanus on"}
      title={on ? "Turn Arcanus off" : "Turn Arcanus on"}
      onClick={() => setPower(!on)}
    >
      <Power size={15} aria-hidden />
      <span className="power-name">Arcanus</span>
      <span className="power-state">{changing ? (on ? "booting" : "closing") : on ? "on" : "off"}</span>
    </button>
  );
}

/** The power switch and the model list, pinned over the sphere, upper left. */
export function Engines({ engines }: { engines: Engine[] }) {
  const on = useStore(power, (s) => s.on);
  return (
    <div className="engines" role="group" aria-label="Arcanus power and on-device models" data-power={on ? "on" : "off"}>
      <PowerButton />
      {engines.map((engine) => (
        <EnginePill key={engine.name} engine={engine} />
      ))}
    </div>
  );
}
