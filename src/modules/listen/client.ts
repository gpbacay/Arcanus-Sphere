"use client";

// Speech to text, hands-free and full duplex, all on the device. Tap once and the microphone stays open: the mic is
// captured as 16 kHz frames (an AudioWorklet), Silero VAD (vad.worker.ts) scores each one for speech, the segmenter
// (segment.ts) cuts out each thing you say when you pause, and Whisper (listen.worker.ts) writes it down while the mic
// keeps listening. Speaking while Arcanus talks is reported at once (onSpeech), so the caller can stop it: barge-in.
import { Store, IDLE, errorText, startWorker, type Engine, type LoadState } from "@/shared/store";
import { FRAME, RATE, Segmenter } from "./segment";

export type Talk = {
  /** Someone started speaking (clearly, if Arcanus was talking): stop talking over them. */
  onSpeech: () => void;
  /** What they said, once they paused. Never empty. */
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

type Session = { sid: number; stream: MediaStream; ctx: AudioContext; seg: Segmenter; talk: Talk };

class Listen {
  state = new Store<LoadState & { on: boolean; hearing: boolean; writing: boolean; problem: string }>({
    ...IDLE,
    on: false,
    hearing: false,
    writing: false,
    problem: "",
  });
  private worker: Promise<Worker> | null = null;
  private vad: Promise<Worker> | null = null;
  private pending = new Map<number, Pending>();
  private seq = 0;
  private sid = 0; // bumped by every open and close, so frames and words from an ended session are dropped
  private session: Session | null = null;
  private queue: Promise<unknown> = Promise.resolve(); // one transcription at a time, in the order things were said
  private jobs = 0;

  /** Load Silero VAD (2 MB) and Whisper. Safe to call again; the way to retry after an error. */
  start(): Promise<unknown> {
    const vad = this.startVad();
    vad.catch(() => undefined);
    return Promise.all([this.whisper(), vad]);
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

  private startVad() {
    this.vad ??= new Promise<Worker>((resolve, reject) => {
      const worker = new Worker(new URL("./vad.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = ({ data }) => {
        if (data.type === "ready") resolve(worker);
        else if (data.type === "error") reject(new Error(String(data.message)));
        else if (data.type === "prob") this.scored(data.sid as number, data.samples as Float32Array, data.p as number);
      };
      worker.onerror = (event) => reject(new Error(event.message));
      worker.postMessage({ type: "load", model: new URL("/silero_vad.onnx", location.origin).href });
    });
    this.vad.catch(() => (this.vad = null));
    return this.vad;
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
      let vad: Worker;
      try {
        vad = await this.startVad();
      } catch {
        throw new Error("Arcanus can't tell when you speak: voice detection didn't load. Check the Speech pill, then try again.");
      }
      if (sid !== this.sid) throw new Error("cancelled"); // while the mic was opening: the catch closes it quietly
      vad.postMessage({ type: "reset" });
      const node = new AudioWorkletNode(ctx, "arcanus-frames");
      node.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
        if (sid === this.sid) vad.postMessage({ type: "frame", sid, samples: data }, [data.buffer]);
      };
      const mute = ctx.createGain(); // a worklet only runs while it is connected to the output; silence it
      mute.gain.value = 0;
      ctx.createMediaStreamSource(stream).connect(node).connect(mute).connect(ctx.destination);
      this.session = { sid, stream, ctx, seg: new Segmenter(), talk };
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

  /** One frame was scored: feed the segmenter, and act on a start or a finished utterance. */
  private scored(sid: number, samples: Float32Array, p: number) {
    const s = this.session;
    if (!s || s.sid !== sid) return;
    const out = s.seg.push(samples, p, s.talk.strict());
    if (out === "start") {
      this.state.set({ hearing: true });
      s.talk.onSpeech();
    } else if (out) {
      this.state.set({ hearing: false });
      this.write(s, out);
    }
  }

  /** Transcribe in the background, in order, while the mic keeps listening. */
  private write(s: Session, clip: Float32Array) {
    this.state.set({ writing: ++this.jobs > 0 });
    this.queue = this.queue
      .then(() => this.transcribe(clip))
      .then(
        (text) => {
          if (text && this.session === s) s.talk.onText(text);
        },
        (error: unknown) => this.state.set({ problem: errorText(error) }),
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
  detail: "Whisper base · Silero VAD",
  state: listen.state,
  start: () => void listen.start().catch(() => undefined),
};
