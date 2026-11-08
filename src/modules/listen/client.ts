"use client";

// Speech to text, hands-free and full duplex, all on the device. Tap once and the microphone stays open while
// Arcanus speaks: both share one AudioContext, so echo cancellation hears the voice and the mic is not muted by it.
// Frames (an AudioWorklet, 16 kHz) are scored by Silero when it is keeping up, otherwise by loudness, in the same
// order, so a slow score never stalls the mic. The segmenter cuts out each thing you say when you pause, and Whisper
// writes it down while the mic keeps listening. Clear speech over Arcanus stops it at once.
import { afterGpu } from "@/shared/boot";
import { Store, IDLE, errorText, startWorker, type Engine, type LoadState } from "@/shared/store";
import { voice } from "@/modules/voice";
import { detectorFree, FRAME, Loudness, RATE, Segmenter } from "./segment";

export type Talk = {
  /** Someone started speaking. `cut` means it happened over Arcanus and the speech model is sure, so stop now. */
  onSpeech: (cut: boolean) => void;
  /** What they said, once they paused. Empty when it was noise or couldn't be written down. */
  onText: (text: string) => void;
  /** True while Arcanus is speaking, so its own voice leaking into the mic needs more to count as speech. */
  strict: () => boolean;
};

type Pending = { resolve: (text: string) => void; reject: (e: Error) => void };
type Held = { id: number; sid: number; samples: Float32Array; loud: number };

// Runs in the audio thread: turns the mic's native rate into 16 kHz frames of FRAME samples, by averaging.
const WORKLET = `
class Frames extends AudioWorkletProcessor {
  constructor() { super(); this.out = new Float32Array(${FRAME}); this.n = 0; this.acc = 0; this.cnt = 0; this.phase = 0; this.step = sampleRate / ${RATE}; }
  process(inputs) {
    const ch = inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i]; this.cnt++; this.phase++;
      if (this.phase >= this.step) {
        this.phase -= this.step;
        this.out[this.n++] = this.acc / this.cnt; this.acc = 0; this.cnt = 0;
        if (this.n === ${FRAME}) { this.port.postMessage(this.out, [this.out.buffer]); this.out = new Float32Array(${FRAME}); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor("arcanus-frames", Frames);
`;

type Session = {
  sid: number;
  stream: MediaStream;
  node: AudioWorkletNode;
  src: MediaStreamAudioSourceNode;
  mute: GainNode;
  seg: Segmenter;
  loud: Loudness;
  talk: Talk;
  /** Words for the pause going on now, written while it runs out. */
  guess: Promise<string> | null;
};

class Listen {
  state = new Store<LoadState & { on: boolean; hearing: boolean; writing: boolean; problem: string }>({
    ...IDLE,
    on: false,
    hearing: false,
    writing: false,
    problem: "",
  });
  private worker: Promise<Worker> | null = null;
  private pending = new Map<number, Pending>();
  private seq = 0;
  private sid = 0; // bumped by every open and close, so frames and words from an ended session are dropped
  private session: Session | null = null;
  private queue: Promise<unknown> = Promise.resolve(); // one transcription at a time, in the order things were said
  private jobs = 0;
  private vad: Worker | null = null;
  private vadReady = false;
  private worklet = false;
  /** The one frame waiting on Silero. Flushed with loudness if the next frame arrives first, so the mic never queues. */
  private held: Held | null = null;
  private inFlight = false;
  private missed = false; // a frame Silero didn't see: the next one it does see resets its state
  private frame = 0;

  /** Load Whisper. Safe to call again; the way to retry after an error. */
  start(): Promise<unknown> {
    return this.whisper();
  }

