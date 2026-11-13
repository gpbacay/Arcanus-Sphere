import assert from "node:assert/strict";
import { admits, fileHit, lineHits, matcher, ranked } from "./find.ts";

// The query: words as they are by default, a pattern when asked, case and whole word when asked.
const plain = matcher("a.b") as RegExp;
assert.ok(plain.test("xa.by") && !(matcher("a.b") as RegExp).test("axb"));
assert.ok((matcher("a.b", { regex: true }) as RegExp).test("axb"));
assert.ok((matcher("Greet") as RegExp).test("the greeting"));
assert.ok(!(matcher("Greet", { matchCase: true }) as RegExp).test("the greeting"));
assert.ok(!(matcher("greet", { wholeWord: true }) as RegExp).test("the greeting"));
assert.ok((matcher("greeting", { wholeWord: true }) as RegExp).test("the greeting."));
assert.equal(typeof matcher("(", { regex: true }), "string"); // a broken pattern says why

// Globs, as a code editor reads them.
assert.ok(admits(".arcanus/memory/a.md", { include: "*.md" }));
assert.ok(!admits(".arcanus/skills/x/SKILL.ts", { include: "*.md" }));
assert.ok(admits(".arcanus/memory/a.md", { include: "memory" })); // a folder, at any depth
assert.ok(admits("src/modules/chat/x.ts", { include: "src/**/*.ts" }));
assert.ok(!admits("lib/src/x.ts", { include: "src/**" })); // with a "/", from the root
assert.ok(!admits("src/old/exclude/x.ts", { exclude: "src/**/exclude" }));
assert.ok(admits("src/a.ts", { include: "*.md, *.ts", exclude: "*.css" }));
assert.ok(!admits("src/a.css", { exclude: "*.ts, *.css" }));

// Lines: numbered from 1, the match located in what is shown.
const [hit] = lineHits("first\n  the greeting is here\nlast", matcher("greeting") as RegExp);
assert.deepEqual(hit, { line: 2, text: "the greeting is here", from: 4, to: 12 });
const long = `${"x".repeat(300)} needle ${"y".repeat(300)}`;
const [cut] = lineHits(long, matcher("needle") as RegExp);
assert.equal(cut.text.slice(cut.from, cut.to), "needle");

// Files: by name, by lines, or not at all; names first.
const re = matcher("lore") as RegExp;
assert.deepEqual(fileHit(".arcanus/lore.md", "nothing", re), { path: ".arcanus/lore.md", named: true, lines: [] });
assert.equal(fileHit(".arcanus/self.md", "nothing here", re), null);
const order = ranked([
  { path: "b.md", named: false, lines: [hit, hit] },
  { path: "lore.md", named: true, lines: [] },
  { path: "a.md", named: false, lines: [hit] },
]).map((f) => f.path);
assert.deepEqual(order, ["lore.md", "b.md", "a.md"]);

console.log("find ok");
