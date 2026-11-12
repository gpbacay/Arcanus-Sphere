// Run: node src/modules/brain/tools.check.ts   (Node 22.18+ strips the types)
import assert from "node:assert/strict";
import { calculate, findExpression, numerals, spoken, tellTime, zoneFor } from "./tools.ts";

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
// Arithmetic said aloud: a speech model writes the numbers as words.
assert.equal(numerals("three hundred and five, twenty-one and nineteen"), "305, 21 and 19");
assert.equal(numerals("two thousand twenty six"), "2026");
assert.equal(calculate(findExpression("Stop, tell me what is twelve times seven.")!), "84");
assert.equal(findExpression("what is nine plus ten"), "9 + 10");
assert.equal(findExpression("tell me one thing about the sea"), null);

assert.equal(tellTime("time in Asia/Tokyo").zone, "Asia/Tokyo");
assert.equal(zoneFor("new york"), "America/New_York");
assert.equal(zoneFor("Tokyo"), "Asia/Tokyo");
assert.equal(zoneFor("narnia"), null);
assert.equal(tellTime("what time is it", new Date(), "Europe/London").zone, "Europe/London");
assert.notEqual(tellTime("time in Mars/Olympus").zone, "Mars/Olympus");
// Clock facts stay separate so the language model can answer only what was asked (see ONLY_ASKED).
const noon = new Date("2026-11-12T12:00:00Z");
const clock = tellTime("what time is it", noon, "UTC");
assert.equal(clock.zone, "UTC");
assert.match(clock.time, /\d/);
assert.match(clock.date, /November|2026/i);
assert.match(clock.text, /November|2026/i);
console.log("tools ok");