  private whisper() {
    this.worker ??= afterGpu(() => startWorker(this.state, () => new Worker(new URL("./listen.worker.ts", import.meta.url), { type: "module" }), (data) => {
      const job = this.pending.get(data.id as number);
      if (!job) return;
      this.pending.delete(data.id as number);
      if (data.type === "text") job.resolve(data.text as string);
      else if (data.type === "error") job.reject(new Error(String(data.message)));
    }));
    this.worker.catch(() => (this.worker = null));
    return this.worker;
  }

  /** Whether this browser can record at all. */
  static supported() {
    return typeof AudioWorklet !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
  }

  /** Open the microphone and keep it open until cancel(). Call from a click: the browser asks for the microphone. */
  async converse(talk: Talk) {
    if (this.state.state.on) return;
    const sid = ++this.sid;
    this.held = null;
    this.inFlight = false;
    this.missed = false;
    this.state.set({ on: true, hearing: false, problem: "" });
    void this.start().catch(() => undefined);
    this.detector();
    let stream: MediaStream | null = null;
    let node: AudioWorkletNode | null = null;
    let src: MediaStreamAudioSourceNode | null = null;
    try {
      const ctx = voice.audio();
      if (!ctx) throw new Error("This browser can't play audio.");
      await ctx.resume();
      stream = await navigator.mediaDevices.getUserMedia({
        // One context with the voice, so echo cancellation hears it. Noise suppression and auto gain mute the mic
        // while that voice plays: that is the half-duplex. Leave them off.
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: false },
      });
      if (!this.worklet) {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
        await ctx.audioWorklet.addModule(url).then(
          () => (this.worklet = true),
          (error: unknown) => {
            if (!/already/i.test(error instanceof Error ? error.message : "")) throw error;
            this.worklet = true;
          },
        ).finally(() => URL.revokeObjectURL(url));
      }
      if (sid !== this.sid) throw new Error("cancelled"); // while the mic was opening: the catch closes it quietly
      node = new AudioWorkletNode(ctx, "arcanus-frames");
      node.port.onmessage = ({ data }: MessageEvent<Float32Array>) => this.scored(sid, data);
      const mute = ctx.createGain(); // a worklet only runs while it is connected to the output; silence it
      mute.gain.value = 0;
      src = ctx.createMediaStreamSource(stream);
      src.connect(node).connect(mute).connect(ctx.destination);
      this.session = { sid, stream, node, src, mute, seg: new Segmenter(), loud: new Loudness(), talk, guess: null };
      this.session.seg.fast = this.vadReady;
    } catch (error) {
      node?.disconnect();
      src?.disconnect();
      stream?.getTracks().forEach((track) => track.stop());
      if (sid !== this.sid) return;
      this.state.set({
        on: false,
        problem:
          error instanceof Error && error.name !== "NotAllowedError" && error.name !== "NotFoundError"
            ? errorText(error)
            : "Arcanus can't use the microphone. Allow it in the browser's site settings.",
      });
    }
  }

  /** Start the voice detector (Silero VAD) if it isn't running. Until it says ready, frames are scored by loudness. */
  private detector() {
    if (this.vad || typeof Worker === "undefined") return;
    const worker = new Worker(new URL("./vad.worker.ts", import.meta.url), { type: "module" });
    this.vad = worker;
    const drop = () => {
      worker.terminate(); // no detector: loudness it is, and the next open tries again
      this.vad = null;
      this.vadReady = false;
      this.inFlight = false;
      if (this.session) this.session.seg.fast = false;
    };
    worker.onerror = drop;
    worker.onmessage = ({ data }: MessageEvent<{ type: string; sid?: number; id?: number; p?: number }>) => {
      if (data.type === "ready") {
        this.vadReady = true;
        if (this.session) this.session.seg.fast = true;
      } else if (data.type === "error") drop();
      else if (data.type === "p") this.scoredBack(data.sid ?? -1, data.id ?? -1, data.p ?? -1);
    };
    worker.postMessage({ type: "load" });
  }

  /** One frame came in. Hear it now if Silero is busy or absent; otherwise hold it for the one frame Silero needs. */
  private scored(sid: number, samples: Float32Array) {
    const s = this.session;
    if (!s || s.sid !== sid) return;
    const loud = s.loud.score(samples);
    if (this.held) {
      this.heard(s, this.held.samples, this.held.loud, false);
      this.held = null;
      this.missed = true;
      if (this.session !== s) return;
    }
    if (detectorFree(this.inFlight ? 1 : 0, this.vadReady)) {
      const id = ++this.frame;
      this.held = { id, sid, samples, loud };
      this.inFlight = true;
      const copy = samples.slice();
      this.vad!.postMessage({ type: "frame", sid, id, gap: this.missed, samples: copy }, [copy.buffer]);
      this.missed = false;
      return;
    }
    this.missed = true;
    this.heard(s, samples, loud, false);
  }

  /** Silero's score for one frame. A frame already flushed (the next one arrived first) is left as loudness scored it. */
  private scoredBack(sid: number, id: number, p: number) {
    const s = this.session;
    if (!s || s.sid !== sid) return;
    this.inFlight = false;
    const held = this.held;
    if (!held || held.id !== id) return;
    this.held = null;
    this.heard(s, held.samples, p >= 0 ? p : held.loud, p >= 0);
  }

  /** A frame and its speech score: feed the segmenter, and act on a start or a finished utterance. */
  private heard(s: Session, samples: Float32Array, p: number, sure: boolean) {
    const strict = s.talk.strict();
    const out = s.seg.push(samples, p, strict);
    if (out === "start") {
      this.state.set({ hearing: true });
      s.talk.onSpeech(sure && strict);
    } else if (out === "pause") {
      // The pause is already the finished clip. Tiny writes it while the pause runs out, so the words are ready when you stop.
      s.guess = this.later(s.seg.clip());
    } else if (out === "resume") {
      s.guess = null;
    } else if (out instanceof Float32Array) {
      this.state.set({ hearing: false });
      this.write(s, s.guess ?? this.later(out));
      s.guess = null;
    }
  }

  /** Transcribe after whatever is already being written, so words come back in the order they were said. */
  private later(clip: Float32Array) {
    const text = this.queue.then(() => this.transcribe(clip));
    this.queue = text.catch(() => undefined);
    return text;
  }

  /** Hand an utterance's words to the caller once written, while the mic keeps listening. */
  private write(s: Session, text: Promise<string>) {
    this.state.set({ writing: ++this.jobs > 0 });
    void text
      .then(
        (text) => {
          if (this.session === s) s.talk.onText(text);
        },
        (error: unknown) => {
          this.state.set({ problem: errorText(error) });
          if (this.session === s) s.talk.onText("");
        },
      )
      .finally(() => this.state.set({ writing: --this.jobs > 0 }));
  }

  /** Close the microphone. Anything still being written down is dropped. The shared audio context stays; the voice uses it. */
  cancel() {
    this.sid++;
    const s = this.session;
    this.session = null;
    this.held = null;
    this.inFlight = false;
    if (s) {
      s.node.port.onmessage = null;
      s.node.disconnect();
      s.src.disconnect();
      s.mute.disconnect();
      s.stream.getTracks().forEach((track) => track.stop());
    }
    this.state.set({ on: false, hearing: false });
  }

  private async transcribe(samples: Float32Array) {
    let worker: Worker;
    try {
      worker = await this.whisper();
    } catch {
      throw new Error("The speech model couldn't load. Check the Speech pill, then try again.");
    }
    const id = ++this.seq;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ type: "transcribe", id, samples }, [samples.buffer]);
    });
  }
}

export const listen = new Listen();
export const canListen = Listen.supported;

export const listenEngine: Engine = {
  name: "Speech",
  detail: "Whisper tiny · on the CPU",
  state: listen.state,
  later: true, // loads when the mic opens. On the CPU, so it never compiles next to SmolLM2.
  start: () => void listen.start().catch(() => undefined),
};
