// The sphere's frame budget. Drawing the sphere and running the models compete for one machine, and on a laptop or a
// phone, where graphics and models share the same memory, the sphere wins: measured on a 12-core laptop with
// integrated graphics, SmolLM2 wrote 2 tokens a second while the sphere drew 30 frames a second, 4 at 15 frames, and
// 10 to 12 at 5. So while a model is working the sphere draws fewer frames and gives the machine back.
//
// This used to hold back only a sphere that could not reach 50 frames a second on its own. Measured again on the
// same laptop: a sphere drawing at full rate with room to spare still left SmolLM2 at 1.2 to 1.8 tokens a second,
// against 5 to 8 with the sphere held. How fast the sphere draws says nothing about what it costs the models, so it
// is held whenever one works. Pure, so pace.check.ts runs it.
// ponytail: fixed rates. Tune WORK_FPS and TALK_FPS on the device: lower is a faster reply and a choppier sphere.

export const WORK_FPS = 12; // while Arcanus loads, listens, thinks or writes
export const TALK_FPS = 20; // while it speaks and still writes: the sphere moves with the voice, so it keeps more

export class Pace {
  private last = 0; // when the last frame was drawn, ms

  /** Whether to draw the frame at `now` (ms). `cap`: the frames a second the models' work leaves room for, 0 for no limit. */
  draw(now: number, cap: number): boolean {
    if (cap > 0 && now - this.last < 1000 / cap - 2) return false; // 2 ms: a frame a hair early still counts
    this.last = now;
    return true;
  }
}
