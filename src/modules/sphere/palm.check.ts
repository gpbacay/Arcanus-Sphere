// Run: node src/modules/sphere/palm.check.ts   (Node 22.18+ strips the types)
import assert from "node:assert/strict";
import { frameToNdc, isOpen, OneEuro, palmCentre, palmDepth, type Hand } from "./palm.math.ts";

// A flat hand: knuckles 8 cm across, fingers 7 cm past them, wrist 9 cm back. Metres, y down.
const shape = (fist = false) => {
  const world = new Float32Array(42);
  const set = (i: number, x: number, y: number) => ((world[2 * i] = x), (world[2 * i + 1] = y));
  set(0, 0, 0.05);
  [5, 9, 13, 17].forEach((k, n) => {
    const x = -0.03 + n * 0.02;
    set(k, x, -0.04);
    set(k + 1, x, -0.07); // middle joint
    set(k + 3, x, fist ? 0 : -0.11); // tip: out past the joint, or curled back toward the wrist
  });
  return world;
};
const project = (world: Float32Array, z: number, focal: number, frameW: number, frameH: number): Hand => {
  const points = new Float32Array(42);
  for (let i = 0; i < 21; i++) {
    // frame is as tall as the screen here, so the screen's half height is frameH / 2
    points[2 * i] = 0.5 + (world[2 * i] * focal * (frameH / 2)) / z / frameW;
    points[2 * i + 1] = 0.5 + (world[2 * i + 1] * focal * (frameH / 2)) / z / frameH;
  }
  return { points, world };
};

const FOCAL = 1.7;
for (const z of [0.25, 0.4, 0.7]) {
  const hand = project(shape(), z, FOCAL, 180, 320);
  const got = palmDepth(hand, 180, 320, 320, FOCAL)!;
  assert.ok(Math.abs(got - z) < 0.01, `depth ${got} vs ${z}`);
}
assert.equal(palmDepth(project(shape(), 5, FOCAL, 180, 320), 180, 320, 320, FOCAL), null); // too far to be a hand held out

assert.ok(isOpen(project(shape(), 0.4, FOCAL, 180, 320), 180, 320));
assert.ok(!isOpen(project(shape(true), 0.4, FOCAL, 180, 320), 180, 320)); // fingers curled in

// Cover-fit: a 180x320 frame on a 400x400 screen is cropped top and bottom; the middle stays in the middle.
const [cx, cy] = frameToNdc(0.5, 0.5, 180, 320, 400, 400);
assert.ok(Math.abs(cx) < 1e-9 && Math.abs(cy) < 1e-9);
const [, top] = frameToNdc(0.5, 0, 180, 320, 400, 400);
assert.ok(top > 1); // the frame's top edge is cropped off-screen
const [u, v] = palmCentre(project(shape(), 0.4, FOCAL, 180, 320));
assert.ok(Math.abs(u - 0.5) < 0.02 && v > 0.4 && v < 0.6);

// The filter settles on a still value, and keeps up with a moving one.
const still = new OneEuro();
let out = 0;
for (let i = 0; i < 60; i++) out = still.filter(1 + (i % 2 ? 0.002 : -0.002), i / 30);
assert.ok(Math.abs(out - 1) < 0.002);
const moving = new OneEuro();
for (let i = 0; i < 30; i++) out = moving.filter(i * 0.02, i / 30); // 0.6 m/s
assert.ok(0.58 - out < 0.06, `lag ${0.58 - out}`);
console.log("palm ok");
