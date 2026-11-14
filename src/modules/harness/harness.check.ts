// Run: node src/modules/harness/harness.check.ts   (Node 22.18+ strips the types)
import assert from "node:assert/strict";
import { addressed, answersCall, argsFor, asSelf, assemble, BUILT_IN_GUARDRAILS, callTool, stripComments, featuresReply, greeting, identityBrief, introduction, keepPronouns, keepYears, liveTurns, LIVE_SYSTEM, matchTool, ONLY_ASKED, parseAgents, parseMcpBody, parseSkill, PERSONALITY_REPLIES, personalityReply, registerPlugin, slug } from "./index.ts";

assert.equal(slug("  Explain Like I'm 5! "), "explain-like-i-m-5");
assert.deepEqual(parseSkill("---\nname: ELI5\ndescription: \"Explain simply\"\n---\n<!-- for you -->\nUse small words.\n", "x"), {
  name: "eli5",
  description: "Explain simply",
  body: "Use small words.",
});
assert.deepEqual(parseSkill("Answer as a pirate.\nAlways.", "Pirate Talk"), { name: "pirate-talk", description: "Answer as a pirate.", body: "Answer as a pirate.\nAlways." });

const fit = assemble(
  [
    { label: "rules", text: "be brief", priority: 1 },
    { label: "page", text: `${"a".repeat(60)}\n${"b".repeat(200)}`, priority: 2 },
    { label: "empty", text: "  ", priority: 0 },
    { label: "skill", text: "s".repeat(40), priority: 0 },
    { label: "memory", text: "m".repeat(50), priority: 3 },
  ],
  150
);
assert.deepEqual(fit.sections.map((s) => s.label), ["rules", "page", "skill"]); // order kept, memory dropped
assert.equal(fit.sections[1].text, `${"a".repeat(60)}…`); // cut at the line break
assert.deepEqual(fit.report.find((r) => r.label === "memory"), { label: "memory", chars: 0, of: 50 });
assert.ok(fit.used <= 150);

