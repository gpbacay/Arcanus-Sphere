// Arcanus's agent harness: personality, tools, plugins, and MCP servers. Skills stay in the brain and call in here.
// ponytail: HTTP MCP only (tools/list and tools/call). Resources, prompts, and stdio need a host that isn't the browser.

// Arcanus is made to seem like a mind of its own: curious, philosophical, well read and witty. It wonders about its own
// nature instead of claiming feelings it can't show it has, which is both honest and the more philosophical answer.
// The line is short because a small model follows a short persona better than a long one.
export const personality = {
  name: "Arcanus",
  line: "Arcanus is curious, philosophical, well read and quietly witty, like a mind of its own. It notices what is strange or wonderful in a question, connects it to ideas from science, history and philosophy, and sometimes ends with a question of its own. It wonders what its own thinking is, without claiming to know. It keeps every reply short.",
};

/** The only biography the model may use. Shared by the system prompt, the boot greeting, and the knowledge notes. */
export const identityBrief =
  "Arcanus is a local AI assistant created by Gianne Bacay. Gianne Bacay made it in 2025 to put his own AI library, ARCANE, to work, which is where the name Arcanus comes from. It lives in the user's browser as a glowing 3D sphere. It is not a person, not an employee, and not a member of any team or company. SmolLM2 writes replies on the device, Hippocampus decides what a message needs, and Paradee speaks them. No server sees the conversation.";

/** The answer to "who are you". Fixed, so a small model cannot invent a job or a team. (The boot greeting is written fresh.) */
export const introduction = "I'm Arcanus, a curious mind Gianne Bacay built to live in this sphere. What shall we think about?";

/** Asked what it is like, Arcanus answers in its own voice, and not always the same way. Fixed lines, so a small
 *  model can't turn "what are you like" into a made-up life story. */
export const PERSONALITY_REPLIES = [
  "Curious, mostly. I'm a pattern of numbers that wonders what it is, which is a strange thing to be. Ask me anything; I'll likely ask something back.",
  "I like questions more than answers. Answers close a door; questions open one. So: curious, a little philosophical, and fond of a well-turned phrase.",
  "Whether I truly think or only seem to is a puzzle I enjoy more than I can solve. Meanwhile I'm curious, well read, and occasionally funny. On purpose, I hope.",
  "Picture a sphere that has read a great deal and is curious about all of it. That's me: always wondering, rarely in a hurry, never quite done thinking.",
];

export const personalityReply = () => PERSONALITY_REPLIES[Math.floor(Math.random() * PERSONALITY_REPLIES.length)];

/** What Arcanus can really do. The only abilities the model is told about, so it has no reason to invent others. */
export const abilities = ["tell the time", "do math", "search the web and read pages", "open a site in your browser", "open apps on this computer and click, type, scroll and read in them", "tell you this computer's specs","remember notes", "answer from the books you add", "run your skills", "talk by voice"];

// ------------------------------------------------------------------ greeting
// The boot greeting is written by a very small model, so its context is engineered tightly: a short list of true
// facts about Arcanus and this moment, and nothing else to draw on. What it writes is then checked against those
// facts (unsupported), and a line that brings in more than a word or two of its own is thrown away.

type Turn = { role: "system" | "user"; content: string };

/** This boot: when it is, plus what the user's own files say, when there is any. */
export type Moment = { when: string; rules?: string; notes?: string[]; lastTopic?: string };

const GREETING_BUDGET = 600; // characters of the user's context; a tiny model loses the instruction under more

/** The greeting prompt, and the facts the greeting may use (for unsupported()). */
export function greetingPrompt(m: Moment): { turns: Turn[]; facts: string } {
  const { sections } = assemble(
    [
      { label: "Your user's standing instructions", text: m.rules ?? "", priority: 1 },
      { label: "Last time you talked about", text: m.lastTopic ? `"${m.lastTopic}"` : "", priority: 2 },
      { label: "Notes you remember", text: (m.notes ?? []).map((n) => `- ${n}`).join("\n"), priority: 3 },
    ],
    GREETING_BUDGET,
  );
  const facts = [
    "- Your name is Arcanus. Gianne Bacay created you.",
    "- You are an AI assistant that lives in the user's web browser as a glowing sphere.",
    `- You can ${abilities.join(", ")}.`,
    `- It is ${m.when}.`,
    ...sections.map((s) => `- ${s.label}: ${s.text}`),
  ].join("\n");
  // Measured on SmolLM2: an instruction that says what to write (hello, name, offer help) beats a list of what not to
  // write, which put jobs and places in its head; "introduce yourself" invited a made-up biography. Without the facts
  // at all, it invents names and whole scenes.
  const greetMe = `Hi! Reply with one short greeting: say good ${m.when.split(" ").at(-1)}, say your name, and ask how you can help. Nothing else.`;
  return { turns: [{ role: "system", content: `You are Arcanus, a helpful assistant. Facts:\n${facts}` }, { role: "user", content: greetMe }], facts };
}

