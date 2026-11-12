"use client";

// Public API of the sphere module. The three.js scene is its own chunk, fetched after the page paints; until then,
// and for good when WebGL is missing or the scene crashes, a CSS orb stands in and still shows Arcanus's state.
import dynamic from "next/dynamic";
import { useState, useSyncExternalStore } from "react";
import { Boundary } from "@/shared/boundary";
import { TALK_FPS, WORK_FPS } from "./pace";
import type { Tool } from "./SphereScene";
import { SphereTools } from "./Tools";

export type SphereState = "idle" | "thinking" | "speaking";

function Orb({ state, loading, off }: { state: SphereState; loading?: boolean; off?: boolean }) {
  return <div className="orb-fallback" data-state={state} data-loading={loading || undefined} data-off={off || undefined} aria-hidden />;
}

/** The AR page: Arcanus's orb in your space, tracked by the 8th Wall engine. Its own chunk, fetched only on /ar. */
export const ArView = dynamic(() => import("./ArView"), { ssr: false });

const Scene = dynamic(() => import("./SphereScene"), { ssr: false, loading: () => <Orb state="idle" loading /> });

let webgl: boolean | undefined;
function hasWebGL() {
  if (webgl === undefined) {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      webgl = Boolean(gl);
      gl?.getExtension("WEBGL_lose_context")?.loseContext(); // only a probe: give the context back
    } catch {
      webgl = false;
    }
  }
  return webgl;
}
const never = () => () => undefined;

/** `working`: a model is running right now (listening, thinking, writing), so the sphere may have to draw less (pace.ts). */
export function Sphere({ analyser, state, on = true, working = false }: { analyser: AnalyserNode | null; state: SphereState; on?: boolean; working?: boolean }) {
  const canDraw = useSyncExternalStore(never, hasWebGL, () => true);
  const [tool, setTool] = useState<Tool>("view");
  const [resetKey, setResetKey] = useState(0);
  const orb = <Orb state={state} off={!on} />;
  if (!canDraw) return orb;
  return (
    <>
      <Boundary fallback={orb}>
        <Scene
          analyser={analyser}
          activityBoost={state === "thinking" ? 0.55 : 0}
          cap={!working ? 0 : state === "speaking" ? TALK_FPS : WORK_FPS}
          tool={tool}
          on={on}
          resetKey={resetKey}
        />
      </Boundary>
      <SphereTools
        tool={tool}
        onTool={setTool}
        onReset={() => {
          setTool("view");
          setResetKey((key) => key + 1);
        }}
      />
    </>
  );
}
