// Run: node src/modules/voice/text.check.ts   (Node 22.18+ strips the types)
import assert from "node:assert/strict";
import { forSpeech, isEcho, spokenLine, takeSentences, wholeSentences } from "./text.ts";

assert.equal(spokenLine("First sentence. The rest is left for later."), "First sentence.");
assert.equal(spokenLine("x".repeat(300)), `${"x".repeat(217)}…`);
assert.equal(wholeSentences("No full stop yet"), "No full stop yet");

assert.equal(forSpeech("**Hi** see [docs](http://x)."), "Hi see docs.");
// Links are never spelled out: one that only shows where something is goes unsaid, one in a sentence is named.
assert.equal(forSpeech("Opened it in your browser: https://www.youtube.com/results?search_query=asmr"), "Opened it in your browser.");
assert.equal(forSpeech("https://www.youtube.com/results?search_query=asmr"), "");
assert.equal(forSpeech("Read more at https://en.wikipedia.org/wiki/Some_page."), "Read more at wikipedia.");
assert.equal(forSpeech("Try www.github.com/gpbacay or ask me."), "Try github or ask me.");
assert.deepEqual(takeSentences("One. Two! Thr"), { sentences: ["One.", "Two!"], rest: "Thr" });
assert.deepEqual(takeSentences("A long clause, then more", 10), { sentences: ["A long clause,"], rest: "then more" });
assert.deepEqual(takeSentences("Short, still", 80), { sentences: [], rest: "Short, still" });
assert.equal(isEcho("the time is three", "Hello. The time is three fifteen."), true);
assert.equal(isEcho("what is the weather like", "The time is three fifteen."), false);
assert.equal(isEcho("", "Anything."), false);
console.log("speech text ok");