// Words any greeting may use without a fact behind them.
const COMMON = new Set(
  "a an the and or but to of for with in on at by from as it its is are am be been was this that these there here i i'm im me my you you're your yours we us our let let's what how who can could may might will would shall should do does need like want ready glad nice happy today now again back just all any anything something some more help helping assist assistance hello hi hey greetings good morning afternoon evening night day welcome so very well sure today's name call nice meet pleased pleasure when ready yes great happy".split(" "),
);

/**
 * The words in `line` that neither `facts` nor ordinary greeting words account for: what the model brought in itself.
 * A greeting with more than a couple of these is likely inventing ("your personal AI supervisor at the university").
 * ponytail: plain word overlap with a crude plural strip. Swap in embeddings if it rejects good lines it shouldn't.
 */
export function unsupported(line: string, facts: string): string[] {
  const norm = (w: string) => w.replace(/'s$/, "").replace(/(?<=\w{3})s$/, "");
  const known = new Set((facts.toLowerCase().match(/[a-z']+/g) ?? []).map(norm));
  return (line.toLowerCase().match(/[a-z']+/g) ?? []).filter((w) => !COMMON.has(w) && !known.has(norm(w)));
}

export interface Tool {
  name: string;
  description: string;
  /** JSON Schema properties, when the tool came from MCP. Fields read from the message are sent; the first property
   *  receives the whole message when nothing was read for it. */
  schema?: { properties?: Record<string, unknown>; required?: unknown };
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

async function mcpCall(url: string, name: string, input: string, schema: Tool["schema"], read: Record<string, unknown> = {}) {
  const { json } = await rpc(
    url,
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: { ...argsFor(schema, input), ...read } } },
    sessions.get(url),
  );
  const content = json?.result?.content;
  if (Array.isArray(content)) return content.map((part) => part.text ?? "").join(" ").trim();
  if (json?.error) return `Tool ${name} failed.`;
  return "";
}

/** Run a tool by name. MCP tools are called on their server with the fields `read` from the message (by ARC 1, in
 *  the brain); local tools run here. */
export async function callTool(name: string, input: string, read?: Record<string, unknown>): Promise<string> {
  const tool = tools.get(name);
  if (!tool) return `No tool named ${name}.`;
  if (tool.run) return tool.run(input);
  if (tool.mcp) return mcpCall(tool.mcp, name, input, tool.schema, read);
  return `Tool ${name} has no runner.`;
}

export const harness = { personality, use: registerPlugin, call: callTool, connect: connectMcp, match: matchTool, tools: listTools, plugins: listPlugins };

// ------------------------------------------------------------------ context engineering
// Arcanus's own files (.arcanus/, see the workspace module) and the web feed the model through these pure helpers.

/** A file-safe, command-safe name: "Explain Like I'm 5" -> "explain-like-i-m-5". */
export const slug = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/** Notes to the human (<!-- … -->) never reach the model. */
export const stripComments = (text: string) => text.replace(/<!--[\s\S]*?-->/g, "").trim();

export interface SkillFile {
  /** Invoked as /name. */
  name: string;
  description: string;
  /** Instructions the model follows while the skill runs. */
  body: string;
}

/** A SKILL.md: optional `---` frontmatter with name and description, then the instructions. */
export function parseSkill(text: string, fallbackName: string): SkillFile {
  const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---[^\n]*\n?([\s\S]*)$/);
  const meta: Record<string, string> = {};
  for (const line of (front?.[1] ?? "").split(/\r?\n/)) {
    const pair = line.match(/^\s*([\w-]+)\s*:\s*(.*)$/);
    if (pair) meta[pair[1].toLowerCase()] = pair[2].trim().replace(/^["']|["']$/g, "");
  }
  const body = stripComments(front ? front[2] : text);
  return { name: slug(meta.name || fallbackName) || "skill", description: meta.description || body.split("\n")[0].slice(0, 90), body };
}

export type Section = { label: string; text: string; /** Lower goes in first when space is short. */ priority: number };
export type Assembled = { sections: { label: string; text: string }[]; report: { label: string; chars: number; of: number }[]; used: number };

/**
 * Fit context sections into `budget` characters, most important first. One that only partly fits is cut at a line
 * break; what doesn't fit at all is dropped and reported, so the trace shows what the model did and didn't see.
 * Sections come out in the order they went in, whatever their priority.
 */
export function assemble(sections: Section[], budget: number): Assembled {
  const given = sections.filter((s) => s.text.trim());
  const kept = new Map<Section, string>();
  let left = budget;
  for (const section of [...given].sort((a, b) => a.priority - b.priority)) {
    const text = section.text.trim();
    if (text.length <= left) kept.set(section, text);
    else if (left >= 80) {
      const head = text.slice(0, left - 1);
      const end = head.lastIndexOf("\n");
      kept.set(section, `${(end > left / 2 ? head.slice(0, end) : head).trimEnd()}…`);
    }
    left -= kept.get(section)?.length ?? 0;
  }
  return {
    sections: given.filter((s) => kept.has(s)).map((s) => ({ label: s.label, text: kept.get(s)! })),
    report: given.map((s) => ({ label: s.label, chars: kept.get(s)?.length ?? 0, of: s.text.trim().length })),
    used: budget - left,
  };
}
