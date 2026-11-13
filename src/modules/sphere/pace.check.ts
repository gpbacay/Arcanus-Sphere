// Run: node src/modules/sphere/pace.check.ts   (Node 22.18+ strips the types)
import assert from "node:assert/strict";
import { Pace, WORK_FPS } from "./pace.ts";

/** Frames drawn in `seconds`, on a machine that can deliver a frame every `every` ms, starting at `from` ms. */
const drawn = (pace: Pace, every: number, cap: number, seconds: number, from = 0) => {
  let n = 0;
  for (let i = 0; i < Math.round((seconds * 1000) / every); i++) if (pace.draw(from + i * every, cap)) n++;
  return n;
};

// With no model working, every frame is drawn. While one works the sphere is held to the cap, however fast the
// machine draws it, and it takes the machine back afterwards.
for (const fps of [60, 30]) {
  const pace = new Pace();
  assert.equal(drawn(pace, 1000 / fps, 0, 2), 2 * fps);
  const working = drawn(pace, 1000 / fps, WORK_FPS, 2, 2000);
  assert.ok(working >= 2 * WORK_FPS - 4 && working <= 2 * WORK_FPS, `drew ${working} frames in 2 s of work at ${fps} fps`);
  assert.equal(drawn(pace, 1000 / fps, 0, 2, 4000), 2 * fps);
}

console.log("pace ok");
