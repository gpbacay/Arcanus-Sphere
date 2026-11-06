"use client";

// Speech to text, hands-free and full duplex, all on the device. Tap once and the microphone stays open: the mic is
// captured as 16 kHz frames (an AudioWorklet), each is scored for speech by Silero VAD in its own worker (vad.worker.ts;
// by its loudness, Loudness in segment.ts, until that has loaded or if it can't), the segmenter
// (segment.ts) cuts out each thing you say when you pause, and Whisper (listen.worker.ts) writes it down while the mic
// keeps listening. Speaking while Arcanus talks is reported at once (onSpeech), so the caller can turn it down, and
// stop it once the words show it was you, not noise or its own echo: barge-in.
// Two things keep it quick. Whisper starts on what you said as soon as you start to pause, so by the time the pause
// counts as the end of your turn the words are mostly written (a pause you talk on from is thrown away). And talking
// over Arcanus is written down after about a second (onWords), so it can stop then, not only once you've finished.
import { Store, IDLE, errorText, startWorker, type Engine, type LoadState } from "@/shared/store";
import { FPS, FRAME, Loudness, RATE, Segmenter } from "./segment";

export type Talk = {
  /** Someone may have started speaking (or it's Arcanus's own echo): turn down, the words will tell. */
  onSpeech: () => void;
  /** The first second or so of what was said over Arcanus, while they keep talking: enough to tell if it's them. */
  onWords: (text: string) => void;
  /** What they said, once they paused. Empty when it was noise or couldn't be written down. */
  onText: (text: string) => void;
  /** True while Arcanus is speaking, so its own voice leaking into the mic needs more to count as speech. */
  strict: () => boolean;
};

type Pending = { resolve: (text: string) => void; reject: (e: Error) => void };

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

// Talking over Arcanus is written down this long after it counts as speech (which already took ~0.4 s).
const PEEK = Math.round(0.8 * FPS);

type Session = {
  sid: number;
  stream: MediaStream;
  ctx: AudioContext;
  seg: Segmenter;
  loud: Loudness;
  talk: Talk;
  /** Words for the pause going on now, written while it runs out. */
  guess: Promise<string> | null;
  /** Frames left until the words said over Arcanus are written down; 0 when not waiting to. */
  peek: number;
  /** Frames sent to the voice detector and not scored yet, oldest first. */
  waiting: Float32Array[];
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

  /** Load Whisper. Safe to call again; the way to retry after an error. */
  start(): Promise<unknown> {
    return this.whisper();
  }

  private whisper() {
    this.worker ??= startWorker(this.state, () => new Worker(new URL("./listen.worker.ts", import.meta.url), { type: "module" }), (data) => {
      const job = this.pending.get(data.id as number);
      if (!job) return;
      this.pending.delete(data.id as number);
      if (data.type === "text") job.resolve(data.text as string);
      else if (data.type === "error") job.reject(new Error(String(data.message)));
    });
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
    this.state.set({ on: true, hearing: false, problem: "" });
    void this.start().catch(() => undefined);
    this.detector();
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext(); // made here, inside the click, because Safari only lets a gesture start audio
      stream = await navigator.mediaDevices.getUserMedia({
        // echo cancellation takes Arcanus's own voice out of the mic, as far as the browser can
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      await ctx.resume();
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
      await ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
      if (sid !== this.sid) throw new Error("cancelled"); // while the mic was opening: the catch closes it quietly
      const node = new AudioWorkletNode(ctx, "arcanus-frames");
      node.port.onmessage = ({ data }: MessageEvent<Float32Array>) => this.scored(sid, data);
      const mute = ctx.createGain(); // a worklet only runs while it is connected to the output; silence it
      mute.gain.value = 0;
      ctx.createMediaStreamSource(stream).connect(node).connect(mute).connect(ctx.destination);
      this.session = { sid, stream, ctx, seg: new Segmenter(), loud: new Loudness(), talk, guess: null, peek: 0, waiting: [] };
      this.session.seg.fast = this.vadReady;
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      void ctx?.close();
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
      if (this.session) {
        this.session.waiting = [];
        this.session.seg.fast = false;
      }
    };
    worker.onerror = drop;
    worker.onmessage = ({ data }: MessageEvent<{ type: string; sid?: number; p?: number }>) => {
      if (data.type === "ready") {
        this.vadReady = true;
        if (this.session) this.session.seg.fast = true;
      } else if (data.type === "error") drop();
      else if (data.type === "p") {
        const s = this.session;
        const frame = s && s.sid === data.sid ? s.waiting.shift() : undefined;
        if (s && frame) this.heard(s, frame, data.p! >= 0 ? data.p! : s.loud.score(frame));
      }
    };
    worker.postMessage({ type: "load" });
  }

  /** One frame came in: have it scored, then hear it. */
  private scored(sid: number, samples: Float32Array) {
    const s = this.session;
    if (!s || s.sid !== sid) return;
    if (this.vadReady) {
      s.waiting.push(samples);
      this.vad!.postMessage({ type: "frame", sid, samples: samples.slice() }); // a copy: the segmenter keeps this one
    } else this.heard(s, samples, s.loud.score(samples));
  }

  /** A frame and its speech score: feed the segmenter, and act on a start or a finished utterance. */
  private heard(s: Session, samples: Float32Array, p: number) {
    const strict = s.talk.strict();
    const out = s.seg.push(samples, p, strict);
    if (out === "start") {
      this.state.set({ hearing: true });
      s.peek = strict ? PEEK : 0;
      s.talk.onSpeech();
    } else if (out === "pause") {
      // ponytail: only on WebGPU, where a guess thrown away costs ~0.3 s. On the CPU it could hold up the next one.
      if (this.state.state.device === "webgpu") s.guess = this.later(s.seg.clip());
    } else if (out === "resume") {
      s.guess = null;
    } else if (out) {
      this.state.set({ hearing: false });
      s.peek = 0;
      this.write(s, s.guess ?? this.later(out));
      s.guess = null;
    }
    if (s.peek && !--s.peek) {
      void this.later(s.seg.clip()).then(
        (text) => this.session === s && s.talk.onWords(text),
        () => undefined,
      );
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

  /** Close the microphone. Anything still being written down is dropped. */
  cancel() {
    this.sid++;
    const s = this.session;
    this.session = null;
    s?.stream.getTracks().forEach((track) => track.stop());
    void s?.ctx.close();
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
  detail: "Whisper base",
  state: listen.state,
  start: () => void listen.start().catch(() => undefined),
};