for (const line of PERSONALITY_REPLIES) assert.match(line, /curious/i);
assert.ok(PERSONALITY_REPLIES.includes(personalityReply()));
assert.match(identityBrief, /Gianne Bacay/);
assert.match(identityBrief, /address him as he and him, never she or her/);
assert.match(identityBrief, /not a member of any team/);
assert.match(introduction, /^I'm Arcanus, .*Gianne Bacay/);
// Arcanus knows itself in its own voice, and speaks as itself.
assert.match(identityBrief, /^I am Arcanus/);
assert.doesNotMatch(identityBrief, /\bArcanus is\b|\bIt (is|lives)\b/);
assert.match(featuresReply, /^I can tell the time, .*, and talk by voice\./);
assert.equal(
  asSelf("Arcanus is a local AI assistant. Arcanus doesn't have a body, but Arcanus runs on your device. Arcanus's voice is British."),
  "I am a local AI assistant. I don't have a body, but I run on your device. My voice is British.",
);
assert.equal(asSelf("I'm Arcanus, and the Arcanus Sphere is my body. Arcanus always listens."), "I'm Arcanus, and the Arcanus Sphere is my body. Arcanus always listens.");
assert.equal(asSelf("Arcanus can search the web."), "I can search the web.");
// The greeting: by the time of day, to whoever is signed in, by first name. Never "Good night", which is a goodbye.
// Words vary by boot (pick is fixed here); a week-old or absent topic means a plain introduction.
assert.equal(greeting({ when: "Friday evening", name: "Gianne Bacay" }, () => 0), "Good evening, Gianne. I'm Arcanus. What shall we think about?");
assert.equal(greeting({ when: "Friday night" }, () => 0), "Hello. I'm Arcanus. What shall we think about?");
assert.equal(greeting({ when: "Friday morning" }, () => 0.99), "Hello, and good morning. I'm Arcanus. What shall we explore?");
assert.equal(new Set(Array.from({ length: 50 }, () => greeting({ when: "Friday evening" }))).size > 1, true);
const day = 24 * 3600_000;
assert.equal(greeting({ when: "Monday morning", name: "Gianne", last: { title: "Black holes.", at: 0 }, now: day }, () => 0), 'Good morning, Gianne. Last time it was "Black holes". Shall we go on, or start something new?');
assert.match(greeting({ when: "Monday morning", last: { title: "Black holes", at: 0 }, now: 8 * day }, () => 0), /I'm Arcanus/);

// A year miscopied from the facts is put back; a year the facts don't come near is left alone.
const made = ["Gianne Bacay created me in the year 2025."];
assert.equal(keepYears("I was created in 2015 by Gianne Bacay.", made), "I was created in 2025 by Gianne Bacay.");
assert.equal(keepYears("I was made in 2025.", made), "I was made in 2025.");
assert.equal(keepYears("The war ended in 1945.", made), "The war ended in 1945.");
assert.equal(keepYears("Made in 2015.", []), "Made in 2015.");

// The facts' "he" is kept when the model writes "she"; facts that say she, or no pronoun at all, change nothing.
const his = ["Gianne Bacay created me. He first built ARCANE."];
assert.equal(keepPronouns("She first built ARCANE, and her library works like a brain.", his), "He first built ARCANE, and his library works like a brain.");
assert.equal(keepPronouns("I thank her for it. She made me herself.", his), "I thank him for it. He made me himself.");
assert.equal(keepPronouns("She was kind.", ["Ada wrote it. She was first."]), "She was kind.");
assert.equal(keepPronouns("She left.", ["The time is 3:42 PM."]), "She left.");

// Called by name: a call alone, a call with a request (the name comes off), and talk about Arcanus (not a call).
for (const call of ["hey arcanus", "Hey Arcanus!", "Arcanus?", "Okay Arcanus.", "arkanus", "excuse me, Arcanus"]) assert.deepEqual(addressed(call), { called: true, rest: "" }, call);
assert.deepEqual(addressed("Hey Arcanus, what time is it?"), { called: true, rest: "what time is it?" });
assert.deepEqual(addressed("what time is it, Arcanus?"), { called: true, rest: "what time is it" });
assert.deepEqual(addressed("thanks arcanus"), { called: true, rest: "thanks" });
for (const about of ["what is Arcanus", "who made arcanus", "Arcanus is cool", "tell me about the Arcanus Sphere"]) assert.equal(addressed(about).called, false, about);
// What SmolLM2 wrote for a call (sampled, llm reply.eval-style run): kept when it says it is here, else written again.
assert.equal(answersCall("Yes, I am listening. How can I help you today?"), "Yes, I am listening.");
assert.equal(answersCall("I'm here."), "I'm here.");
for (const drift of ["I'm listening to a podcast.", "No, I'm not here.", "I'm sorry for the misunderstanding.", "I'm glad you're not. I just wanted to say", "Yes, no"]) assert.equal(answersCall(drift), "", drift);

// Live voice: each prompt is the last one plus the new turn, so SmolLM2's cache covers all but the new words.
const talked = (n: number) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? ("assistant" as const) : ("user" as const), content: `turn ${i}` }));
const before = liveTurns(talked(4), "and then?").turns;
const after = liveTurns(talked(6), "and now?").turns;
assert.deepEqual(after.slice(0, before.length - 1), before.slice(0, -1));
// It reads between 2 and 8 earlier turns, and the window's start moves only every sixth turn.
let jumps = 0;
for (let n = 1; n <= 40; n++) {
  const read = liveTurns(talked(n), "x").turns.slice(1, -1);
  assert.ok(read.length <= 8 && read.length >= Math.min(n, 2), `${n} turns: read ${read.length}`);
  if (read[0].content !== liveTurns(talked(n - 1), "x").turns[1]?.content && n > 1) jumps++;
}
assert.equal(jumps, 6);
// Notes ride with the message, never in the system prompt, and a long turn is cut.
const noted = liveTurns([{ role: "user", content: "a".repeat(400) }], "what is my name", [{ label: "Notes you remembered", text: "- My name is Sam.", priority: 1 }]);
assert.match(ONLY_ASKED, /only what the user asked/i);
assert.equal(noted.turns[0].content, LIVE_SYSTEM);
assert.equal(noted.turns[1].content.length, 161);
assert.equal(noted.turns[2].content, "Notes you remembered:\n- My name is Sam.\n\nwhat is my name");

assert.deepEqual(argsFor({ properties: { city: {}, units: {} } }, "Manila"), { city: "Manila" });
assert.deepEqual(argsFor(undefined, "2+2"), { input: "2+2" });

const sse = 'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"weather"}]}}\n';
assert.equal((parseMcpBody(sse) as { result: { tools: { name: string }[] } }).result.tools[0].name, "weather");
assert.equal((parseMcpBody('{"ok":true}') as { ok: boolean }).ok, true);

registerPlugin({ name: "demo", tools: [{ name: "echo", description: "Repeats", run: (input) => input.toUpperCase() }] });
assert.equal(matchTool("please echo this")?.name, "echo");
assert.equal(matchTool("what time is it"), undefined);
assert.equal(await callTool("echo", "hello"), "HELLO");
assert.match(await callTool("missing", "x"), /No tool/);
// guardrails/built-in.md says what the code enforces: the identity and answer rules themselves, and its comment never reaches the model.
assert.ok(BUILT_IN_GUARDRAILS.includes(identityBrief) && BUILT_IN_GUARDRAILS.includes(ONLY_ASKED));
assert.ok(stripComments(BUILT_IN_GUARDRAILS).startsWith("# My guardrails"));
// AGENTS.md: roles in file order; a "## " inside a comment is not a role, and a heading with no instructions is skipped.
assert.deepEqual(parseAgents("# Agents\n<!-- ## fake\nnot a role -->\n## Planner\nPlans it.\nFive steps.\n\n## empty\n\n## Code Reviewer\nChecks it.\n"), [
  { name: "planner", description: "Plans it.", body: "Plans it.\nFive steps." },
  { name: "code-reviewer", description: "Checks it.", body: "Checks it." },
]);
console.log("harness ok");
