"use client";

// The AR page's composition: the camera view and orb, with Arcanus's chat laid over it. It boots the engines itself,
// since this page never loads the studio.
import { useEffect } from "react";
import { brainEngine } from "@/modules/brain";
import { ArChat, hydrateChats, useBusy } from "@/modules/chat";
import { listenEngine } from "@/modules/listen";
import { llmEngine } from "@/modules/llm";
import { offlineReady } from "@/modules/offline";
import { ArView } from "@/modules/sphere";
import { voice, voiceEngine } from "@/modules/voice";
import { useStore } from "@/shared/store";

const ENGINES = [brainEngine, llmEngine, voiceEngine, listenEngine];

export function ArScreen() {
  const busy = useBusy();
  const analyser = useStore(voice.state, (s) => s.analyser);

  useEffect(() => {
    hydrateChats();
    voice.restore();
    void offlineReady().then(() => {
      for (const engine of ENGINES) if (!engine.state.state.off) engine.start();
    });
  }, []);

  return (
    <ArView analyser={analyser} activity={busy ? 0.55 : 0}>
      <ArChat />
    </ArView>
  );
}
