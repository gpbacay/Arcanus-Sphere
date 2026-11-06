"use client";

// The composition root: the only place that knows every module. Modules talk through their public APIs
// (src/modules/<name>/index.ts); to add an engine, append it to ENGINES and it boots and gets a line in the chat's boot log.
import { useEffect } from "react";
import { brainEngine } from "@/modules/brain";
import { cancelGreet, ChatFallback, ChatPanel, greet, hydrateChats, stopReply, useBusy } from "@/modules/chat";
import { listen, listenEngine } from "@/modules/listen";
import { llmEngine } from "@/modules/llm";
import { offlineReady } from "@/modules/offline";
import { AppNav } from "@/modules/shell";
import { Sphere } from "@/modules/sphere";
import { voice, voiceEngine } from "@/modules/voice";
import { Browser } from "@/modules/web";
import { Files, workspaceReady } from "@/modules/workspace";
import { Boundary } from "@/shared/boundary";
import { power, restorePower } from "@/shared/power";
import { useStore } from "@/shared/store";
import { SidebarProvider } from "@/shared/ui/sidebar";

const ENGINES = [brainEngine, llmEngine, voiceEngine, listenEngine];

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
    // Each loads on its own: a slow or failed one never holds up the others. Off at load: nothing downloads yet.
    // The boot message goes up first, so the chat shows each model waiting, then loading.
    greet(ENGINES);
    let current = true;
    void offlineReady().then(() => {
      if (!current) return;
      for (const engine of ENGINES) if (!engine.state.state.off) engine.start();
    });
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
