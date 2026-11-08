"use client";

// The composition root: the only place that knows every module. Modules talk through their public APIs
// (src/modules/<name>/index.ts); to add an engine, append it to ENGINES and it gets a line in the chat's boot log.
// Whisper is not in this boot: it loads when the mic opens, on the CPU, so it never shares SmolLM2's GPU.
import { useEffect } from "react";
import { brainEngine } from "@/modules/brain";
import { cancelGreet, ChatFallback, ChatPanel, greet, hydrateChats, stopReply, useBusy } from "@/modules/chat";
import { listen, listenEngine } from "@/modules/listen";
import { llmEngine } from "@/modules/llm";
import { GraphOfThought } from "@/modules/mind";
import { offlineReady } from "@/modules/offline";
import { AppNav } from "@/modules/shell";
import { Sphere } from "@/modules/sphere";
import { voice, voiceEngine } from "@/modules/voice";
import { Browser } from "@/modules/web";
import { Files, workspaceReady } from "@/modules/workspace";
import { Boundary } from "@/shared/boundary";
import { power, restorePower } from "@/shared/power";
import { bootInTurn, useStore } from "@/shared/store";
import { SidebarProvider } from "@/shared/ui/sidebar";

// Speech waits until the mic is opened and stays on the CPU. The others start together.
const ENGINES = [brainEngine, voiceEngine, llmEngine, listenEngine];

export default function Home() {
  const on = useStore(power, (s) => s.on);

  useEffect(() => {
    hydrateChats();
    workspaceReady().catch(() => undefined); // .arcanus/: its error shows in the Files pane
    voice.restore();
    restorePower();
    // A click anywhere, including the power switch, lets the boot greeting be spoken once it's written.
    const unlock = () => voice.unlock();
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  useEffect(() => {
    if (!on) {
      // Switched off: finish nothing, say nothing, listen to nothing. The models stay loaded for the next boot.
      cancelGreet();
      stopReply();
      voice.cancel();
      listen.cancel();
      return;
    }
    // Engines start once the service worker controls the page, so everything they download is kept for offline use.
    // Off at load: nothing downloads yet. The boot message goes up first, so the chat shows each model waiting.
    greet(ENGINES);
    let current = true;
    void offlineReady().then(() => bootInTurn(ENGINES, () => current));
    return () => {
      current = false;
      cancelGreet();
    };
  }, [on]);

  return (
    <SidebarProvider defaultOpen className="h-dvh overflow-hidden" style={{ "--sidebar-width": "calc(min(372px, 100vw - 20px) + 20px)" } as React.CSSProperties}>
      <main className="app-shell">
        <Stage />
        <AppNav />
        <Boundary fallback={null}>
          <GraphOfThought />
          <Files />
          <Browser />
        </Boundary>
        <Boundary fallback={<ChatFallback />}>
          <ChatPanel />
        </Boundary>
      </main>
    </SidebarProvider>
  );
}

/** The sphere. Its own component, so voice updates re-render only this, never the chat. Replies live in the chat. */
function Stage() {
  const busy = useBusy();
  const analyser = useStore(voice.state, (s) => s.analyser);
  const speaking = useStore(voice.state, (s) => s.speaking);
  const on = useStore(power, (s) => s.on);
  const state = !on ? "off" : speaking ? "speaking" : busy ? "thinking" : "idle";
  return (
    <div className="app-stage">
      {/* Paradee's audio runs through this analyser, so the sphere moves with the voice. */}
      <Sphere analyser={analyser} state={state === "off" ? "idle" : state} on={on} />
    </div>
  );
}
