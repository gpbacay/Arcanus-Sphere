// Run: node src/modules/brain/tools.check.ts   (Node 22.18+ strips the types)
import assert from "node:assert/strict";
import { calculate, findExpression, spoken, tellTime, zoneFor } from "./tools.ts";

assert.equal(findExpression("what's (3 + 4) * 2?"), "(3 + 4) * 2");
assert.equal(findExpression("compute 2^10 please"), "2^10");
assert.equal(findExpression("I have 3 cats"), null);
assert.equal(calculate("(3 + 4) * 2"), "14");
assert.equal(calculate("2^10"), "1024");
assert.equal(calculate("0.1+0.2"), "0.3");
assert.match(calculate("1/0"), /^Error/);
assert.match(calculate("alert(1)"), /^Error/);
// Arithmetic in words.
assert.equal(findExpression("multiply 6 by 7"), "6 * 7");
assert.equal(findExpression("how much is 9 times 8"), "9 * 8");
assert.equal(findExpression("add 120 and 80"), "120 + 80");
assert.equal(findExpression("subtract 17 from 45"), "45 - 17");
assert.equal(findExpression("divide 81 by 9"), "81 / 9");
assert.equal(calculate(findExpression("what is 2 to the power of 8")!), "256");
assert.equal(calculate(findExpression("what is 15% of 200")!), "30");
assert.equal(findExpression("I'll be there in 5 minutes"), null);
assert.equal(spoken("the x factor"), "the x factor");

assert.equal(tellTime("time in Asia/Tokyo").zone, "Asia/Tokyo");
assert.equal(zoneFor("new york"), "America/New_York");
assert.equal(zoneFor("Tokyo"), "Asia/Tokyo");
assert.equal(zoneFor("narnia"), null);
assert.equal(tellTime("what time is it", new Date(), "Europe/London").zone, "Europe/London");
assert.notEqual(tellTime("time in Mars/Olympus").zone, "Mars/Olympus");
console.log("tools ok");
