// Run: node src/modules/mind/layout.check.ts   (Node 22.18+ strips the types)
import assert from "node:assert/strict";
import type { Thought } from "./mind.ts";
import { graphs, type Graph } from "./layout.ts";

const T = (id: string, ...parents: string[]): Thought => ({ id, operation: "execute", content: id, parents, status: "complete", at: 0 });
/** A graph as text: its layers, each left to right. */
const show = (g: Graph) =>
  Array.from({ length: g.layers }, (_, at) => g.nodes.filter((n) => n.layer === at).sort((a, b) => a.x - b.x).map((n) => n.t.id).join(" ")).join(" / ");
const edges = (g: Graph) => g.edges.map((e) => `${e.from}>${e.to}`).join(" ");

// A message: two recalls beside a step, joined into the context; generate under it; refine joins generate and context.
const [msg] = graphs([T("m"), T("d", "m"), T("x", "d"), T("r1", "d"), T("r2", "d"), T("ctx", "d", "r1", "r2"), T("g", "ctx"), T("sp", "g"), T("ref", "g", "ctx")]);
assert.equal(show(msg), "m / d / x r1 r2 / ctx / g / sp ref");
assert.equal(edges(msg), "m>d d>x d>r1 d>r2 d>ctx r1>ctx r2>ctx ctx>g g>sp g>ref ctx>ref");
// A join sits under the middle of what it joins, and a lone thought spans the whole width.
const ctx = msg.nodes.find((n) => n.t.id === "ctx")!;
assert.deepEqual([ctx.x, ctx.span], [0.5, 1]);

// Children line up under their parents: b's child sits left of c's, whichever was thought first.
const [fork] = graphs([T("a"), T("b", "a"), T("c", "a"), T("c1", "c"), T("b1", "b")]);
assert.equal(show(fork), "a / b c / b1 c1");

// Two roots are two graphs; a parent that fell off the log makes its child a root.
assert.deepEqual(graphs([T("a"), T("b", "gone"), T("c", "a")]).map(show), ["a / c", "b"]);

// An edge into another graph is left out, and the thought stays in its first parent's graph.
const [one, two] = graphs([T("a"), T("b"), T("c", "b", "a")]);
assert.deepEqual([show(one), show(two), edges(two)], ["a", "b / c", "b>c"]);

console.log("layout.check: ok");
