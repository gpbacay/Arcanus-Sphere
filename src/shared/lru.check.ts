// Run: node src/shared/lru.check.ts   (Node 22.18+ strips the types)
import assert from "node:assert/strict";
import { Lru } from "./lru.ts";

const lru = new Lru<string, number>(2);
lru.set("a", 1).set("b", 2);
assert.equal(lru.get("a"), 1); // "a" is now the most recent
lru.set("c", 3); // evicts "b", the least recent
assert.deepEqual([...lru.keys()], ["a", "c"]);
assert.equal(lru.get("b"), undefined);
lru.set("a", 10); // overwriting refreshes, never grows past max
assert.deepEqual([...lru.entries()], [["c", 3], ["a", 10]]);
console.log("lru ok");
