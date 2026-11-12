// The Graph of Thought laid out as a graph: one per root (a wake, a message), drawn top to bottom. A thought sits one
// layer under its deepest parent, so thoughts that ran side by side (models loading, recalls) share a layer, and a
// thought that joins several (aggregate, refine) sits under all of them. Within a layer, thoughts line up under their
// parents. Pure, so layout.check.ts runs it in Node.
import type { Thought } from "./mind";

/** A thought's place: its layer (0 = the root), and `x`, its centre across the graph, 0 to 1. `span` is its layer's share of the width. */
export type Placed = { t: Thought; layer: number; x: number; span: number };
export type Edge = { from: string; to: string };
export type Graph = { nodes: Placed[]; edges: Edge[]; layers: number };

export function graphs(thoughts: Thought[]): Graph[] {
  const known = new Set(thoughts.map((t) => t.id));
  const root = new Map<string, string>(); // each thought's graph: the root it grew from
  const layer = new Map<string, number>();
  const out = new Map<string, { rows: Thought[][]; edges: Edge[] }>();
  // Thoughts arrive in order, so a thought's parents are already placed.
  for (const t of thoughts) {
    const parents = t.parents.filter((p) => known.has(p)); // a parent may have fallen off the end of the log
    const at = parents.length ? Math.max(...parents.map((p) => layer.get(p)!)) + 1 : 0;
    const home = parents.length ? root.get(parents[0])! : t.id;
    layer.set(t.id, at);
    root.set(t.id, home);
    const graph = out.get(home) ?? { rows: [], edges: [] };
    out.set(home, graph);
    (graph.rows[at] ??= []).push(t);
    // An edge from another graph (a reply's voice under the boot's wake) would cross graphs: it is left out.
    for (const p of parents) if (root.get(p) === home) graph.edges.push({ from: p, to: t.id });
  }
  return [...out.values()].map(({ rows, edges }) => {
    const x = new Map<string, number>();
    const nodes: Placed[] = [];
    rows.forEach((row, at) => {
      // Under its parents: ordered by where they sit, on average; thoughts with the same parents keep their order.
      const under = (t: Thought) => {
        const xs = t.parents.map((p) => x.get(p)).filter((v): v is number => v !== undefined);
        return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0.5;
      };
      const sorted = row.map((t, i) => ({ t, i, u: under(t) })).sort((a, b) => a.u - b.u || a.i - b.i);
      sorted.forEach(({ t }, i) => {
        x.set(t.id, (i + 0.5) / row.length);
        nodes.push({ t, layer: at, x: (i + 0.5) / row.length, span: 1 / row.length });
      });
    });
    return { nodes, edges, layers: rows.length };
  });
}
