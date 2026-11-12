// Run: node src/modules/sphere/pace.check.ts   (Node 22.18+ strips the types)
import assert from "node:assert/strict";
import { Pace, WORK_FPS } from "./pace.ts";

/** Frames drawn in `seconds`, on a machine that can deliver a frame every `every` ms, starting at `from` ms. */
const drawn = (pace: Pace, every: number, cap: number, seconds: number, from = 0) => {
  let n = 0;
  for (let i = 0; i < Math.round((seconds * 1000) / every); i++) if (pace.draw(from + i * every, cap)) n++;
  return n;
};

// A machine that draws the sphere at 60 frames a second is never held back, whatever the models are doing.
const fast = new Pace();
assert.equal(drawn(fast, 1000 / 60, 0, 2), 120);
assert.equal(drawn(fast, 1000 / 60, WORK_FPS, 2, 2000), 120);

// One that manages 30 gives the machine back while a model works, and takes it again afterwards.
const slow = new Pace();
assert.equal(drawn(slow, 1000 / 30, 0, 2), 60);
const working = drawn(slow, 1000 / 30, WORK_FPS, 2, 2000);
assert.ok(working >= 2 * WORK_FPS - 4 && working <= 2 * WORK_FPS, `drew ${working} frames in 2 s of work`);
assert.equal(drawn(slow, 1000 / 30, 0, 2, 4000), 60);

// Coming back to a hidden tab is not taken for a slow machine.
const hidden = new Pace();
drawn(hidden, 1000 / 60, 0, 1);
hidden.draw(60_000, 0);
assert.equal(drawn(hidden, 1000 / 60, WORK_FPS, 1, 60_016), 60);

console.log("pace ok");
