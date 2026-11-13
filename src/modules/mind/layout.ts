// The Graph of Thought laid out as processes: one per root (a wake, a message, a command), each a tree drawn with
// rails. A thought hangs under its first parent; the other thoughts it came from (an aggregate, a refine) are its
// `joins`, named on its row, not drawn: lines that only ever run down one rail and across to one row can't cross or
// cover each other. What grows from the last thought on a rail stays on that rail (retrieve, then generate, then
// refine), so a long train reads top to bottom without marching off to the right. Pure, so layout.check.ts runs it in Node.
import type { Thought } from "./mind";

/** A thought on its rail. `joins`: its parents besides the one it hangs under. `branches`: the thoughts that fork off it. */
export type Step = { t: Thought; joins: string[]; branches: Step[] };
/** One root and everything that grew from it. `init`: a boot (its root is a wake), kept apart from the conversation. */
export type Process = { root: Thought; steps: Step[]; count: number; active: number; failed: number; init: boolean };

export function processes(thoughts: Thought[]): Process[] {
  const kids = new Map<string, Thought[]>(thoughts.map((t) => [t.id, []]));
  const roots: Thought[] = [];
  // Thoughts arrive in order, so a thought's parents are already known. A parent may have fallen off the end of the log.
  const under = (t: Thought) => t.parents.find((p) => kids.has(p));
  for (const t of thoughts) {
    const parent = under(t);
    if (parent) kids.get(parent)!.push(t);
    else roots.push(t);
  }
  /** The rail under `t`: its children, then on down the same rail whatever grew from the last of them. Only a child
   *  with later siblings forks: its own children branch off it. */
  const rail = (t: Thought): Step[] => {
    const own = kids.get(t.id)!;
    const last = own.at(-1);
    const steps = own.map((k): Step => ({ t: k, joins: k.parents.filter((p) => p !== under(k) && kids.has(p)), branches: k === last ? [] : rail(k) }));
    return last ? [...steps, ...rail(last)] : steps;
  };
  return roots.map((root) => {
    const steps = rail(root);
    const all = [root, ...flat(steps)];
    return {
      root,
      steps,
      count: all.length,
      active: all.filter((t) => t.status === "active").length,
      failed: all.filter((t) => t.status === "failed").length,
      init: root.operation === "wake",
    };
  });
}

const flat = (steps: Step[]): Thought[] => steps.flatMap((s) => [s.t, ...flat(s.branches)]);
