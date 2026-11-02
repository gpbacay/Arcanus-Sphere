"use client";

import { useState } from "react";
import SphereScene from "./components/SphereScene";
import ChatPanel from "./components/ChatPanel";
import { useEngine, voice } from "@/lib/engines";

export default function Home() {
  const [busy, setBusy] = useState(false);
  const { analyser, speaking, caption } = useEngine(voice.state);
  const state = speaking ? "speaking" : busy ? "thinking" : "idle";

  return (
    <main className="app-shell">
      <div className="app-stage">
        {/* Kokoro's audio runs through this analyser, so the sphere moves with the voice. */}
        <SphereScene analyser={analyser} activityBoost={busy && !speaking ? 0.55 : 0} />
      </div>
      <ChatPanel onBusyChange={setBusy} />
      <div className="stage-foot">
        {caption ? (
          <p className="caption" aria-hidden>
            {caption}
          </p>
        ) : null}
        <span className="stage-state" data-state={state}>
          {state === "speaking" ? "speaking" : state === "thinking" ? "thinking" : "on this device"}
        </span>
      </div>
    </main>
  );
}
