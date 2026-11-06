// Cutting a live microphone into utterances. Each 32 ms frame comes in with a speech score (Loudness); out comes
// "start" when someone is clearly talking, and the clip (with a little sound around it) once they pause. Pure, so
// segment.check.ts runs it in Node.

export const RATE = 16000; // what Whisper expects
export const FRAME = 512; // 32 ms
const FPS = RATE / FRAME;

const ON = 0.5; // a frame at or above this is speech
const OFF = 0.35; // and speech has to drop below this to count as a pause
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
    // Only clear speech resets the pause: a murmur of room noise between OFF and ON neither ends nor extends the turn.
    this.quiet = p < OFF ? this.quiet + 1 : p >= ON ? 0 : this.quiet;
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

const SILENT = -90; // dBFS: a muted or just-opened mic sends zeros, which say nothing about the room
const WINDOW = Math.round(5 * FPS); // the noise floor is the quietest moment of the last 5 s

/**
 * A speech score in 0..1 from how loud a frame is over the room's noise: no model to download, nothing to run but a sum.
 * The level is smoothed over ~0.1 s, so a click or a tap never counts. The noise floor is the quietest smoothed level
 * of the last 5 s (minimum statistics): talking never lifts it, since there are always gaps between words, while a
 * room that gets louder (a fan, a TV) becomes the new floor within 5 s, so it can't hold the mic open for good.
 * ponytail: plain loudness, so a voice on a TV counts as talk. Tune the 6 / 15 dB if it misses soft voices or hears noise.
 */
export class Loudness {
  private level: number | null = null; // smoothed dBFS
  private recent: number[] = [];

  score(frame: Float32Array) {
    let sum = 0;
    for (const x of frame) sum += x * x;
    const db = 10 * Math.log10(sum / frame.length + 1e-10);
    if (db < SILENT) return 0;
    this.level = this.level === null ? db : this.level + (db - this.level) * 0.3;
    this.recent.push(this.level);
    if (this.recent.length > WINDOW) this.recent.shift();
    return Math.min(1, Math.max(0, (this.level - Math.min(...this.recent) - 6) / 15));
  }
}
