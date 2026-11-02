// Arcanus's agent harness: personality, tools, plugins, and MCP servers. Skills stay in the brain and call in here.
// ponytail: HTTP MCP only (tools/list and tools/call). Resources, prompts, and stdio need a host that isn't the browser.

export const personality = {
  name: "Arcanus",
  line: "Arcanus is calm, brief, and direct. It introduces itself by name when it wakes, then offers help.",
};

export const personalityReply = () => personality.line;

export interface Tool {
  name: string;
  description: string;
  /** JSON Schema properties, when the tool came from MCP. The first property receives the message. */
  schema?: { properties?: Record<string, unknown> };
  run?: (input: string) => string | Promise<string>;
  mcp?: string;
}

export interface Plugin {
  name: string;
  tools?: Tool[];
}

const tools = new Map<string, Tool>();
const plugins: string[] = [];
const sessions = new Map<string, string>();

export function registerPlugin(plugin: Plugin) {
  if (!plugins.includes(plugin.name)) plugins.push(plugin.name);
  for (const tool of plugin.tools ?? []) tools.set(tool.name, tool);
}

export function listTools(): Tool[] {
  return [...tools.values()];
}

export function listPlugins(): string[] {
  return [...plugins];
}

/** A tool whose name is a whole word in `text`. */
export function matchTool(text: string): Tool | undefined {
  const words = new Set(text.toLowerCase().split(/\W+/).filter(Boolean));
  for (const tool of tools.values()) if (words.has(tool.name.toLowerCase())) return tool;
  return undefined;
}

export function argsFor(schema: Tool["schema"], input: string): Record<string, string> {
  const key = schema?.properties ? Object.keys(schema.properties)[0] : undefined;
  return { [key || "input"]: input };
}

/** Last JSON payload in an MCP HTTP body, including an SSE `data:` frame. */
export function parseMcpBody(text: string): unknown {
  const frame = text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .at(-1);
  return JSON.parse(frame || text);
}

async function rpc(url: string, body: unknown, session?: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(session ? { "mcp-session-id": session } : {}),
    },
    body: JSON.stringify(body),
  });
  const next = res.headers.get("mcp-session-id") ?? session;
  const text = await res.text();
  return {
    json: text.trim()
      ? (parseMcpBody(text) as {
          result?: { tools?: { name?: string; description?: string; inputSchema?: Tool["schema"] }[]; content?: { text?: string }[] };
          error?: unknown;
        })
      : null,
    session: next ?? undefined,
  };
}

/** Connect an MCP server over HTTP and register its tools. Returns the tool names. */
export async function connectMcp(url: string): Promise<string[]> {
  const init = await rpc(url, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "Arcanus", version: "0.1.0" } },
  });
  if (init.session) sessions.set(url, init.session);
  await rpc(url, { jsonrpc: "2.0", method: "notifications/initialized" }, init.session);
  const listed = await rpc(url, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, init.session);
  const names: string[] = [];
  for (const tool of listed.json?.result?.tools ?? []) {
    if (!tool?.name) continue;
    tools.set(tool.name, { name: tool.name, description: String(tool.description ?? ""), schema: tool.inputSchema, mcp: url });
    names.push(tool.name);
  }
  if (!plugins.includes(url)) plugins.push(url);
  return names;
}

async function mcpCall(url: string, name: string, input: string, schema: Tool["schema"]) {
  const { json } = await rpc(
    url,
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: argsFor(schema, input) } },
    sessions.get(url),
  );
  const content = json?.result?.content;
  if (Array.isArray(content)) return content.map((part) => part.text ?? "").join(" ").trim();
  if (json?.error) return `Tool ${name} failed.`;
  return "";
}

/** Run a tool by name. MCP tools are called on their server; local tools run here. */
export async function callTool(name: string, input: string): Promise<string> {
  const tool = tools.get(name);
  if (!tool) return `No tool named ${name}.`;
  if (tool.run) return tool.run(input);
  if (tool.mcp) return mcpCall(tool.mcp, name, input, tool.schema);
  return `Tool ${name} has no runner.`;
}

export const harness = { personality, use: registerPlugin, call: callTool, connect: connectMcp, match: matchTool, tools: listTools, plugins: listPlugins };
