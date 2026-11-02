"use client";

// Speech to text: Whisper runs in its own Web Worker (listen.worker.ts). This is the main-thread side: the microphone,
// recording, and the hand-off of the finished clip. Nothing leaves the device.
import { Store, IDLE, errorText, startWorker, type Engine, type LoadState } from "@/shared/store";

const RATE = 16000; // what Whisper expects
const MIN_SECONDS = 0.4; // shorter than this is a mis-tap
const MAX_SECONDS = 120; // a forgotten recording stops itself
const QUIET = 0.004; // RMS below this is silence: Whisper would invent words for it

type Phase = "idle" | "recording" | "transcribing";
type Pending = { resolve: (text: string) => void; reject: (e: Error) => void };

class Listen {
  state = new Store<LoadState & { phase: Phase; problem: string }>({ ...IDLE, phase: "idle", problem: "" });
  private worker: Promise<Worker> | null = null;
  private pending = new Map<number, Pending>();
  private seq = 0;
  private recorder: MediaRecorder | null = null;
  private timer = 0;
  private cancelled = false;

  start() {
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
    return typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
  }

  /** Start recording from the microphone. Call from a click: the browser asks for permission. `onText` gets the words. */
  async record(onText: (text: string) => void) {
    if (this.state.state.phase !== "idle") return;
    this.cancelled = false;
    this.state.set({ problem: "" });
    void this.start().catch(() => undefined); // load the model while the user talks
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch {
      this.state.set({ problem: "Arcanus can't use the microphone. Allow it in the browser's site settings." });
      return;
    }
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream);
    this.recorder = recorder;
    recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
    recorder.onstop = () => {
      clearTimeout(this.timer);
      stream.getTracks().forEach((track) => track.stop());
      this.recorder = null;
      if (this.cancelled) return this.state.set({ phase: "idle" });
      void this.transcribe(new Blob(chunks, { type: recorder.mimeType })).then(onText, (error: unknown) => this.state.set({ problem: errorText(error) })).finally(() => this.state.set({ phase: "idle" }));
    };
    recorder.start();
    this.timer = window.setTimeout(() => this.stop(), MAX_SECONDS * 1000);
    this.state.set({ phase: "recording" });
  }

  /** Stop recording and transcribe what was said. */
  stop() {
    if (this.state.state.phase !== "recording") return;
    this.state.set({ phase: "transcribing" });
    this.recorder?.stop();
  }

  /** Stop recording and throw the clip away. */
  cancel() {
    this.cancelled = true;
    this.recorder?.stop();
    this.state.set({ phase: "idle" });
  }

  private async transcribe(clip: Blob) {
    const ctx = new AudioContext({ sampleRate: RATE }); // decoding resamples to the context's rate
    let samples: Float32Array;
    try {
      samples = (await ctx.decodeAudioData(await clip.arrayBuffer())).getChannelData(0);
    } finally {
      void ctx.close();
    }
    if (samples.length < MIN_SECONDS * RATE) return "";
    let energy = 0;
    for (const sample of samples) energy += sample * sample;
    if (Math.sqrt(energy / samples.length) < QUIET) return "";
    let worker: Worker;
    try {
      worker = await this.start();
    } catch {
      throw new Error("The speech model couldn't load. Check the Whisper pill, then try again.");
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
  name: "Whisper",
  detail: "tiny.en · ~41 MB",
  state: listen.state,
  start: () => void listen.start().catch(() => undefined),
};
