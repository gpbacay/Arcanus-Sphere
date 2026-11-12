// Run: node src/modules/harness/harness.check.ts   (Node 22.18+ strips the types)
import assert from "node:assert/strict";
import { argsFor, asSelf, assemble, callTool, featuresReply, greetingPrompt, identityBrief, introduction, liveTurns, LIVE_SYSTEM, matchTool, ONLY_ASKED, parseMcpBody, parseSkill, PERSONALITY_REPLIES, personalityReply, registerPlugin, slug, unsupported } from "./index.ts";

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
// Greeting context: only true facts, the user's own files fitted in, and a check of what the model adds.
const greeting = greetingPrompt({ when: "Friday evening", rules: "Call me Sam.", lastTopic: "Cooking pasta", notes: ["Sam likes short answers."] });
assert.match(greeting.facts, /Gianne Bacay/);
assert.match(greeting.facts, /Call me Sam/);
assert.match(greeting.turns[0].content, /Cooking pasta/);
assert.doesNotMatch(greetingPrompt({ when: "Friday evening" }).facts, /standing instructions|Last time|Notes/);
assert.deepEqual(unsupported("Good evening Sam, I'm Arcanus. Shall we get back to the pasta?", greeting.facts), ["get"]);
assert.deepEqual(unsupported("Hello, I'm Arcanus, your personal AI supervisor at the university.", greeting.facts), ["personal", "supervisor", "university"]);
assert.deepEqual(unsupported("Hello, I am Arcanus. I can search the web or do math for you.", greeting.facts), []);

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
assert.match(LIVE_SYSTEM, /only what the user asked/i);
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
console.log("harness ok");
