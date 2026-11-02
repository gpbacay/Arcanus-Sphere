export type Distribution = Record<string, number>;

export interface Classification {
  label: string | null;
  confidence: number;
  distribution: Distribution;
  source?: string;
  latency_ms?: number;
}

export interface Arc1Agent {
  classify(text: string, labels: string[], opts?: { task?: string; descriptions?: Record<string, string> }): Promise<Classification>;
  close(): Promise<void> | void;
}

export function load(options?: { model?: string; config?: string; wasmPaths?: string }): Promise<Arc1Agent>;

export { Hippocampus } from "./hippocampus.mjs";
