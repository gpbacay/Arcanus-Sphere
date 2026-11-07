"use client";

// The AR page's composition: the camera view and orb, with Arcanus's chat laid over it. It boots the engines itself,
// since this page never loads the studio.
import { useEffect } from "react";
import { brainEngine } from "@/modules/brain";
import { ArChat, cancelGreet, greet, hydrateChats, useBusy } from "@/modules/chat";
import { listenEngine } from "@/modules/listen";
import { llmEngine } from "@/modules/llm";
import { offlineReady } from "@/modules/offline";
import { ArView } from "@/modules/sphere";
import { voice, voiceEngine } from "@/modules/voice";
import { bootInTurn, useStore } from "@/shared/store";

// Smallest first, the voice early for the greeting.
const ENGINES = [brainEngine, voiceEngine, llmEngine, listenEngine];

export function ArScreen() {
  const busy = useBusy();
  const analyser = useStore(voice.state, (s) => s.analyser);
  const speaking = useStore(voice.state, (s) => s.speaking);

  useEffect(() => {
    hydrateChats();
    voice.restore();
    greet(ENGINES);
    let current = true;
    void offlineReady().then(() => bootInTurn(ENGINES, () => current));
    return () => {
      current = false;
      cancelGreet();
    };
  }, []);

  // Same inputs as the studio's sphere: the thinking boost only until the voice starts, then the voice drives it.
  return (
    <ArView analyser={analyser} activity={busy && !speaking ? 0.55 : 0}>
      <ArChat />
    </ArView>
  );
}
