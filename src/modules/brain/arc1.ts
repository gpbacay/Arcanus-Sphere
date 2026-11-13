// ARC 1 reads a skill's arguments out of a message, and picks which offered tool applies. It anchors spans of the
// message's own words, so it cannot make a value up. Measured on held-out messages it found the city 6 of 6 times.
// It routes whole conversations poorly, so Hippocampus still chooses the skill (routes.ts); ARC 1 chooses the tool.
import { ORT_PATH } from "@/shared/served";
import { load, type Arc1Agent } from "./arcane/web.mjs";

let agent: Promise<Arc1Agent> | null = null;

/** ARC 1 (5.5 MB, cached by the service worker). Safe to call repeatedly; retried after a failure. */
export function arc1() {
  agent ??= load({ model: "/arcane/arc1.onnx", config: "/arcane/arc1.json", wasmPaths: ORT_PATH }).catch((err: unknown) => {
    agent = null;
    throw err;
  });
  return agent;
}

const LOCAL_TIME = {
  name: "local_time",
  description: "Tell the current local time in a city",
  parameters: [{ name: "city", type: "string", description: "The city whose local time is asked for", required: true }],
};

/** The city a time question asks about, in the message's own words, or null (none named, or ARC 1 unavailable). */
export async function cityIn(text: string): Promise<string | null> {
  try {
    const out = await (await arc1()).run(text, [LOCAL_TIME], { toolPrior: { local_time: 1 } });
    const city = out.function_calls[0]?.arguments.city;
    return typeof city === "string" && city.trim() ? city.trim() : null;
  } catch {
    return null;
  }
}

const SIMPLE = new Set(["string", "number", "integer", "boolean"]);
type Property = { type?: unknown; description?: unknown; enum?: unknown };
export type ToolSchema = { properties?: Record<string, unknown>; required?: unknown };
export type ToolSpec = {
  name: string;
  description: string;
  parameters: { name: string; type: string; description: string; required?: boolean; enum?: string[] }[];
};

/** JSON Schema properties ARC 1 can anchor: simple types, or an enum. */
export function schemaParameters(schema?: ToolSchema): ToolSpec["parameters"] {
  const required = Array.isArray(schema?.required) ? schema.required.map(String) : [];
  return Object.entries(schema?.properties ?? {}).flatMap(([name, raw]) => {
    const p = (raw ?? {}) as Property;
    const type = String((Array.isArray(p.type) ? p.type.find((t) => t !== "null") : p.type) ?? "string");
    const options = Array.isArray(p.enum) ? p.enum.map(String) : undefined;
    if (!options && !SIMPLE.has(type)) return [];
    return [{ name, type, description: String(p.description ?? name), enum: options, required: required.includes(name) }];
  });
}

/**
 * Which offered tool applies, and its arguments, or null when none fires or ARC 1 is unavailable.
 * `prior` forces a tool the command already named (1 = certain); without it ARC 1 chooses.
 */
export async function chooseTool(text: string, tools: ToolSpec[], prior?: Record<string, number>): Promise<{ name: string; arguments: Record<string, unknown> } | null> {
  const offered = tools.filter((tool) => tool.parameters.length);
  if (!offered.length) return null;
  try {
    const out = await (await arc1()).run(text, offered, prior ? { toolPrior: prior } : {});
    const call = out.function_calls[0];
    return call ? { name: call.name, arguments: call.arguments ?? {} } : null;
  } catch {
    return null;
  }
}

/** What the search engine offers ARC 1: its own files first, the web for what isn't on this device. */
const SEARCH_TOOLS: ToolSpec[] = [
  {
    name: "search_files",
    description: "Find words, code, notes or a file by its name in Arcanus's own files, memory, books and source code on this device.",
    parameters: [{ name: "query", type: "string", description: "The words, code or file name to find", required: true }],
  },
  {
    name: "search_web",
    description: "Search the internet for news, facts, people, places, prices, websites and anything that is not on this device.",
    parameters: [{ name: "query", type: "string", description: "The words to search the internet for", required: true }],
  },
];

/**
 * Where a search belongs, by ARC 1: Arcanus's own files, or the web too. `query` is the words ARC 1 anchored (the
 * whole text when it anchored none). Without ARC 1, files: they are always there, and the web may not be.
 */
export async function searchIntent(text: string): Promise<{ where: "files" | "web"; query: string; by: "ARC 1" | "default" }> {
  const call = await chooseTool(text, SEARCH_TOOLS);
  const anchored = typeof call?.arguments.query === "string" && call.arguments.query.trim() ? call.arguments.query.trim() : text.trim();
  if (!call) return { where: "files", query: text.trim(), by: "default" };
  return { where: call.name === "search_web" ? "web" : "files", query: anchored, by: "ARC 1" };
}

/**
 * An MCP tool's arguments read from `text` by its JSON Schema (simple-typed fields only), or {} when ARC 1 can't
 * anchor every required field or is unavailable. Measured on 8 tool requests it read 5 right where the old way (the
 * whole message as the first field) read 2; its misses are a wrong word ("weather tool for Manila in celsius" gave
 * city "celsius"). The schema's `required` matters: with every field optional it read almost nothing.
 */
export async function toolArguments(text: string, tool: { name: string; description: string; schema?: ToolSchema }): Promise<Record<string, unknown>> {
  const chosen = await chooseTool(text, [{ name: tool.name, description: tool.description, parameters: schemaParameters(tool.schema) }], { [tool.name]: 1 });
  return chosen?.arguments ?? {};
}
