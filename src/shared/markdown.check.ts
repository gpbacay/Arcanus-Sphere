// Run: node src/shared/markdown.check.ts
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

const wiki = parseMarkdown("See [[ideas/Sky#Blue|the sky]] and [[Plan]].");
assert.deepEqual(wiki, [{ p: ["See ", { w: "ideas/Sky#Blue", v: ["the sky"] }, " and ", { w: "Plan", v: ["Plan"] }, "."] }]);

// A file: a paragraph's lines run together; two trailing spaces break the line.
assert.deepEqual(parseMarkdown("one\ntwo  \nthree", { breaks: false }), [{ p: ["one two", { br: 1 }, "three"] }]);
assert.deepEqual(parseMarkdown("one\ntwo"), [{ p: ["one", { br: 1 }, "two"] }]); // a reply keeps its breaks

// What notes use: deeper headings, rules, strikethrough, task lists, tables, and a list straight after a line.
assert.deepEqual(parseMarkdown("#### Four"), [{ h: 4, v: ["Four"] }]);
assert.deepEqual(parseMarkdown("a\n\n---\n\nb"), [{ p: ["a"] }, { hr: 1 }, { p: ["b"] }]);
assert.deepEqual(parseMarkdown("~~gone~~ stays"), [{ p: [{ s: ["gone"] }, " stays"] }]);
assert.deepEqual(parseMarkdown("- [x] done\n- [ ] to do"), [{ ul: [[{ task: true }, "done"], [{ task: false }, "to do"]] }]);
assert.deepEqual(parseMarkdown("| Name | Age |\n|:--|--:|\n| Sam | 7 |"), [
  { table: { head: [["Name"], ["Age"]], align: ["left", "right"], rows: [[["Sam"], ["7"]]] } },
]);
assert.deepEqual(parseMarkdown("For example:\n- one\n- two"), [{ p: ["For example:"] }, { ul: [["one"], ["two"]] }]);
assert.deepEqual(parseMarkdown("in\n2024. Then"), [{ p: ["in", { br: 1 }, "2024. Then"] }]); // not a list
assert.deepEqual(parseMarkdown("3. c\n4. d"), [{ ol: [["c"], ["d"]], start: 3 }]);

console.log("markdown ok");
