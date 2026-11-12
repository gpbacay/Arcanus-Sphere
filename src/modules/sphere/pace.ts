// The sphere's frame budget. Drawing the sphere and running the models compete for one machine, and on a laptop or a
// phone, where graphics and models share the same memory, the sphere wins: measured on a 12-core laptop with
// integrated graphics, SmolLM2 wrote 2 tokens a second while the sphere drew 30 frames a second, 4 at 15 frames, and
// 10 to 12 at 5. So while a model is working, a sphere that can't reach STRAINED_FPS on its own draws fewer frames
// and gives the machine back. A machine that draws it with room to spare is left alone. Pure, so pace.check.ts runs it.
// ponytail: fixed rates, and "strained" judged by frame rate alone. Tune WORK_FPS and TALK_FPS on the device: lower
// is a faster reply and a choppier sphere.

export const WORK_FPS = 12; // while Arcanus listens, thinks or writes
export const TALK_FPS = 20; // while it speaks and still writes: the sphere moves with the voice, so it keeps more
const STRAINED_FPS = 50;

export class Pace {
  private last = 0; // when the last frame was drawn, ms
  private gap = 1000 / 60; // smoothed ms between frames while nothing holds the sphere back

  /** Whether to draw the frame at `now` (ms). `cap`: the frames a second the models' work leaves room for, 0 for no limit. */
  draw(now: number, cap: number): boolean {
    const held = cap > 0 && this.gap > 1000 / STRAINED_FPS;
    if (held && now - this.last < 1000 / cap - 2) return false; // 2 ms: a frame a hair early still counts
    const dt = now - this.last;
    if (!held && this.last && dt < 250) this.gap += (dt - this.gap) * 0.05; // 250 ms: a hidden tab is not a slow frame
    this.last = now;
    return true;
  }
}
