// Run: node src/modules/workspace/graph.check.ts
// The commit graph's lanes: a straight history, a merge, and two branches from one commit.
import assert from "node:assert/strict";
import { lanes } from "./graph.ts";

// C -> B -> A: one lane, a line between each pair of dots, none above the newest or below the root.
const line = lanes([
  { hash: "C", parents: ["B"] },
  { hash: "B", parents: ["A"] },
  { hash: "A", parents: [] },
]);
assert.equal(line.width, 1);
assert.deepEqual(line.rows.map((r) => r.col), [0, 0, 0]);
assert.deepEqual(line.rows[0].top, []);
assert.deepEqual(line.rows[1].top, [[0, 0]]);
assert.deepEqual(line.rows[2].bottom, []);

// M merges X into B; both come from A.
const merge = lanes([
  { hash: "M", parents: ["B", "X"] },
  { hash: "B", parents: ["A"] },
  { hash: "X", parents: ["A"] },
  { hash: "A", parents: [] },
]);
assert.equal(merge.width, 2);
assert.deepEqual(merge.rows.map((r) => r.col), [0, 0, 1, 0]);
assert.deepEqual(merge.rows[0].bottom, [[0, 0], [0, 1]]); // to B straight down, to X in a second lane
assert.deepEqual(merge.rows[1].bottom, [[1, 1], [0, 0]]); // X's lane goes on beside B's line to A
assert.deepEqual(merge.rows[3].top, [[0, 0], [1, 0]]); // both lanes end at A

// Two branch tips (main and feature) with a shared parent: the second tip opens its own lane.
const tips = lanes([
  { hash: "F", parents: ["A"] },
  { hash: "M", parents: ["A"] },
  { hash: "A", parents: [] },
]);
assert.deepEqual(tips.rows.map((r) => r.col), [0, 1, 0]);
assert.deepEqual(tips.rows[1].top, [[0, 0]]); // F's lane passes M, nothing comes down to M
assert.deepEqual(tips.rows[2].top, [[0, 0], [1, 0]]);

console.log("graph ok");
