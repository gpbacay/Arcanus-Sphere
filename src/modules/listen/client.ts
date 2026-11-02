"use client";

// Speech to text. The words come from the browser's own speech recognition (SpeechRecognition), the same as Gianne's
// portfolio chat. The microphone is also captured as 16 kHz frames (an AudioWorklet) and Silero VAD (vad.worker.ts) scores
// each frame for speech, which lets Arcanus stop on its own when you pause. Where the browser has no speech recognition,
// or it hears nothing, Whisper (listen.worker.ts) writes down the clip VAD cut out, on the device.
import { Store, IDLE, errorText, startWorker, type Engine, type LoadState } from "@/shared/store";

const RATE = 16000; // what Whisper and Silero both expect
const FRAME = 512; // 32 ms: the size Silero scores at a time
const FPS = RATE / FRAME;
const SPEECH = 0.5; // a frame at or above this is speech (Silero's recommended threshold)
const PAUSE_FRAMES = Math.round(1.0 * FPS); // this long without speech, after speech, ends the recording
const IDLE_FRAMES = Math.round(10 * FPS); // this long with no speech at all, and it gives up
const PAD_FRAMES = Math.round(0.3 * FPS); // kept around the speech so the first and last words aren't clipped
const MAX_FRAMES = Math.round(120 * FPS); // a forgotten recording stops itself
const QUIET = 0.004; // without VAD: RMS below this is silence, and Whisper would invent words for it

type Phase = "idle" | "recording" | "transcribing";

