// Run: node src/modules/voice/text.check.ts   (Node 22.18+ strips the types)
import assert from "node:assert/strict";
import { forSpeech, takeSentences } from "./text.ts";

assert.equal(forSpeech("**Hi** see [docs](http://x)."), "Hi see docs.");
assert.deepEqual(takeSentences("One. Two! Thr"), { sentences: ["One.", "Two!"], rest: "Thr" });
assert.deepEqual(takeSentences("A long clause, then more", 10), { sentences: ["A long clause,"], rest: "then more" });
assert.deepEqual(takeSentences("Short, still", 80), { sentences: [], rest: "Short, still" });
console.log("speech text ok");
