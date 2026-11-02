// Run: node src/modules/brain/tools.check.ts   (Node 22.18+ strips the types)
import assert from "node:assert/strict";
import { calculate, findExpression, tellTime } from "./tools.ts";

assert.equal(findExpression("what's (3 + 4) * 2?"), "(3 + 4) * 2");
assert.equal(findExpression("compute 2^10 please"), "2^10");
assert.equal(findExpression("I have 3 cats"), null);
assert.equal(calculate("(3 + 4) * 2"), "14");
assert.equal(calculate("2^10"), "1024");
assert.equal(calculate("0.1+0.2"), "0.3");
assert.match(calculate("1/0"), /^Error/);
assert.match(calculate("alert(1)"), /^Error/);
assert.equal(tellTime("time in Asia/Tokyo").zone, "Asia/Tokyo");
assert.notEqual(tellTime("time in Mars/Olympus").zone, "Mars/Olympus");
console.log("tools ok");
