// Run: node src/modules/voice/text.check.ts   (Node 22.18+ strips the types)
import assert from "node:assert/strict";
import { finishGreeting, forSpeech, isEcho, isIntroduction, spokenLine, takeSentences, wholeSentences } from "./text.ts";

assert.equal(spokenLine("First sentence. The rest is left for later."), "First sentence.");
assert.equal(spokenLine("x".repeat(300)), `${"x".repeat(217)}…`);
assert.equal(wholeSentences("No full stop yet"), "No full stop yet");

assert.equal(forSpeech("**Hi** see [docs](http://x)."), "Hi see docs.");
// Links are never spelled out: one that only shows where something is goes unsaid, one in a sentence is named.
assert.equal(forSpeech("Opened it in your browser: https://www.youtube.com/results?search_query=asmr"), "Opened it in your browser.");
assert.equal(forSpeech("https://www.youtube.com/results?search_query=asmr"), "");
assert.equal(forSpeech("Read more at https://en.wikipedia.org/wiki/Some_page."), "Read more at wikipedia.");
assert.equal(forSpeech("Try www.github.com/gpbacay or ask me."), "Try github or ask me.");
assert.equal(isIntroduction("Good day, how can I help you?"), false);
assert.equal(isIntroduction("Hello, I am Arcanus. How can I help?"), true);
assert.equal(isIntroduction("I am Arcanus, created by Gianne Bacay. How can I help?"), true);
assert.equal(isIntroduction("I am Arcanus, a new member of the team."), false);
assert.equal(isIntroduction("Hello, I am Arcanus."), true);
assert.equal(isIntroduction("Thank you!"), false);
// It has to name itself, not just mention its name.
assert.equal(isIntroduction("Arcanus Good Morning."), false);
assert.equal(isIntroduction("Good morning, I'm Arcanus. How can I help?"), true);
// The greeting: the opening Arcanus started with plus SmolLM2's words, cut after the second sentence.
assert.equal(finishGreeting("Good morning, I'm Arcanus", "! How can I help you today? I can also do math."), "Good morning, I'm Arcanus! How can I help you today?");
assert.equal(finishGreeting("Hello, I'm Arcanus", ', *glows* the sphere in your browser. "What shall we do?"'), "Hello, I'm Arcanus, the sphere in your browser. What shall we do?");
assert.equal(finishGreeting("Good evening, I'm Arcanus", ""), "Good evening, I'm Arcanus.");
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