// The browser's speech recognition. Chrome and Safari have it (Safari and older Chrome under a webkit prefix).
interface Recognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}
const recognitionClass = () => {
  const w = window as typeof window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

/** One run of the browser's recognizer. `text` is everything it has heard so far; `done` settles when it ends. */
type Heard = { text: string; failed: boolean; done: Promise<void>; stop: () => void; abort: () => void };
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
        if (this.n === ${FRAME}) { this.port.postMessage(this.out.slice()); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor("arcanus-frames", Frames);
`;

type Session = {
  stream: MediaStream;
  ctx: AudioContext;
  frames: Float32Array[];
  heard: Heard | null;
  vad: Worker | null;
  first: number; // index of the first frame of speech, -1 until there is some
  last: number; // index of the latest frame of speech
  onText: (text: string) => void;
};

class Listen {
  state = new Store<LoadState & { phase: Phase; problem: string; heard: boolean }>({ ...IDLE, phase: "idle", problem: "", heard: false });
  private worker: Promise<Worker> | null = null;
  private vad: Promise<Worker> | null = null;
  private pending = new Map<number, Pending>();
  private seq = 0;
  private session: Session | null = null;
  private aborted = false; // stopped before the microphone was even open

  /** Get ready. With the browser's recognizer there is only Silero VAD (2 MB) to load; Whisper waits until it is needed. */
  start(): Promise<unknown> {
    const vad = this.startVad();
    vad.catch(() => undefined);
    if (!recognitionClass()) return this.whisper();
    if (this.state.state.status === "idle") this.state.set({ status: "loading" });
    return vad
      .catch(() => undefined) // without VAD it still records: stop by tapping
      .then(() => {
        if (!this.worker && this.state.state.status !== "error") this.state.set({ status: "ready", device: "browser" });
      });
  }

  /** The Whisper fallback. */
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
        else if (data.type === "prob") this.heard(data.i as number, data.p as number);
      };
      worker.onerror = (event) => reject(new Error(event.message));
      worker.postMessage({ type: "load", model: new URL("/silero_vad.onnx", location.origin).href });
    });
    this.vad.catch(() => (this.vad = null));
    return this.vad;
  }

  /** Start the browser's recognizer. Null when there is none, or it won't start: Whisper then takes the clip. */
  private listenInBrowser(): Heard | null {
    const Class = recognitionClass();
    if (!Class) return null;
    let finish = () => {};
    const heard: Heard = { text: "", failed: false, done: new Promise<void>((resolve) => (finish = resolve)), stop: () => {}, abort: () => {} };
    try {
      const rec = new Class();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = navigator.language || "en-US";
      rec.onresult = ({ results }) => {
        let text = "";
        for (let i = 0; i < results.length; i++) text += results[i][0]?.transcript ?? "";
        heard.text = text.trim();
      };
      rec.onerror = ({ error }) => {
        if (error !== "no-speech" && error !== "aborted") heard.failed = true; // network, audio-capture, not-allowed...
      };
      rec.onend = finish;
      heard.stop = () => rec.stop();
      heard.abort = () => {
        rec.onresult = null;
        try {
          rec.abort();
        } catch {
          /* already over */
        }
        finish();
      };
      rec.start();
    } catch {
      return null;
    }
    return heard;
  }

  /** Whether this browser can record at all. */
  static supported() {
    return typeof AudioWorklet !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
  }

  /** Start listening. Call from a click: the browser asks for the microphone. `onText` gets the words. */
  async record(onText: (text: string) => void) {
    if (this.state.state.phase !== "idle") return;
    this.aborted = false;
    this.state.set({ problem: "", heard: false, phase: "recording" });
    void this.start().catch(() => undefined);
    const heard = this.listenInBrowser(); // started right in the tap, which is when browsers allow it
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext(); // made here, inside the click, because Safari only lets a gesture start audio
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      await ctx.resume();
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
      await ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
      const vad = await this.startVad().catch(() => null); // without VAD it still records: stop by tapping
      vad?.postMessage({ type: "reset" });
      const session: Session = { stream, ctx, frames: [], heard, vad, first: -1, last: -1, onText };
      const node = new AudioWorkletNode(ctx, "arcanus-frames");
      node.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
        if (this.session !== session) return;
        const i = session.frames.push(data) - 1;
        vad?.postMessage({ type: "frame", i, samples: data.slice() });
        if (i >= MAX_FRAMES) this.stop();
      };
      const mute = ctx.createGain(); // a worklet only runs while it is connected to the output; silence it
      mute.gain.value = 0;
      ctx.createMediaStreamSource(stream).connect(node).connect(mute).connect(ctx.destination);
      this.session = session;
      if (this.aborted) {
        heard?.abort();
        this.take(session);
      }
    } catch {
      heard?.abort();
      stream?.getTracks().forEach((track) => track.stop());
      void ctx?.close();
      this.state.set({ phase: "idle", problem: "Arcanus can't use the microphone. Allow it in the browser's site settings." });
    }
  }

  /** One frame was scored: note the speech, and stop once you have spoken and then paused. */
  private heard(i: number, p: number) {
    const s = this.session;
    if (!s) return;
    if (p >= SPEECH) {
      if (s.first < 0) {
        s.first = i;
        this.state.set({ heard: true });
      }
      s.last = i;
    } else if (s.first >= 0 ? i - s.last >= PAUSE_FRAMES : i >= IDLE_FRAMES) this.stop();
  }

  /** Stop listening and write down what was said. */
  stop() {
    const s = this.session;
    if (!s) return this.cancel();
    this.state.set({ phase: "transcribing" });
    const clip = this.take(s);
    void this.finish(s, clip)
      .then(
        (text) => {
          if (!text && s.vad) this.state.set({ problem: "I didn't catch anything. Tap the mic and try again." });
          s.onText(text);
        },
        (error: unknown) => this.state.set({ problem: errorText(error) }),
      )
      .finally(() => this.state.set({ phase: "idle", heard: false }));
  }

  /** Stop listening and throw the recording away. */
  cancel() {
    const s = this.session;
    if (!s) this.aborted = true;
    else {
      s.heard?.abort();
      this.take(s);
    }
    this.state.set({ phase: "idle", heard: false });
  }

  /** Close the microphone and return the clip: just the speech, with a little around it, when VAD found some. */
  private take(s: Session) {
    this.session = null;
    s.stream.getTracks().forEach((track) => track.stop());
    void s.ctx.close();
    let frames = s.frames;
    if (s.vad) frames = s.first < 0 ? [] : frames.slice(Math.max(0, s.first - PAD_FRAMES), s.last + PAD_FRAMES + 1);
    const clip = new Float32Array(frames.length * FRAME);
    frames.forEach((frame, i) => clip.set(frame, i * FRAME));
    return clip;
  }

  /** The words: from the browser's recognizer when it heard something, else Whisper writes down the clip. */
  private async finish(s: Session, clip: Float32Array) {
    const heard = s.heard;
    if (heard && !heard.failed) {
      heard.stop(); // lets it finish the last words
      await Promise.race([heard.done, new Promise((resolve) => setTimeout(resolve, 4000))]);
      if (heard.text) return heard.text;
    }
    heard?.abort();
    return this.transcribe(clip, s.vad !== null);
  }

  private async transcribe(samples: Float32Array, voiced: boolean) {
    if (samples.length < 0.3 * RATE) return "";
    if (!voiced) {
      let energy = 0;
      for (const sample of samples) energy += sample * sample;
      if (Math.sqrt(energy / samples.length) < QUIET) return "";
    }
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
  detail: "browser · Silero VAD",
  state: listen.state,
  start: () => void listen.start().catch(() => undefined),
};
