// The editor's tab strip. Files are one list, shown in each group in that order, and the knowledge graph takes a
// place in the left group (graphAt files sit to its left). Dragging moves one tab. A file open on both sides is one
// entry, so it has one place.
// ponytail: one list for both groups. Per-group orders if a file open on both sides needs two places.

export const GRAPH = "\0graph";

type Side = 0 | 1;
type Row = { path: string; in: Side[] };

/** One group's strip: its file paths, and GRAPH where the knowledge graph sits when `graph` is set. */
export function strip<T extends Row>(tabs: T[], g: Side, graphAt: number, graph: boolean): string[] {
  const files = tabs.filter((t) => t.in.includes(g)).map((t) => t.path);
  if (!graph || g !== 0) return files;
  const at = Math.max(0, Math.min(graphAt, files.length));
  return [...files.slice(0, at), GRAPH, ...files.slice(at)];
}

/** Move `id` (a path, or GRAPH) to just before `before`, or to the end of the group when `before` is null.
 *  The same arrays come back when nothing moves. */
export function shiftTabs<T extends Row>(tabs: T[], g: Side, graphAt: number, graph: boolean, id: string, before: string | null): { tabs: T[]; graphAt: number } {
  const order = strip(tabs, g, graphAt, graph);
  if (!order.includes(id)) return { tabs, graphAt };
  const next = order.filter((x) => x !== id);
  const at = before === null ? next.length : next.indexOf(before);
  if (at < 0) return { tabs, graphAt };
  next.splice(at, 0, id);
  if (next.every((x, i) => x === order[i])) return { tabs, graphAt };
  const paths = next.filter((x) => x !== GRAPH);
  const old = order.filter((x) => x !== GRAPH);
  const moved = id !== GRAPH && paths.some((p, i) => p !== old[i]) ? place(tabs, id, paths) : tabs;
  const atGraph = next.indexOf(GRAPH);
  return { tabs: moved, graphAt: atGraph < 0 ? graphAt : atGraph };
}

/** `path` takes its new place among this group's files. Files of the other group stay in their own order. */
function place<T extends Row>(tabs: T[], path: string, paths: string[]): T[] {
  const item = tabs.find((t) => t.path === path);
  if (!item) return tabs;
  const rest = tabs.filter((t) => t.path !== path);
  const follow = paths[paths.indexOf(path) + 1];
  const prev = paths[paths.indexOf(path) - 1];
  const i = follow ? rest.findIndex((t) => t.path === follow) : prev ? rest.findIndex((t) => t.path === prev) + 1 : 0;
  if (i < 0) return tabs;
  rest.splice(i, 0, item);
  return rest;
}

/** Files that left the left group were holding the graph: it keeps its place among the files that stay. */
export function keptGraph<T extends Row>(prev: T[], next: T[], graphAt: number): number {
  const was = prev.filter((t) => t.in.includes(0));
  const still = new Set(next.filter((t) => t.in.includes(0)).map((t) => t.path));
  const dropped = was.slice(0, Math.max(0, graphAt)).filter((t) => !still.has(t.path)).length;
  return Math.max(0, Math.min(graphAt - dropped, next.filter((t) => t.in.includes(0)).length));
}

/** A new file opens at the end. The graph stays at the end only once a file is already there beside it;
 *  with nothing open it is the first tab, and the file opens after it. */
export function openedGraph<T extends Row>(tabs: T[], g: Side, graphAt: number): number {
  const left = tabs.filter((t) => t.in.includes(0)).length;
  if (g !== 0 || left === 0 || graphAt < left) return Math.max(0, Math.min(graphAt, left));
  return left + 1;
}

/** A file joining the left group keeps the graph on the same side of the files already there. */
export function joinedGraph<T extends Row>(tabs: T[], path: string, graphAt: number): number {
  const files = tabs.filter((t) => t.in.includes(0) || t.path === path);
  const index = files.findIndex((t) => t.path === path);
  return index > -1 && index < graphAt ? graphAt + 1 : graphAt;
}
