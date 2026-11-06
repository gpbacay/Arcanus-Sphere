// Run: node src/modules/mind/threads.check.ts   (Node 22.18+ strips the types)
import assert from "node:assert/strict";
import type { Thought } from "./mind.ts";
import { threads, type Row } from "./threads.ts";

const T = (id: string, ...parents: string[]): Thought => ({ id, operation: "execute", content: id, parents, status: "complete", at: 0 });
/** A thread as text: "a" for a row, "a[b|c]" for a row with branches b and c. */
const show = (rows: Row[]): string => rows.map(({ t, branches }) => t.id + (branches.length ? `[${branches.map(show).join("|")}]` : "")).join(" ");

// Boot: four loads and three greeting candidates in parallel off the wake, keep_best joins the candidates, then speaks.
const boot = [T("w"), T("l1", "w"), T("l2", "w"), T("l3", "w"), T("l4", "w"), T("c1", "w"), T("c2", "w"), T("c3", "w"), T("k", "c1", "c2", "c3"), T("s", "k")];
assert.deepEqual(threads(boot).map(show), ["w[l1|l2|l3|l4|c1|c2|c3] k s"]);

// A message: two recalls in parallel join into the context; the line carries on through generate; refine checks it.
const msg = [T("m"), T("d", "m"), T("x", "d"), T("r1", "d"), T("r2", "d"), T("ctx", "d", "r1", "r2"), T("g", "ctx"), T("sp", "g"), T("ref", "g", "ctx")];
assert.deepEqual(threads(msg).map(show), ["m d[x|r1|r2] ctx g sp ref"]);

// Without recalls the context isn't a join: the step it ran beside is a branch, the line goes on through the context.
assert.deepEqual(threads([T("m"), T("d", "m"), T("x", "d"), T("ctx", "d"), T("g", "ctx")]).map(show), ["m d[x] ctx g"]);

// Two roots are two threads; a parent that fell off the log makes its child a root.
assert.deepEqual(threads([T("a"), T("b", "gone"), T("c", "a")]).map(show), ["a c", "b"]);

console.log("threads.check: ok");
