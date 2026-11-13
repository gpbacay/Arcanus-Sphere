// Run: node src/modules/mind/layout.check.ts   (Node 22.18+ strips the types)
import assert from "node:assert/strict";
import type { Thought } from "./mind.ts";
import { processes, type Step } from "./layout.ts";

const T = (id: string, ...parents: string[]): Thought => ({ id, operation: id === "w" ? "wake" : "execute", content: id, parents, status: "complete", at: 0 });
/** A rail as text: its thoughts in order, a fork in brackets, joins after a plus. */
const show = (steps: Step[]): string =>
  steps.map((s) => s.t.id + (s.joins.length ? `+${s.joins.join("+")}` : "") + (s.branches.length ? `[${show(s.branches)}]` : "")).join(" ");

// A boot: the models load side by side, then the greeting's train runs on down the same rail. refine joins the facts.
const [boot] = processes([T("w"), T("l1", "w"), T("l2", "w"), T("known", "w"), T("gen", "known"), T("ref", "gen", "known"), T("say", "ref")]);
assert.equal(show(boot.steps), "l1 l2 known gen ref+known say");
assert.deepEqual([boot.init, boot.count, boot.root.id], [true, 7, "w"]);

// A message: one rail from top to bottom; the context names the recalls it joins, the check the context it joins.
const [msg] = processes([T("m"), T("d", "m"), T("r1", "d"), T("r2", "d"), T("ctx", "d", "r1", "r2"), T("g", "ctx"), T("sp", "g"), T("ref", "g", "ctx")]);
assert.equal(show(msg.steps), "d r1 r2 ctx+r1+r2 g sp ref+ctx");
assert.equal(msg.init, false);

// A thought with later siblings keeps its own children under it, as a branch.
const [fork] = processes([T("a"), T("b", "a"), T("b1", "b"), T("c", "a")]);
assert.equal(show(fork.steps), "b[b1] c");

// Two roots are two processes; a parent that fell off the log makes its child a root; a join from another process is still named.
const three = processes([T("a"), T("b", "gone"), T("c", "a"), T("d", "b", "a")]);
assert.deepEqual(three.map((p) => `${p.root.id}: ${show(p.steps)}`), ["a: c", "b: d+a"]);

// Running and failed thoughts are counted for the process's heading.
const [busy] = processes([T("a"), { ...T("b", "a"), status: "active" }, { ...T("c", "a"), status: "failed" }]);
assert.deepEqual([busy.active, busy.failed], [1, 1]);

console.log("layout.check: ok");
