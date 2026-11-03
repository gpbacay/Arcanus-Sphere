// Run: node src/modules/voice/text.check.ts   (Node 22.18+ strips the types)
import assert from "node:assert/strict";
import { forSpeech, isEcho, isIntroduction, openingLine, takeSentences } from "./text.ts";

assert.equal(forSpeech("**Hi** see [docs](http://x)."), "Hi see docs.");
assert.equal(openingLine('"Yes. Good day, how can I help you?"'), "Good day, how can I help you?");
assert.equal(openingLine("Arcanus: Hello, how can I help you?"), "Hello, how can I help you?");
assert.equal(openingLine("  hello there"), "hello there");
assert.equal(isIntroduction("Good day, how can I help you?"), false);
assert.equal(isIntroduction("Hello, I am Arcanus. How can I help?"), true);
assert.equal(isIntroduction("I am Arcanus, created by Gianne Bacay. How can I help?"), true);
assert.equal(isIntroduction("I am Arcanus, a new member of the team."), false);
assert.equal(isIntroduction("Hello, I am Arcanus."), true);
assert.equal(isIntroduction("Thank you!"), false);
assert.equal(isIntroduction("I hope to hear from you soon."), false);
assert.equal(isIntroduction("I'm glad to be of some help."), false);
assert.equal(isIntroduction("We've been up for a few minutes but so far it's all settled down."), false);
assert.deepEqual(takeSentences("One. Two! Thr"), { sentences: ["One.", "Two!"], rest: "Thr" });
assert.deepEqual(takeSentences("A long clause, then more", 10), { sentences: ["A long clause,"], rest: "then more" });
assert.deepEqual(takeSentences("Short, still", 80), { sentences: [], rest: "Short, still" });
assert.equal(isEcho("the time is three", "Hello. The time is three fifteen."), true);
assert.equal(isEcho("what is the weather like", "The time is three fifteen."), false);
assert.equal(isEcho("", "Anything."), false);
console.log("speech text ok");
