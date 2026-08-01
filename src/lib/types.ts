export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export interface AgentStep {
  type: "thought" | "tool" | "answer" | "status";
  content: string;
  toolName?: string;
}

export interface ChatApiResponse {
  reply: string;
  steps: AgentStep[];
  model: string;
}

export type AgentStreamEvent =
  | { type: "status"; content: string }
  | { type: "thought"; content: string; append?: boolean }
  | { type: "tool"; toolName: string; content: string }
  | { type: "answer"; content: string; append?: boolean }
  | { type: "done"; reply: string; steps: AgentStep[]; model: string }
  | { type: "error"; content: string };
