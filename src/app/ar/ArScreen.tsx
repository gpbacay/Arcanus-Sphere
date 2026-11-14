"use client";

// The AR page's composition: the camera view and orb, with Arcanus's chat laid over it. It boots the engines itself,
// since this page never loads the studio.
import { useEffect, useState } from "react";
import { brainEngine } from "@/modules/brain";
import { ArChat, cancelGreet, greet, hydrateChats, useBusy } from "@/modules/chat";
import { listenEngine } from "@/modules/listen";
import { llmEngine } from "@/modules/llm";
import { offlineReady } from "@/modules/offline";
import { ArView, type ArSession } from "@/modules/sphere";
import { WORLD_ID, validExperienceId } from "@/modules/sphere/experience";
import { readExperience } from "@/modules/sphere/experiences";
import { voice, voiceEngine } from "@/modules/voice";
import { bootInTurn, useStore } from "@/shared/store";

// Smallest first, the voice early for the greeting.
const ENGINES = [brainEngine, voiceEngine, llmEngine, listenEngine];

export function ArScreen({ experienceId }: { experienceId?: string }) {
  const busy = useBusy();
  const [session, setSession] = useState<ArSession | null>(null);
  const [problem, setProblem] = useState("");
  const analyser = useStore(voice.state, (s) => s.analyser);
  const speaking = useStore(voice.state, (s) => s.speaking);

  useEffect(() => {
    let live = true;
    setProblem("");
    const id = experienceId ?? "";
    if (!id || id === WORLD_ID) {
      setSession({ kind: "world", title: "Arcanus in your space" });
      return;
    }
    if (!validExperienceId(id)) {
      setSession(null);
      setProblem("This link does not match an AR experience.");
      return;
    }
    setSession(null);
    void readExperience(id)
      .then((experience) => {
        if (!live) return;
        if (!experience) {
          setProblem("That experience is not on this computer.");
          return;
        }
        if (experience.type === "image") {
          if (!experience.image) {
            setProblem("This image experience has no target image. Replace the image, then open the link again.");
            return;
          }
          setSession({ kind: "image", title: experience.name, imageUrl: experience.image });
          return;
        }
        setSession({ kind: "world", title: experience.name });
      })
      .catch((err: unknown) => {
        if (live) setProblem(err instanceof Error ? err.message : "Could not load this experience.");
      });
    return () => {
      live = false;
    };
  }, [experienceId]);

  useEffect(() => {
    voice.restore();
    let current = true;
    void hydrateChats().then(() => current && greet(ENGINES)); // the boot message goes into a conversation
    void offlineReady().then(() => bootInTurn(ENGINES, () => current));
    return () => {
      current = false;
      cancelGreet();
    };
  }, []);

  // Same inputs as the studio's sphere: the thinking boost only until the voice starts, then the voice drives it.
  return (
    <ArView session={session} problem={problem} analyser={analyser} activity={busy && !speaking ? 0.55 : 0}>
      <ArChat />
    </ArView>
  );
}
