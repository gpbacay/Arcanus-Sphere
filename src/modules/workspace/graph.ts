// The commit graph's lanes, as an editor's git graph draws them. Pure data, no React, so graph.check.ts runs it in Node.
// Each commit gets a row: the lane its dot is in, and the line segments through the row's top half (from the lanes
// coming down from newer commits to the dot or straight on) and its bottom half (from the dot to its parents' lanes,
// and the other lanes straight on). Commits come newest first, in topological order (git log --topo-order).

export type Commit = { hash: string; parents: string[] };
/** A segment through half a row: from lane `from` at one edge to lane `to` at the other. */
export type Segment = [from: number, to: number];
export type Row = { col: number; top: Segment[]; bottom: Segment[] };

export function lanes(commits: Commit[]): { rows: Row[]; width: number } {
  let open: (string | null)[] = []; // what each lane is waiting for: the next commit it leads to
  let width = 1;
  const rows = commits.map(({ hash, parents }) => {
    let col = open.indexOf(hash);
    if (col < 0) {
      // A branch's newest commit: no lane waits for it, so it takes a free one and no line comes down to it.
      col = open.indexOf(null);
      if (col < 0) col = open.length;
    }
    // Every lane waiting for this commit joins its dot; the rest go straight on.
    const top: Segment[] = open.flatMap((h, i): Segment[] => (h === null ? [] : [[i, h === hash ? col : i]]));
    const next = open.map((h) => (h === hash ? null : h));
    const bottom: Segment[] = next.flatMap((h, i): Segment[] => (h === null || i === col ? [] : [[i, i]]));
    const [first, ...merged] = parents;
    next[col] = first ?? null;
    if (first) bottom.push([col, col]);
    for (const p of merged) {
      let j = next.indexOf(p);
      if (j < 0) {
        j = next.indexOf(null);
        if (j < 0) j = next.length;
        next[j] = p;
      }
      bottom.push([col, j]);
    }
    while (next.length && next.at(-1) === null) next.pop();
    width = Math.max(width, next.length, col + 1, open.length);
    open = next;
    return { col, top, bottom };
  });
  return { rows, width };
}
