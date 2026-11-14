// Run: node src/modules/workspace/tabs.check.ts
import assert from "node:assert/strict";
import { GRAPH, joinedGraph, keptGraph, openedGraph, shiftTabs, strip } from "./tabs.ts";

const row = (path: string, ...inn: (0 | 1)[]) => ({ path, in: inn });

// Left: a, graph, b, d. Right: b, c. Moving d to the front of the left leaves the right as b, c.
const tabs = [row("a", 0), row("b", 0, 1), row("c", 1), row("d", 0)];
let next = shiftTabs(tabs, 0, 1, true, "d", "a");
assert.deepEqual(strip(next.tabs, 0, next.graphAt, true), ["d", "a", GRAPH, "b"]);
assert.deepEqual(strip(next.tabs, 1, next.graphAt, true), ["b", "c"]);

// Moving b to the end of the right leaves it before d on the left, and the graph where it was.
next = shiftTabs(tabs, 1, 1, true, "b", null);
assert.deepEqual(strip(next.tabs, 1, next.graphAt, true), ["c", "b"]);
assert.deepEqual(strip(next.tabs, 0, next.graphAt, true), ["a", GRAPH, "b", "d"]);

// The graph moves to the end without shuffling files. The right group is untouched.
next = shiftTabs(tabs, 0, 1, true, GRAPH, null);
assert.equal(next.graphAt, 3);
assert.deepEqual(strip(next.tabs, 0, next.graphAt, true), ["a", "b", "d", GRAPH]);
assert.equal(next.tabs, tabs);

// A file crossing the graph only moves the graph's index.
next = shiftTabs(tabs, 0, 1, true, "a", "b");
assert.deepEqual(strip(next.tabs, 0, next.graphAt, true), [GRAPH, "a", "b", "d"]);
assert.equal(next.tabs, tabs);

// Already there, unknown, or not in this group: the same arrays.
assert.equal(shiftTabs(tabs, 0, 1, true, "b", "d").tabs, tabs);
assert.equal(shiftTabs(tabs, 0, 1, true, "a", "a").tabs, tabs);
assert.equal(shiftTabs(tabs, 0, 1, true, "nope", "a").tabs, tabs);
assert.equal(shiftTabs(tabs, 1, 1, true, "a", null).tabs, tabs);
assert.equal(shiftTabs(tabs, 1, 1, true, GRAPH, null).tabs, tabs);

// Closing a file that sat left of the graph pulls the graph back with it.
const closed = [row("b", 0, 1), row("c", 1), row("d", 0)];
assert.equal(keptGraph(tabs, closed, 1), 0);
assert.equal(keptGraph(tabs, tabs.filter((t) => t.path !== "d"), 1), 1);

// A new file lands at the end. With nothing open the graph stays first; once it has been moved last, it stays last.
assert.equal(openedGraph([], 0, 0), 0);
assert.equal(openedGraph(tabs.filter((t) => t.in.includes(0)), 0, 0), 0);
assert.equal(openedGraph([row("a", 0), row("b", 0)], 0, 2), 3);
assert.equal(openedGraph([row("a", 0), row("b", 0)], 1, 2), 2);

// A file joining the left group doesn't jump the graph.
assert.equal(joinedGraph([row("b", 1), row("a", 0)], "b", 1), 2);
assert.equal(joinedGraph([row("a", 0), row("b", 1)], "b", 0), 0);

console.log("tabs ok");
