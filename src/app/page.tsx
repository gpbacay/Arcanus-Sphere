"use client";

// The composition root: the only place that knows every module. Modules talk through their public APIs
// (src/modules/<name>/index.ts); to add an engine, append it to ENGINES and it boots and gets a status pill.
import { useEffect } from "react";
import { brainEngine } from "@/modules/brain";
import { ChatFallback, ChatPanel, hydrateChats, useBusy } from "@/modules/chat";
import { listenEngine } from "@/modules/listen";
import { llmEngine } from "@/modules/llm";
import { offlineReady } from "@/modules/offline";
import { Sphere } from "@/modules/sphere";
import { voice, voiceEngine } from "@/modules/voice";
import { Boundary } from "@/shared/boundary";
import { useStore } from "@/shared/store";
import { SidebarProvider } from "@/shared/ui/sidebar";

const ENGINES = [brainEngine, llmEngine, voiceEngine, listenEngine];

export default function Home() {
  useEffect(() => {
    hydrateChats();
    voice.restore();
    // Engines start once the service worker controls the page, so everything they download is kept for offline use.
    // Each loads on its own: a slow or failed one never holds up the others.
    void offlineReady().then(() => {
      for (const engine of ENGINES) if (!engine.state.state.off) engine.start();
    });
  }, []);

  return (
    <SidebarProvider defaultOpen className="h-dvh overflow-hidden" style={{ "--sidebar-width": "calc(min(420px, 100vw - 24px) + 24px)" } as React.CSSProperties}>
      <main className="app-shell">
        <Stage />
        <Boundary fallback={<ChatFallback />}>
          <ChatPanel engines={ENGINES} />
        </Boundary>
      </main>
    </SidebarProvider>
  );
}

/** The sphere and its caption. Its own component, so voice updates re-render only this, never the chat. */
function Stage() {
  const busy = useBusy();
  const analyser = useStore(voice.state, (s) => s.analyser);
  const speaking = useStore(voice.state, (s) => s.speaking);
  const caption = useStore(voice.state, (s) => s.caption);
  const state = speaking ? "speaking" : busy ? "thinking" : "idle";
  return (
    <>
      <div className="app-stage">
        {/* Paradee's audio runs through this analyser, so the sphere moves with the voice. */}
        <Sphere analyser={analyser} state={state} />
      </div>
      <div className="stage-foot">
        {caption ? (
          <p className="caption" aria-hidden>
            {caption}
          </p>
        ) : null}
        <span className="stage-state" data-state={state}>
          {state === "idle" ? "on this device" : state}
        </span>
      </div>
    </>
  );
}
