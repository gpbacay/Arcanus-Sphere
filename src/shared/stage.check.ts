// Run: node src/shared/stage.check.ts   (Node 22.18+ strips the types)
import assert from "node:assert/strict";
import { hideStage, showStage, stageShown, whenShown } from "./stage.ts";

let ran = ""; // who has run, in order

// Anything waiting runs when the stage appears, once, in the order it asked, and not before.
whenShown(() => (ran += "a"));
whenShown(() => (ran += "b"));
assert.equal(ran, "");
assert.equal(stageShown(), false);
showStage();
assert.equal(ran, "ab");
showStage();
assert.equal(ran, "ab"); // a second show runs nothing again

// With the stage already up, a wait runs at once.
whenShown(() => (ran += "c"));
assert.equal(ran, "abc");

// A wait that was cancelled never runs; after the stage is hidden, waits wait for the next one.
hideStage();
assert.equal(stageShown(), false);
const cancel = whenShown(() => (ran += "!"));
whenShown(() => (ran += "d"));
cancel();
assert.equal(ran, "abc");
showStage();
assert.equal(ran, "abcd");

console.log("stage ok");
