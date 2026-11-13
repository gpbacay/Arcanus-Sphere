// Links between notes, as Obsidian has them: [[note]], [[folder/note]], [[note#heading]] or [[note|shown as]] in a
// markdown file links it to another, so one subject can be split over small files that point at each other. Pure data,
// no React, so links.check.ts runs it in Node. notes.ts reads the files; NoteGraph.tsx draws what this works out.

export type Note = { path: string; text: string };
/** A file, or a link's target no file answers yet (`missing`: clicking it makes the file). */
export type Node = { id: string; name: string; missing?: boolean };
export type Graph = { nodes: Node[]; edges: [from: string, to: string][] };

const WIKI = /\[\[([^\]|#\n]*)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g;

/** The targets a note links to, in order, once each. Links inside code are not links. */
export function wikiLinks(text: string): string[] {
  const prose = text.replace(/```[\s\S]*?```|`[^`\n]*`|<!--[\s\S]*?-->/g, "");
  return [...new Set([...prose.matchAll(WIKI)].map((m) => m[1].trim()).filter(Boolean))];
}

const key = (path: string) => path.toLowerCase().replace(/\.(md|markdown)$/, "");
export const noteName = (path: string) => (path.split("/").pop() ?? path).replace(/\.(md|markdown)$/i, "");

/** The file a link means, or null. As Obsidian: the path itself, else the nearest file whose path ends with it. */
export function resolve(target: string, paths: string[]): string | null {
  const want = key(target.replace(/#.*$/, "").trim());
  if (!want) return null;
  const hits = paths.filter((p) => key(p) === want || key(p).endsWith(`/${want}`));
  return hits.sort((a, b) => a.length - b.length)[0] ?? null;
}

export function linkGraph(notes: Note[]): Graph {
  const paths = notes.map((n) => n.path);
  const nodes: Node[] = notes.map((n) => ({ id: n.path, name: noteName(n.path) }));
  const edges: Graph["edges"] = [];
  const ghosts = new Map<string, Node>();
  for (const n of notes) {
    for (const target of wikiLinks(n.text)) {
      let to = resolve(target, paths);
      if (!to) {
        to = `?${key(target)}`;
        if (!ghosts.has(to)) ghosts.set(to, { id: to, name: noteName(target), missing: true });
      }
      if (to !== n.path && !edges.some(([a, b]) => a === n.path && b === to)) edges.push([n.path, to]);
    }
  }
  return { nodes: [...nodes, ...ghosts.values()], edges };
}

/** What a note links to, then what links to it: the notes beside it in the graph. */
export function neighbors(id: string, g: Graph): string[] {
  const out = g.edges.filter(([a]) => a === id).map(([, b]) => b);
  const back = g.edges.filter(([, b]) => b === id).map(([a]) => a);
  return [...new Set([...out, ...back])].filter((n) => !n.startsWith("?"));
}

/**
 * Where each node sits: a force layout. Every node pushes every other away, a link pulls its ends together, and a
 * weak pull to the middle keeps lone notes close. Starts from a circle, so the same notes always land the same way.
 * ponytail: O(n²) per step, fine for a few hundred notes; a quadtree (Barnes-Hut) when a vault holds thousands.
 */
export function layout(g: Graph, steps = 300): Map<string, { x: number; y: number }> {
  const n = g.nodes.length;
  const at = g.nodes.map((_, i) => ({ x: Math.cos((2 * Math.PI * i) / n) * 10 * Math.sqrt(n), y: Math.sin((2 * Math.PI * i) / n) * 10 * Math.sqrt(n) }));
  const index = new Map(g.nodes.map((node, i) => [node.id, i]));
  const links = g.edges.map(([a, b]) => [index.get(a)!, index.get(b)!]);
  for (let s = 0; s < steps; s++) {
    const heat = 1 - s / steps;
    const move = at.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const dx = at[i].x - at[j].x || 0.01;
        const dy = at[i].y - at[j].y;
        const d2 = Math.max(dx * dx + dy * dy, 1);
        const f = 900 / d2;
        move[i].x += dx * f;
        move[i].y += dy * f;
        move[j].x -= dx * f;
        move[j].y -= dy * f;
      }
    for (const [i, j] of links) {
      const dx = at[j].x - at[i].x;
      const dy = at[j].y - at[i].y;
      move[i].x += dx * 0.05;
      move[i].y += dy * 0.05;
      move[j].x -= dx * 0.05;
      move[j].y -= dy * 0.05;
    }
    for (let i = 0; i < n; i++) {
      const mx = move[i].x - at[i].x * 0.01;
      const my = move[i].y - at[i].y * 0.01;
      const len = Math.hypot(mx, my);
      const cap = (10 * heat + 0.5) / Math.max(len, 10 * heat + 0.5); // never further than this in one step
      at[i].x += mx * cap;
      at[i].y += my * cap;
    }
  }
  return new Map(g.nodes.map((node, i) => [node.id, at[i]]));
}
