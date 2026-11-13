"use client";

// Paradee-8M runs in its own Web Worker (tts.worker.ts). This is the main-thread side: queued playback through a Web
// Audio analyser (which drives the sphere), captions, and the user's voice on/off choice.
import { Store, IDLE, startWorker, type Engine, type LoadState } from "@/shared/store";
import { forSpeech } from "./text";

const KEY = "arcanus_voice_v1";

class Voice {
  state = new Store<LoadState & { speaking: boolean; caption: string; analyser: AnalyserNode | null }>({
    ...IDLE,
    speaking: false,
    caption: "",
    analyser: null,
  });
  private worker: Promise<Worker> | null = null;
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private gen = 0;
  private nextAt = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private timers = new Set<number>();

  start() {
    this.worker ??= startWorker(this.state, () => new Worker(new URL("./tts.worker.ts", import.meta.url), { type: "module" }), (data) => {
      if (data.type === "audio" && data.gen === this.gen) this.play(data.samples as Float32Array, data.rate as number, data.text as string);
    });
    this.worker.catch(() => (this.worker = null));
    return this.worker;
  }

  /** Read the saved on/off choice. Call once on the client. */
  restore() {
    try {
      this.state.set({ off: localStorage.getItem(KEY) === "off" });
    } catch {
      /* storage blocked: voice stays on */
    }
  }

  setEnabled(on: boolean) {
    this.state.set({ off: !on });
    try {
      localStorage.setItem(KEY, on ? "on" : "off");
    } catch {
      /* storage blocked: the choice lasts this session */
    }
    if (on) {
      this.unlock();
      void this.start().catch(() => undefined);
    } else this.cancel();
  }

  /**
   * Create or resume the AudioContext. Call from a click or key handler: browsers only allow audio after a gesture.
   * Without Web Audio, Arcanus still answers in text: say() then plays nothing.
   */
  unlock() {
    try {
      if (!this.ctx) {
        const Context = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Context) return;
        this.ctx = new Context({ latencyHint: "interactive" });
        const analyser = this.ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.75;
        this.out = this.ctx.createGain(); // after the analyser, so ducking quiets the voice but not the sphere
        analyser.connect(this.out).connect(this.ctx.destination);
        this.state.set({ analyser });
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
    } catch {
      /* no audio in this browser: text only */
    }
  }

  /** Queue `text` to be spoken after whatever is already queued. Does nothing while the voice is off. */
  say(text: string) {
    const spoken = forSpeech(text);
    if (!spoken || this.state.state.off) return;
    const gen = this.gen;
    void this.start().then((w) => w.postMessage({ type: "speak", gen, text: spoken }), () => undefined);
  }

  /**
   * Synthesize `text` now, without playing it: a later say() of the same words then plays from what the worker already
   * has, within a frame, instead of after the time it takes to write it. The boot greeting is warmed while the page
   * loads, so it can be spoken the moment the page appears.
   */
  warm(text: string) {
    const spoken = forSpeech(text);
    if (!spoken || this.state.state.off) return;
    void this.start().then((w) => w.postMessage({ type: "warm", text: spoken }), () => undefined);
  }

  /**
   * The context this voice plays through. The microphone records in this same context, so the browser's echo
   * cancellation hears the voice and can keep the mic open while it plays.
   */
  audio() {
    this.unlock();
    return this.ctx;
  }

  /** Turn the voice down while someone may be talking over it (and its echo out of the mic), or back up. */
  duck(on: boolean) {
    if (this.ctx && this.out) this.out.gain.setTargetAtTime(on ? 0.08 : 1, this.ctx.currentTime, 0.03);
  }

  /** Stop speaking now and drop every queued sentence. */
  cancel() {
    this.duck(false);
    this.gen++;
    void this.worker?.then((w) => w.postMessage({ type: "cancel", gen: this.gen }), () => undefined);
    for (const source of this.sources) source.stop();
    this.sources.clear();
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.nextAt = 0;
    this.state.set({ speaking: false, caption: "" });
  }

  private play(samples: Float32Array, rate: number, text: string) {
    const ctx = this.ctx;
    const analyser = this.state.state.analyser;
    if (!ctx || !analyser) return;
    const buffer = ctx.createBuffer(1, samples.length, rate);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(analyser);
    const at = Math.max(ctx.currentTime + 0.03, this.nextAt);
    source.start(at);
    this.nextAt = at + buffer.duration;
    this.sources.add(source);
    this.state.set({ speaking: true });
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      this.state.set({ caption: text });
    }, (at - ctx.currentTime) * 1000);
    this.timers.add(timer);
    source.onended = () => {
      this.sources.delete(source);
      if (!this.sources.size) this.state.set({ speaking: false, caption: "" });
    };
  }
}

export const voice = new Voice();

export const voiceEngine: Engine = {
  name: "Paradee",
  detail: "8M voice · ~9 MB",
  state: voice.state,
  start: () => void voice.start().catch(() => undefined),
};
