"use client";

// Public API of the sphere module. The three.js scene is its own chunk, fetched after the page paints; until then,
// and for good when WebGL is missing or the scene crashes, a CSS orb stands in and still shows Arcanus's state.
import dynamic from "next/dynamic";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Boundary } from "@/shared/boundary";
import { hideStage, showStage } from "@/shared/stage";
import { TALK_FPS, WORK_FPS } from "./pace";
import type { Tool } from "./SphereScene";
import { SphereTools } from "./Tools";

export type SphereState = "idle" | "thinking" | "speaking";

function Orb({ state, loading, off }: { state: SphereState; loading?: boolean; off?: boolean }) {
  return <div className="orb-fallback" data-state={state} data-loading={loading || undefined} data-off={off || undefined} aria-hidden />;
}

/** The CSS orb standing in for good (no WebGL, or the scene crashed): it is what is on screen, so the stage is shown. */
function Stand(props: { state: SphereState; off?: boolean }) {
  useEffect(() => {
    showStage();
    return hideStage;
  }, []);
  return <Orb {...props} />;
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

/** `working`: a model is running right now (loading, listening, thinking, writing), so the sphere draws less (pace.ts). */
export function Sphere({ analyser, state, on = true, working = false }: { analyser: AnalyserNode | null; state: SphereState; on?: boolean; working?: boolean }) {
  const canDraw = useSyncExternalStore(never, hasWebGL, () => true);
  const [tool, setTool] = useState<Tool>("view");
  const [resetKey, setResetKey] = useState(0);
  const [edited, setEdited] = useState(false); // the orb was moved, rotated or resized: undo is offered
  const orb = <Stand state={state} off={!on} />;
  return (
    <>
      {canDraw ? (
        <Boundary fallback={orb}>
          <Scene
            analyser={analyser}
            activityBoost={state === "thinking" ? 0.55 : 0}
            cap={!working ? 0 : state === "speaking" ? TALK_FPS : WORK_FPS}
            tool={tool}
            on={on}
            resetKey={resetKey}
            onEdit={setEdited}
          />
        </Boundary>
      ) : (
        orb
      )}
      {/* The ⋮ holds the power switch too, so it stays when there is no WebGL (a phone's, often): then it offers only that. */}
      <SphereTools
        canDraw={canDraw}
        tool={tool}
        onTool={setTool}
        edited={edited}
        onReset={() => {
          setTool("view");
          setEdited(false);
          setResetKey((key) => key + 1);
        }}
      />
    </>
  );
}
