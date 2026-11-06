// Run: node src/modules/chat/markdown.check.ts
import assert from "node:assert/strict";
import { parseMarkdown } from "./markdown.ts";

const reply = parseMarkdown("The first result was\nhttps://www.youtube.com/results?search_query=ASMR.\n\nThen **ASMR**.");
assert.equal(reply.length, 2);
assert.ok("p" in reply[0]);
const link = reply[0].p.find((n) => typeof n === "object" && "a" in n);
assert.ok(link && "a" in link);
assert.equal(link.a, "https://www.youtube.com/results?search_query=ASMR");
assert.equal(link.v[0], "https://www.youtube.com/results?search_query=ASMR");
assert.ok("p" in reply[1] && reply[1].p.some((n) => typeof n === "object" && "b" in n));

const named = parseMarkdown("See [YouTube](https://youtu.be/abc) and [bad](javascript:alert(1)).");
assert.ok("p" in named[0]);
assert.equal(named[0].p.filter((n) => typeof n === "object" && "a" in n).length, 1);

const code = parseMarkdown("```\nconst a = 1\n```");
assert.deepEqual(code, [{ pre: "const a = 1" }]);

const list = parseMarkdown("- one\n- two\n\n1. three");
assert.ok("ul" in list[0] && list[0].ul.length === 2);
assert.ok("ol" in list[1] && list[1].ol.length === 1);

const snake = parseMarkdown("search_query stays whole");
assert.deepEqual(snake, [{ p: ["search_query stays whole"] }]);

console.log("markdown ok");
