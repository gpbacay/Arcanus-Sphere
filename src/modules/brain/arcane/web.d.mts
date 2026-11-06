export type Distribution = Record<string, number>;

export interface Classification {
  label: string | null;
  confidence: number;
  distribution: Distribution;
  source?: string;
  latency_ms?: number;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: { name: string; type?: string; description?: string; required?: boolean; enum?: string[] }[];
}

export interface ToolRun {
  function_calls: { name: string; arguments: Record<string, unknown> }[];
  confidence: number | null;
  reasoning: string;
  latency_ms?: number;
}

export interface Arc1Agent {
  classify(text: string, labels: string[], opts?: { task?: string; descriptions?: Record<string, string> }): Promise<Classification>;
  run(prompt: string, tools: ToolSpec[], opts?: { toolPrior?: Record<string, number> }): Promise<ToolRun>;
  close(): Promise<void> | void;
}

export function load(options?: { model?: string; config?: string; wasmPaths?: string }): Promise<Arc1Agent>;

export { Hippocampus } from "./hippocampus.mjs";
