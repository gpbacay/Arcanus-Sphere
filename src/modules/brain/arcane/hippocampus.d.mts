import type { Arc1Agent, Classification } from "./web.mjs";
import type { Occipital } from "./occipital.mjs";

export interface Neighbor {
  text: string;
  label: string | null;
  score: number;
}

/** A remembered example, as toJSON() writes it and the `memory` option reads it. */
export interface Example {
  text: string;
  label: string | null;
  arguments?: Record<string, unknown>;
  /** "auto" for an example observe() learned; absent for one remember()ed. */
  source?: string;
}

export class Hippocampus {
  constructor(
    model?: Arc1Agent | null,
    options?: { k?: number; weight?: number; occipital?: Occipital | null; memory?: Example[]; maxSize?: number | null; confident?: number }
  );
  remember(text: string, label: string | null): string;
  /** Learn from an outcome; stores only what the memory doesn't already decide confidently. The new id, or null. */
  observe(text: string, label: string | null): Promise<string | null>;
  forget(text: string): boolean;
  toJSON(): Example[];
  neighbors(text: string, labels?: string[] | null): Neighbor[];
  classify(
    text: string,
    labels: string[],
    opts?: { task?: string; descriptions?: Record<string, string> }
  ): Promise<Classification & { neighbors: Neighbor[] }>;
}
