"use client";

// The composition root: the only place that knows every module. Modules talk through their public APIs
// (src/modules/<name>/index.ts); to add an engine, append it to ENGINES and it gets a line in the chat's boot log.
// Moonshine (speech to text) is not in this boot: it loads when the mic opens, on the CPU, so it never shares SmolLM2's GPU.
import { useEffect, useState } from "react";
import { Gate } from "@/modules/account";
import { brainEngine } from "@/modules/brain";
import { cancelGreet, ChatFallback, ChatPanel, greet, hydrateChats, stopReply, useBusy } from "@/modules/chat";
import { listen, listenEngine } from "@/modules/listen";
import { llmEngine } from "@/modules/llm";
import { GraphOfThought, mind } from "@/modules/mind";
import { offlineReady } from "@/modules/offline";
import { AppNav } from "@/modules/shell";
import { Sphere } from "@/modules/sphere";
import { voice, voiceEngine } from "@/modules/voice";
import { Browser } from "@/modules/web";
import { Files, workspaceReady } from "@/modules/workspace";
import { Boundary } from "@/shared/boundary";
import { closePane } from "@/shared/pane";
import { power, restorePower } from "@/shared/power";
import { bootInTurn, useStore } from "@/shared/store";
import { SidebarProvider } from "@/shared/ui/sidebar";

// Speech waits until the mic is opened and stays on the CPU. The others start together.
const ENGINES = [brainEngine, voiceEngine, llmEngine, listenEngine];

export default function Page() {
  useEffect(() => {
    voice.restore();
    restorePower();
    // The models are the same for every account, so the two large ones start loading behind the sign-in form
    // (through the service worker, so they are kept for offline use): by the time you are in, they are further along.
    if (power.state.on) void offlineReady().then(() => bootInTurn([voiceEngine, llmEngine]));
    // A click anywhere, signing in included, lets the boot greeting be spoken.
    const unlock = () => voice.unlock();
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);
  return (
    <Gate>
      <Home />
    </Gate>
  );
}

/** Arcanus for the signed-in account: its conversations and its files are read here, never before. */
function Home() {
  const on = useStore(power, (s) => s.on);
  const [hydrated, setHydrated] = useState(false); // the boot message goes into a conversation, so it waits for them

  useEffect(() => {
    void hydrateChats().then(() => setHydrated(true));
    workspaceReady().catch(() => undefined); // .arcanus/: its error shows in the Files pane
    // A phone opens on the sphere and the chat: there a side pane takes the whole screen, so it waits to be asked for.
    if (window.matchMedia("(max-width: 767px)").matches) closePane();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
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
  }, [on, hydrated]);

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
  const heard = useStore(listen.state, (s) => s.hearing || s.writing); // you are talking, or your words are being written
  const on = useStore(power, (s) => s.on);
  // A model loading, or the boot greeting being written: the same work as a reply, before there is any reply.
  const thinking = useStore(mind, (s) => s.thoughts.some((t) => t.status === "active" && t.operation !== "speak"));
  const state = !on ? "off" : speaking ? "speaking" : busy ? "thinking" : "idle";
  return (
    <div className="app-stage">
      {/* Paradee's audio runs through this analyser, so the sphere moves with the voice. */}
      {/* While a model works, the sphere draws fewer frames: the models get the machine. */}
      <Sphere analyser={analyser} state={state === "off" ? "idle" : state} on={on} working={on && (busy || heard || thinking)} />
    </div>
  );
}
