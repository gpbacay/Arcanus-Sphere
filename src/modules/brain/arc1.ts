// ARC 1 reads a skill's arguments out of a message: the city in "what time is it in New York", the fields of an MCP
// tool. It anchors spans of the message's own words, so it cannot make a value up. Measured on held-out messages it
// found the city 6 of 6 times; it routes poorly, so it is not in the routing vote (routes.ts).
import { load, type Arc1Agent } from "./arcane/web.mjs";

let agent: Promise<Arc1Agent> | null = null;

/** ARC 1 (5.5 MB, cached by the service worker). Safe to call repeatedly; retried after a failure. */
export function arc1() {
  agent ??= load({ model: "/arcane/arc1.onnx", config: "/arcane/arc1.json" }).catch((err: unknown) => {
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

/**
 * An MCP tool's arguments read from `text` by its JSON Schema (simple-typed fields only), or {} when ARC 1 can't
 * anchor every required field or is unavailable. Measured on 8 tool requests it read 5 right where the old way (the
 * whole message as the first field) read 2; its misses are a wrong word ("weather tool for Manila in celsius" gave
 * city "celsius"). The schema's `required` matters: with every field optional it read almost nothing.
 */
export async function toolArguments(text: string, tool: { name: string; description: string; schema?: ToolSchema }): Promise<Record<string, unknown>> {
  const required = Array.isArray(tool.schema?.required) ? tool.schema.required.map(String) : [];
  const parameters = Object.entries(tool.schema?.properties ?? {}).flatMap(([name, raw]) => {
    const p = (raw ?? {}) as Property;
    const type = String((Array.isArray(p.type) ? p.type.find((t) => t !== "null") : p.type) ?? "string");
    const options = Array.isArray(p.enum) ? p.enum.map(String) : undefined;
    if (!options && !SIMPLE.has(type)) return [];
    return [{ name, type, description: String(p.description ?? name), enum: options, required: required.includes(name) }];
  });
  if (!parameters.length) return {};
  try {
    const out = await (await arc1()).run(text, [{ name: tool.name, description: tool.description, parameters }], { toolPrior: { [tool.name]: 1 } });
    return out.function_calls[0]?.arguments ?? {};
  } catch {
    return {};
  }
}
