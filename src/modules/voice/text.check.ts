// Run: node src/modules/voice/text.check.ts   (Node 22.18+ strips the types)
import assert from "node:assert/strict";
import { forSpeech, openingLine, takeSentences } from "./text.ts";

assert.equal(forSpeech("**Hi** see [docs](http://x)."), "Hi see docs.");
assert.equal(openingLine('"Yes. Good day, how can I help you?"'), "Good day, how can I help you?");
assert.equal(openingLine("Arcanus: Hello, how can I help you?"), "Hello, how can I help you?");
assert.equal(openingLine("  hello there"), "hello there");
assert.deepEqual(takeSentences("One. Two! Thr"), { sentences: ["One.", "Two!"], rest: "Thr" });
assert.deepEqual(takeSentences("A long clause, then more", 10), { sentences: ["A long clause,"], rest: "then more" });
assert.deepEqual(takeSentences("Short, still", 80), { sentences: [], rest: "Short, still" });
console.log("speech text ok");
