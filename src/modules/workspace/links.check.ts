// Run: node src/modules/workspace/links.check.ts
import assert from "node:assert/strict";
import { layout, linkGraph, neighbors, plainLinks, resolve, wikiLinks } from "./links.ts";

assert.deepEqual(wikiLinks("See [[Plan]], [[ideas/Sky#Blue|the sky]] and [[Plan]] again."), ["Plan", "ideas/Sky"]);
assert.deepEqual(wikiLinks("`[[not]]`\n```\n[[nor]]\n```\n<!-- see [[self]] -->"), ["self"]); // code isn't linked; a comment is
assert.equal(plainLinks("Read [[guardrails/rules]] and [[self#Files|what I am]]."), "Read rules and what I am.");

const paths = [".arcanus/memory/plan.md", ".arcanus/notes/ideas/sky.md", ".arcanus/sky.md"];
assert.equal(resolve("Plan", paths), ".arcanus/memory/plan.md");
assert.equal(resolve("ideas/Sky", paths), ".arcanus/notes/ideas/sky.md");
assert.equal(resolve("sky.md", paths), ".arcanus/sky.md"); // the nearest of two
assert.equal(resolve("nowhere", paths), null);
assert.equal(resolve("sky", paths, ".arcanus/notes/ideas/plan.md"), ".arcanus/notes/ideas/sky.md"); // the one beside the link wins

const g = linkGraph([
  { path: "a.md", text: "[[b]] and [[c]] and [[a]]" },
  { path: "b.md", text: "back to [[a]]" },
  { path: "lone.md", text: "" },
]);
assert.deepEqual(g.edges, [["a.md", "b.md"], ["a.md", "?c"], ["b.md", "a.md"]]); // a link to itself is no edge
assert.ok(g.nodes.find((n) => n.id === "?c")?.missing);
assert.deepEqual(neighbors("a.md", g), ["b.md"]); // the missing note has no text to read
assert.deepEqual(neighbors("b.md", g), ["a.md"]);

const at = layout(g);
const d = (p: string, q: string) => Math.hypot(at.get(p)!.x - at.get(q)!.x, at.get(p)!.y - at.get(q)!.y);
assert.ok([...at.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
assert.ok(d("a.md", "b.md") < d("b.md", "lone.md")); // linked notes sit closer than unlinked ones

console.log("links ok");
