// Run: node src/modules/harness/harness.check.ts   (Node 22.18+ strips the types)
import assert from "node:assert/strict";
import { argsFor, assemble, callTool, greetingPrompt, identityBrief, introduction, matchTool, parseMcpBody, parseSkill, PERSONALITY_REPLIES, personalityReply, registerPlugin, slug, unsupported } from "./index.ts";

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
assert.match(identityBrief, /not a member of any team/);
assert.match(introduction, /^I'm Arcanus, .*Gianne Bacay/);
// Greeting context: only true facts, the user's own files fitted in, and a check of what the model adds.
const greeting = greetingPrompt({ when: "Friday evening", rules: "Call me Sam.", lastTopic: "Cooking pasta", notes: ["Sam likes short answers."] });
assert.match(greeting.facts, /Gianne Bacay/);
assert.match(greeting.facts, /Call me Sam/);
assert.match(greeting.turns[0].content, /Cooking pasta/);
assert.doesNotMatch(greetingPrompt({ when: "Friday evening" }).facts, /standing instructions|Last time|Notes/);
assert.deepEqual(unsupported("Good evening Sam, I'm Arcanus. Shall we get back to the pasta?", greeting.facts), ["get"]);
assert.deepEqual(unsupported("Hello, I'm Arcanus, your personal AI supervisor at the university.", greeting.facts), ["personal", "supervisor", "university"]);
assert.deepEqual(unsupported("Hello, I am Arcanus. I can search the web or do math for you.", greeting.facts), []);

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
