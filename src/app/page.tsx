"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SphereScene from "./components/SphereScene";
import ChatPanel, {
  type LiveAgentState,
  type UiMessage,
} from "./components/ChatPanel";
import type { AgentStreamEvent, AgentStep, ChatMessage } from "@/lib/types";

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

export default function Home() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [activityBoost, setActivityBoost] = useState(0);
  const [live, setLive] = useState<LiveAgentState | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const talkOscRef = useRef<{
    osc: OscillatorNode;
    gain: GainNode;
    lfo: OscillatorNode;
    lfoGain: GainNode;
  } | null>(null);

  useEffect(() => {
    if (isThinking && !isSpeaking) setActivityBoost(0.55);
    else if (isSpeaking) setActivityBoost(0);
    else setActivityBoost(0);
  }, [isThinking, isSpeaking]);

  const ensureAudioGraph = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return null;

    if (!audioContextRef.current) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContextClass();
      const nextAnalyser = ctx.createAnalyser();
      nextAnalyser.fftSize = 512;
      nextAnalyser.smoothingTimeConstant = 0.75;

      const gain = ctx.createGain();
      gain.gain.value = 1;

      const source = ctx.createMediaElementSource(audio);
      source.connect(nextAnalyser);
      nextAnalyser.connect(gain);
      gain.connect(ctx.destination);

      audioContextRef.current = ctx;
      sourceRef.current = source;
      gainNodeRef.current = gain;
      analyserRef.current = nextAnalyser;
      setAnalyser(nextAnalyser);
    }

    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  const stopTalkOscillator = useCallback(() => {
    const nodes = talkOscRef.current;
    if (!nodes) return;
    try {
      nodes.gain.gain.setTargetAtTime(0, audioContextRef.current?.currentTime || 0, 0.03);
      window.setTimeout(() => {
        try {
          nodes.osc.stop();
          nodes.lfo.stop();
          nodes.osc.disconnect();
          nodes.lfo.disconnect();
          nodes.gain.disconnect();
          nodes.lfoGain.disconnect();
        } catch {
          /* already stopped */
        }
      }, 80);
    } catch {
      /* ignore */
    }
    talkOscRef.current = null;
  }, []);

  const startTalkOscillator = useCallback(async () => {
    const ctx = await ensureAudioGraph();
    const analyserNode = analyserRef.current;
    if (!ctx || !analyserNode) return;

    stopTalkOscillator();

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 140;

    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 4.5;

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.35;

    const talkGain = ctx.createGain();
    talkGain.gain.value = 0.0001;

    lfo.connect(lfoGain);
    lfoGain.connect(talkGain.gain);
    osc.connect(talkGain);
    // Feed analyser so the sphere “hears” speech energy; keep audible level tiny
    talkGain.connect(analyserNode);

    osc.start();
    lfo.start();
    talkGain.gain.setTargetAtTime(0.045, ctx.currentTime, 0.05);
    talkOscRef.current = { osc, gain: talkGain, lfo, lfoGain };

    // Syllable-like amplitude jitter
    const jitter = window.setInterval(() => {
      if (!talkOscRef.current || !audioContextRef.current) return;
      const g = talkOscRef.current.gain.gain;
      const now = audioContextRef.current.currentTime;
      g.cancelScheduledValues(now);
      g.setTargetAtTime(0.02 + Math.random() * 0.06, now, 0.04);
      talkOscRef.current.osc.frequency.setTargetAtTime(
        110 + Math.random() * 80,
        now,
        0.05
      );
    }, 90);

    return () => window.clearInterval(jitter);
  }, [ensureAudioGraph, stopTalkOscillator]);

  const speakWithBrowserFallback = useCallback(
    async (text: string) => {
      if (typeof window === "undefined" || !window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      stopTalkOscillator();

      const utter = new SpeechSynthesisUtterance(text.slice(0, 600));
      utter.rate = 1;
      utter.pitch = 1;
      setIsSpeaking(true);
      setActivityBoost(0);

      const clearJitter = await startTalkOscillator();

      const finish = () => {
        if (clearJitter) clearJitter();
        stopTalkOscillator();
        setIsSpeaking(false);
        setActivityBoost(0);
      };
      utter.onend = finish;
      utter.onerror = finish;
      window.speechSynthesis.speak(utter);
    },
    [startTalkOscillator, stopTalkOscillator]
  );

  const speakText = useCallback(
    async (text: string) => {
      if (!ttsEnabled || !text.trim()) return;

      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });

        if (!res.ok) {
          await speakWithBrowserFallback(text);
          return;
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = audioRef.current;
        if (!audio) {
          await speakWithBrowserFallback(text);
          return;
        }

        stopTalkOscillator();
        await ensureAudioGraph();
        audio.src = url;
        setIsSpeaking(true);
        setActivityBoost(0);

        const cleanup = () => {
          setIsSpeaking(false);
          URL.revokeObjectURL(url);
        };
        audio.onended = cleanup;
        audio.onerror = () => {
          cleanup();
          void speakWithBrowserFallback(text);
        };

        await audio.play();
      } catch {
        await speakWithBrowserFallback(text);
      }
    },
    [ensureAudioGraph, speakWithBrowserFallback, stopTalkOscillator, ttsEnabled]
  );

  const onSend = useCallback(
    async (text: string) => {
      setError(null);
      const userMsg: UiMessage = {
        id: `u_${Date.now()}`,
        role: "user",
        content: text,
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsThinking(true);
      setLive({ status: "planning", thought: "", answer: "", tools: [] });

      try {
        const history: ChatMessage[] = messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, history, stream: true }),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || "Chat request failed");
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response stream");

        const decoder = new TextDecoder();
        let buffer = "";
        let finalReply = "";
        let finalSteps: AgentStep[] = [];
        let finalModel = "";
        let liveThought = "";
        let liveAnswer = "";
        const liveTools: { toolName: string; content: string }[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;
            let event: AgentStreamEvent;
            try {
              event = JSON.parse(line) as AgentStreamEvent;
            } catch {
              continue;
            }

            if (event.type === "status") {
              setLive((prev) =>
                prev
                  ? { ...prev, status: event.content }
                  : {
                      status: event.content,
                      thought: liveThought,
                      answer: liveAnswer,
                      tools: [...liveTools],
                    }
              );
            } else if (event.type === "thought") {
              liveThought = event.append
                ? liveThought + event.content
                : event.content;
              setLive((prev) => ({
                status: prev?.status || "thinking",
                thought: liveThought,
                answer: liveAnswer,
                tools: [...liveTools],
              }));
            } else if (event.type === "tool") {
              liveTools.push({
                toolName: event.toolName,
                content: event.content,
              });
              setLive((prev) => ({
                status: prev?.status || "tools",
                thought: liveThought,
                answer: liveAnswer,
                tools: [...liveTools],
              }));
            } else if (event.type === "answer") {
              liveAnswer = event.append
                ? liveAnswer + event.content
                : event.content;
              setLive((prev) => ({
                status: prev?.status || "generating",
                thought: liveThought,
                answer: liveAnswer,
                tools: [...liveTools],
              }));
            } else if (event.type === "done") {
              finalReply = event.reply;
              finalSteps = event.steps;
              finalModel = event.model;
            } else if (event.type === "error") {
              throw new Error(event.content);
            }
          }
        }

        const thought =
          finalSteps
            .filter((s) => s.type === "thought")
            .map((s) => s.content)
            .join("\n\n") || liveThought;

        const reply = finalReply || liveAnswer;
        const assistantMsg: UiMessage = {
          id: `a_${Date.now()}`,
          role: "assistant",
          content: reply,
          steps: finalSteps.length
            ? finalSteps
            : [
                ...(thought
                  ? [{ type: "thought" as const, content: thought }]
                  : []),
                ...liveTools.map((t) => ({
                  type: "tool" as const,
                  toolName: t.toolName,
                  content: t.content,
                })),
                { type: "answer" as const, content: reply },
              ],
          model: finalModel,
          thought,
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setLive(null);
        setIsThinking(false);
        if (reply) await speakText(reply);
      } catch (err) {
        setIsThinking(false);
        setLive(null);
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    },
    [messages, speakText]
  );

  const lastModel =
    [...messages].reverse().find((m) => m.model)?.model || null;

  return (
    <main className="app-shell">
      <div className="app-stage">
        <SphereScene analyser={analyser} activityBoost={activityBoost} />
      </div>

      <ChatPanel
        messages={messages}
        isThinking={isThinking}
        isSpeaking={isSpeaking}
        ttsEnabled={ttsEnabled}
        onToggleTts={() => setTtsEnabled((v) => !v)}
        onSend={onSend}
        error={error}
        modelLabel={lastModel}
        live={live}
      />

      <audio ref={audioRef} style={{ display: "none" }} crossOrigin="anonymous" />

      <div className="stage-label">sphere · audio reactive</div>
    </main>
  );
}
