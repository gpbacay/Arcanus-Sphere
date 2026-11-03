// Cutting a live microphone into utterances. Each 32 ms frame comes in with Silero's speech probability; out comes
// "start" when someone is clearly talking, and the clip (with a little sound around it) once they pause. Pure, so
// segment.check.ts runs it in Node.

export const RATE = 16000; // what Whisper and Silero both expect
export const FRAME = 512; // 32 ms: the size Silero scores at a time
const FPS = RATE / FRAME;

const ON = 0.5; // a frame at or above this is speech (Silero's recommended threshold)
const OFF = 0.35; // and speech has to drop below this to count as a pause (Silero's hysteresis: ON - 0.15)
const START = 6; // frames of speech in a row (~0.2 s) before it counts: a click or a cough never does
// While Arcanus is talking, its own voice can leak into the mic: only clear, sustained speech interrupts it.
// ponytail: fixed thresholds. Tune STRICT_* if Arcanus interrupts itself on your speakers, or ignores you.
const STRICT_ON = 0.8;
const STRICT_START = 12; // ~0.4 s
const PAUSE = Math.round(0.7 * FPS); // this long under OFF ends the utterance
const PAD = Math.round(0.3 * FPS); // kept before and after, so the first and last words aren't clipped
const MAX = Math.round(29 * FPS); // Whisper hears 30 s at a time: a longer turn is cut here and the rest is the next

export class Segmenter {
  private frames: Float32Array[] = []; // before a start: the last few frames; after: the utterance so far
  private run = 0; // speech frames in a row, before a start
  private talking = false;
  private quiet = 0; // frames under OFF in a row, after a start

  /** Add one frame and its speech probability. `strict` while Arcanus is speaking. */
  push(frame: Float32Array, p: number, strict = false): "start" | Float32Array | null {
    this.frames.push(frame);
    if (!this.talking) {
      this.run = p >= (strict ? STRICT_ON : ON) ? this.run + 1 : 0;
      if (this.run >= (strict ? STRICT_START : START)) {
        this.talking = true;
        this.quiet = 0;
        this.frames = this.frames.slice(-(PAD + this.run));
        return "start";
      }
      if (this.frames.length > PAD + STRICT_START) this.frames.shift();
      return null;
    }
    this.quiet = p < OFF ? this.quiet + 1 : 0;
    if (this.quiet < PAUSE && this.frames.length < MAX) return null;
    const frames = this.frames.slice(0, this.frames.length - Math.max(0, this.quiet - PAD));
    this.reset();
    const clip = new Float32Array(frames.length * FRAME);
    frames.forEach((f, i) => clip.set(f, i * FRAME));
    return clip;
  }

  reset() {
    this.frames = [];
    this.run = 0;
    this.talking = false;
    this.quiet = 0;
  }
}
