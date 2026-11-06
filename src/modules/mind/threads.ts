// The Graph of Thought laid out as threads. Thoughts one after another stay on one line; where a thought sets several
// going at once (models loading side by side, greeting candidates, recalls), each becomes a branch of its own; and a
// thought that joins several (aggregate, keep_best) comes back onto the line they forked from. Pure, so
// threads.check.ts runs it in Node.
import type { Thought } from "./mind";

/** A thought, and the branches it set running in parallel. Each branch is a thread of its own. */
export type Row = { t: Thought; branches: Row[][] };

/** One thread per root (a wake, a message), in order. */
export function threads(thoughts: Thought[]): Row[][] {
  const known = new Set(thoughts.map((t) => t.id));
  const up = new Map<string, string | undefined>(); // each thought's place in the tree
  const kids = new Map<string | undefined, Thought[]>();
  const joins = new Set<string>();
  const ancestry = (id?: string) => {
    const out: string[] = [];
    for (let x = id; x; x = up.get(x)) out.push(x);
    return out;
  };
  for (const t of thoughts) {
    const parents = t.parents.filter((p) => known.has(p)); // a parent may have fallen off the end of the log
    let at: string | undefined = parents[0];
    if (parents.length > 1) {
      // A join sits after the thought its parents all grew from.
      const others = parents.slice(1).map((p) => new Set(ancestry(p)));
      at = ancestry(parents[0]).find((x) => others.every((s) => s.has(x)));
      joins.add(t.id);
    }
    up.set(t.id, at);
    kids.set(at, [...(kids.get(at) ?? []), t]);
  }
  const run = (t: Thought): Row[] => {
    const next = kids.get(t.id) ?? [];
    const forks = next.filter((k) => !joins.has(k.id));
    // The line carries on through the one fork that goes on to more thoughts; the rest are side branches.
    const carry = forks.length === 1 ? forks[0] : forks.findLast((k) => kids.has(k.id));
    return [
      { t, branches: forks.filter((k) => k !== carry).map(run) },
      ...(carry ? run(carry) : []),
      ...next.filter((k) => joins.has(k.id)).flatMap(run),
    ];
  };
  return (kids.get(undefined) ?? []).map(run);
}
