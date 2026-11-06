// Run: node src/modules/listen/segment.check.ts   (Node 22.18+ strips the types)
import assert from "node:assert/strict";
import { FRAME, Loudness, Segmenter } from "./segment.ts";

const run = (probs: number[], strict = false) => {
  const seg = new Segmenter();
  return probs.map((p, i) => seg.push(new Float32Array(FRAME).fill(i), p, strict)).flatMap((out, i) => (out ? [[i, out] as const] : []));
};
const s = (n: number, p: number) => Array<number>(n).fill(p);

// 1 s quiet, 1 s speech, 1 s quiet: one start, then one clip of the speech with ~0.3 s either side.
const events = run([...s(31, 0), ...s(31, 0.9), ...s(31, 0)]);
assert.equal(events.length, 2);
assert.deepEqual(events[0], [36, "start"]);
const clip = events[1][1] as Float32Array;
assert.equal(clip.length / FRAME, 9 + 31 + 9);
assert.equal(clip[0], 22); // the first frame kept is 9 before the speech
assert.equal(clip[clip.length - 1], 70); // the last is 9 after it

// A 0.1 s blip is not speech; a dip mid-sentence (above OFF) doesn't end it.
assert.equal(run([...s(10, 0), ...s(3, 0.9), ...s(40, 0)]).length, 0);
assert.equal(run([...s(10, 0.9), ...s(30, 0.4), ...s(10, 0.9)]).length, 1);

// While Arcanus speaks, middling probabilities (its echo) never start an utterance; clear speech does.
assert.equal(run(s(60, 0.7), true).length, 0);
assert.equal(run(s(60, 0.95), true)[0][1], "start");
// Room noise flickering between OFF and ON after speech still ends the turn.
assert.equal(run([...s(10, 0.9), ...Array.from({ length: 60 }, (_, i) => (i % 2 ? 0.45 : 0.1))]).length, 2);

// Loudness: a quiet room scores as silence, a voice 30 dB over it as speech, and back to quiet as silence again.
const loud = new Loudness();
const tone = (amp: number) => Float32Array.from({ length: FRAME }, (_, i) => amp * Math.sin(i / 3));
const quiet = tone(0.001);
const feed = (frame: Float32Array, n: number) => Array.from({ length: n }, () => loud.score(frame)).at(-1)!;
assert.ok(feed(quiet, 20) < 0.35);
assert.ok(loud.score(tone(0.05)) < 0.5, "one loud frame (a click) is not speech");
assert.ok(feed(tone(0.05), 5) >= 0.8);
assert.ok(feed(tone(0.05), 60) >= 0.5, "talking must not lift the floor to itself");
assert.ok(feed(quiet, 10) < 0.35);
// A fan switched on: loud at first, then the new floor within ~5 s, so it can't hold the mic open.
assert.ok(feed(tone(0.01), 10) >= 0.5);
assert.ok(feed(tone(0.01), 200) < 0.35);
// Digital silence (a muted mic) doesn't drag the floor down, or the room would score as speech after it.
feed(new Float32Array(FRAME), 30);
assert.ok(loud.score(tone(0.01)) < 0.35);
console.log("segment ok");
