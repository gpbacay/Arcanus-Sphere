"use client";

// The composition root: the only place that knows every module. Modules talk through their public APIs
// (src/modules/<name>/index.ts); to add an engine, append it to ENGINES and it boots and gets a status pill.
import { useEffect } from "react";
import { brainEngine } from "@/modules/brain";
import { cancelGreet, ChatFallback, ChatPanel, greet, greeting, hydrateChats, stopReply, useBusy } from "@/modules/chat";
import { listen, listenEngine } from "@/modules/listen";
import { llmEngine } from "@/modules/llm";
import { offlineReady } from "@/modules/offline";
import { AppNav } from "@/modules/shell/AppNav";
import { Sphere } from "@/modules/sphere";
import { voice, voiceEngine } from "@/modules/voice";
import { Boundary } from "@/shared/boundary";
import { power, restorePower } from "@/shared/power";
import { useStore } from "@/shared/store";
import { restoreTheme } from "@/shared/theme";
import { Engines } from "@/shared/ui/engines";
import { SidebarProvider } from "@/shared/ui/sidebar";

const ENGINES = [brainEngine, llmEngine, voiceEngine, listenEngine];

export default function Home() {
  const on = useStore(power, (s) => s.on);

  useEffect(() => {
    hydrateChats();
    voice.restore();
    restorePower();
    restoreTheme();
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
    let current = true;
    void offlineReady().then(() => {
      if (!current) return;
      for (const engine of ENGINES) if (!engine.state.state.off) engine.start();
      greet();
    });
    return () => {
      current = false;
      cancelGreet();
    };
  }, [on]);

  return (
    <SidebarProvider defaultOpen className="h-dvh overflow-hidden" style={{ "--sidebar-width": "calc(min(420px, 100vw - 24px) + 24px)" } as React.CSSProperties}>
      <main className="app-shell">
        <Stage />
        <AppNav />
        <Engines engines={ENGINES} />
        <Boundary fallback={<ChatFallback />}>
          <ChatPanel />
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
  const greetLine = useStore(greeting, (s) => s.text);
  const on = useStore(power, (s) => s.on);
  const changing = useStore(power, (s) => s.changing);
  const state = !on ? "off" : speaking ? "speaking" : busy ? "thinking" : "idle";
  const label = changing ? (on ? "booting" : "shutting down") : state === "idle" ? "on this device" : state;
  return (
    <>
      <div className="app-stage">
        {/* Paradee's audio runs through this analyser, so the sphere moves with the voice. */}
        <Sphere analyser={analyser} state={state === "off" ? "idle" : state} on={on} />
      </div>
      <div className="stage-foot">
        {(caption || greetLine) && on ? (
          <p className="caption" aria-hidden>
            {caption || greetLine}
          </p>
        ) : null}
        <span className="stage-state" data-state={state}>
          {label}
        </span>
      </div>
    </>
  );
}
