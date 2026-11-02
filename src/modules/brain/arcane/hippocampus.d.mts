import type { Arc1Agent, Classification } from "./web.mjs";
import type { Occipital } from "./occipital.mjs";

export interface Neighbor {
  text: string;
  label: string | null;
  score: number;
}

export class Hippocampus {
  constructor(
    model?: Arc1Agent | null,
    options?: { k?: number; weight?: number; occipital?: Occipital | null; memory?: { text: string; label: string | null }[] }
  );
  remember(text: string, label: string | null): string;
  forget(text: string): boolean;
  neighbors(text: string, labels?: string[] | null): Neighbor[];
  classify(
    text: string,
    labels: string[],
    opts?: { task?: string; descriptions?: Record<string, string> }
  ): Promise<Classification & { neighbors: Neighbor[] }>;
}
