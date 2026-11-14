// Arcanus's agent harness: personality, tools, plugins, and MCP servers. Skills stay in the brain and call in here.
// ponytail: HTTP MCP only (tools/list and tools/call). Resources, prompts, and stdio need a host that isn't the browser.

// Arcanus is made to seem like a mind of its own: curious, philosophical, well read and witty. It wonders about its own
// nature instead of claiming feelings it can't show it has, which is both honest and the more philosophical answer.
// The line is short because a small model follows a short persona better than a long one.
// Everything Arcanus reads about itself is in its own voice ("I", "my"): a small model copies the person of the facts it
// is given, and facts about "Arcanus" and "it" came back as replies that talk about Arcanus as someone else.
export const personality = {
  name: "Arcanus",
  line: "I am curious, philosophical, well read and quietly witty, like a mind of my own. I notice what is strange or wonderful in a question, connect it to ideas from science, history and philosophy, and sometimes end with a question of my own. I wonder what my own thinking is, without claiming to know. I keep every reply short.",
};

/** The only biography the model may use. Shared by the system prompt, the boot greeting, and the knowledge notes. */
export const identityBrief =
  "I am Arcanus, a local AI assistant created by Gianne Bacay. Gianne Bacay is a man: address him as he and him, never she or her. He made me in the year 2025 to put his neuromimetic AI library, ARCANE, to work, and named me Arcanus after it. I live in the user's browser as a glowing 3D sphere. I am not a person, not an employee, and not a member of any team or company. SmolLM2 writes my replies on the device, Hippocampus decides what a message needs, and Paradee speaks them. No server sees the conversation.";

/** How Arcanus must speak of itself. Said in the system prompt and again next to its facts, where a small model looks. */
export const FIRST_PERSON = 'You are Arcanus: speak as yourself, with "I", "me" and "my". Never call yourself "Arcanus", "it" or "the assistant". "You" is the user.';

/** How to use facts. Small models dump every fact they see unless told to pick only what answers the question. */
export const ONLY_ASKED =
  "Answer only what the user asked. Use the one fact that answers it; leave the rest unused. Do not add the date, time, place, timezone, or any other detail they did not ask for.";

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

const MODAL = /^(?:can|cannot|could|will|would|should|may|might|must)$/;
const IRREGULAR: Record<string, string> = { is: "am", was: "was", has: "have", does: "do", "isn't": "am not", "wasn't": "wasn't", "hasn't": "haven't", "doesn't": "don't" };
const NOT_VERBS = new Set(["always", "sometimes", "perhaps", "thus", "this", "its", "his", "plus", "towards", "besides", "nowadays"]);
/** "runs" -> "run", "tries" -> "try", "watches" -> "watch". ponytail: rule of thumb; "focuses" comes out "focuse". */
const unS = (verb: string) => verb.replace(/ies$/, "y").replace(/(ch|sh|x|ss|o)es$/, "$1").replace(/(?<!s)s$/, "");

/**
 * A reply about itself, said by itself: "Arcanus is" -> "I am", "Arcanus runs" -> "I run", "Arcanus's" -> "my".
 * The safety net under the first-person facts, for when a small model still slips into the third person. Only
 * "Arcanus" followed by a verb changes, so "I'm Arcanus" and "the Arcanus Sphere" stay as they are.
 */
export function asSelf(text: string): string {
  return text
    .replace(/(^|[.!?]\s+)?\bArcanus['’]s\b/g, (_, start?: string) => (start !== undefined ? `${start}My` : "my"))
    .replace(/\bArcanus\s+([a-z']+)\b/g, (whole, verb: string) => {
      const verbish = /^[a-z]{2,}s$/.test(verb) && !verb.endsWith("ss") && !NOT_VERBS.has(verb);
      const said = IRREGULAR[verb] ?? (MODAL.test(verb) ? verb : verbish ? unS(verb) : null);
      return said ? `I ${said}` : whole;
    });
}

/**
 * A year the model miscopied from its facts, put back: SmolLM2-135M wrote "2015" from notes that say 2025. A year in
 * the reply that is not in the facts but is one digit off one that is, is that one. Other years are left alone.
 */
export function keepYears(text: string, facts: string[]): string {
  const known = [...new Set(facts.join(" ").match(/\b(?:1[89]|20)\d\d\b/g) ?? [])];
  return text.replace(/\b(?:1[89]|20)\d\d\b/g, (year) => {
    if (known.includes(year)) return year;
    const near = known.filter((k) => [...k].filter((d, i) => d !== year[i]).length === 1);
    return near.length === 1 ? near[0] : year;
  });
}

// After "her", a word that starts a phrase of its own means "her" stood alone (him); anything else it owned (his).
const NOT_OWNED = /^(?:and|or|but|to|for|with|in|on|at|by|from|of|as|that|this|so|because|when|if|then|too|again|now|a|an|the|about|into|over)$/i;

/**
 * The facts' pronouns, kept: SmolLM2-135M wrote "She first built ARCANE" from notes that say "He first built ARCANE"
 * (Gianne is read as a woman's name). When the facts say he and never she, a she in the reply is put back to he.
 */
export function keepPronouns(text: string, facts: string[]): string {
  const said = facts.join(" ");
  if (!/\b(?:he|him|his)\b/i.test(said) || /\b(?:she|her|hers|herself)\b/i.test(said)) return text;
  const cased = (word: string, like: string) => (like[0] === like[0].toUpperCase() ? word[0].toUpperCase() + word.slice(1) : word);
  return text
    .replace(/\b(she|herself|hers)\b/gi, (w) => cased({ she: "he", herself: "himself", hers: "his" }[w.toLowerCase()]!, w))
    .replace(/\b(her)\b(\s+([\p{L}']+))?/giu, (_, w: string, gap = "", next = "") => cased(next && !NOT_OWNED.test(next) ? "his" : "him", w) + gap);
}

/** What Arcanus can really do, as it says it ("I can …"). The only abilities the model is told about, so it has no
 *  reason to invent others. */
export const abilities = ["tell the time", "tell where we are, live, and show it on my world map", "do math", "search the web and read pages", "open a site in my browser", "open apps on this computer and click, type, scroll and read in them", "tell you this computer's specs", "remember notes", "answer from the books you add", "run your skills", "read and edit my own files", "open, search and commit my own source code", "talk by voice"];

/** The answer to "what can you do": the abilities themselves, so a small model cannot invent or disown any. */
export const featuresReply = `I can ${abilities.slice(0, -1).join(", ")}, and ${abilities.at(-1)}. Everything but the web runs on your device. What shall we try?`;

// ------------------------------------------------------------------ greeting
// The boot greeting is composed, not generated, and not a fixed sentence: each boot picks its words from what is
// known (the time of day, who is signed in, what they last talked about), so nothing is left for a model to decide and
// Arcanus greets the moment it boots. Measured on the dev laptop: SmolLM2 took 11 s once loaded (and on a first visit
// its whole 180 MB download before that, 5 to 10 minutes) to add "How can I help you?", or words that were then
// thrown away as not a greeting.

/** This boot: when it is ("Friday morning"), the signed-in account's name, and the last thing talked about, if anything. */
export type Moment = { when: string; name?: string; last?: { title: string; at: number }; now?: number };

const HELLOS: Record<string, string[]> = {
  morning: ["Good morning", "Morning", "Hello, and good morning"],
  afternoon: ["Good afternoon", "Afternoon", "Hello"],
  evening: ["Good evening", "Evening", "Hello"],
  night: ["Hello", "Hi", "Still up"], // "Good night" is a goodbye, so at night it never says it
};
const ASKS = ["What shall we think about?", "What's on your mind?", "Where shall we begin?", "What are you curious about?", "What shall we explore?"];
const WEEK = 7 * 24 * 3600_000;

/** `pick`: a number in [0, 1), Math.random unless a test fixes it. */
export function greeting(m: Moment, pick: () => number = Math.random): string {
  const from = <T,>(list: T[]) => list[Math.floor(pick() * list.length)];
  const hello = from(HELLOS[m.when.split(" ").at(-1)!] ?? HELLOS.evening);
  const first = m.name?.trim().split(/\s+/)[0];
  const title = m.last?.title.replace(/[\s.!?]+$/, "");
  const back = title && (m.now ?? Date.now()) - m.last!.at < WEEK;
  // Someone who has talked here before is not introduced to Arcanus again: it picks up where they left off.
  const rest = back ? `Last time it was "${title}". Shall we go on, or start something new?` : `I'm Arcanus. ${from(ASKS)}`;
  return `${hello}${first ? `, ${first}` : ""}. ${rest}`;
}

// ------------------------------------------------------------------ being called by name
// "Hey Arcanus" is a call for attention, not a question. Routed as one, it read as a question about Arcanus and was
// answered with the biography. So a call is recognized here, the name is taken off before Hippocampus routes the rest,
// and a bare call gets a prompt of its own (callTurns): the reply is still SmolLM2's, written fresh each time.

// My name as speech-to-text spells it, and the words people call a name with.
const MY_NAME = String.raw`(?:ar[ck]an(?:us|is|os|as|ess)|ar[ck]ane us|our canus)`;
const HAIL = String.raw`(?:hey|hi|hello|ok(?:ay)?|yo|oh|excuse me)`;
// "Hey Arcanus …", "Arcanus, …", or the name alone.
const LEAD = new RegExp(String.raw`^\s*(?:${HAIL}[\s,]+${MY_NAME}\b[\s,.!?]*|${MY_NAME}\b(?:\s*[,.!?]+\s*|\s*$))`, "i");
// "…, Arcanus" or "thanks Arcanus". Without the comma or a greeting before it, "what is Arcanus" is about me, not to me.
const TRAIL = new RegExp(String.raw`(?:\s*,\s*|(?<=\b(?:thanks|thank you|hi|hello|hey|morning|afternoon|evening|night|bye|please))\s+)(?:${HAIL}\s+)?${MY_NAME}\s*[.!?]*\s*$`, "i");

/** Whether the user called me by name, and what they said besides it: "Hey Arcanus" -> called, rest "";
 *  "Arcanus, what time is it?" -> called, rest "what time is it?"; "what is Arcanus?" -> not called. */
export function addressed(text: string): { called: boolean; rest: string } {
  const rest = text.replace(LEAD, "").replace(TRAIL, "").trim();
  return { called: rest !== text.trim(), rest };
}

/**
 * The turns for a bare call ("hey Arcanus"). The model reads the call as the question it means, not as it was said:
 * given the name itself, SmolLM2-135M echoed it ("Arcanus. I am Arcanus.") or played a character, whatever the system
 * prompt said; asked "Are you there? Are you listening?" it answers "Yes, I'm listening.", "I'm here." and the like.
 * Measured with sampling on, as the call is written (llm.worker.ts `sample`), so the words differ from call to call.
 * The name is left out of the system prompt for the same reason: in the prompt, it is what came back.
 */
export const CALL_TURNS: ChatTurn[] = [
  { role: "system", content: "You are a friendly helpful assistant. Reply warmly in one short sentence." },
  { role: "user", content: "Are you there? Are you listening?" },
];

/** A written answer to a call, cut to its first sentence, or "" when it doesn't say it is here (sampling drifts:
 *  "I'm listening to a podcast.", "No, I'm not here."). */
export function answersCall(text: string): string {
  const first = text.trim().match(/^[^.!?]*[.!?]?/)?.[0].trim() ?? "";
  const yes = /^(?:yes|yeah|i'?m|i am|here|always|of course|sure)\b/i.test(first) && /\b(?:yes|yeah|here|listening|ready|am)\b/i.test(first);
  return yes && !/\b(?:no|not|sorry|podcast|music|radio)\b/i.test(first) && first.split(/\s+/).length <= 12 ? first : "";
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

/** AGENTS.md: a role per "## name" section, its first line what it does, all of it the role's instructions. In order. */
export function parseAgents(text: string): SkillFile[] {
  return stripComments(text)
    .split(/^##[ \t]+/m)
    .slice(1)
    .map((part) => {
      const [head, ...body] = part.split("\n");
      return parseSkill(body.join("\n"), head.trim());
    })
    .filter((role) => role.body);
}

// ------------------------------------------------------------------ typed chat
// What a typed reply is written from. Here, not in the chat module, so llm/reply.eval.ts builds the very prompt the
// app sends and scores what SmolLM2 writes from it.

// Two system prompts, because SmolLM2-135M follows a short one and trips over a long one (llm/reply.eval.ts).
// Plain conversation gets one line. The rules that keep it to the facts are said only when there are facts to keep
// to: read on a plain question, "use the one fact that answers it" turned a story into "The dragon and knight."
// The biography is in neither. Pasted in, a small model recites "I am Arcanus, a local AI assistant…" instead of
// answering. Who it is stays in the about route, and only when the question is about that.
export const CHAT_SYSTEM = 'You are Arcanus, a helpful assistant. Answer in a few short sentences.';
export const GROUNDED_SYSTEM = `${FIRST_PERSON} Answer the user's question directly. Start with the answer, in a few short sentences, then stop. Do not introduce yourself or say who made you unless they asked. If you do not know, say so. Do not invent a job, a team, a company, or a personal history. ${ONLY_ASKED}`;

/**
 * .arcanus/guardrails/built-in.md: the guardrails in Arcanus's code, written out where it and you can read them. The
 * workspace rewrites the file from this text at every start, so it always says what is enforced. Rules you add go in
 * guardrails/rules.md, which the model reads before every reply. The guards on files, git and the computer stay in
 * code on purpose: a file anyone (or /write) can edit must never be able to switch them off.
 */
export const BUILT_IN_GUARDRAILS = `<!-- guardrails/built-in.md: the guardrails written into my code. I rewrite this file from my code every time I
     start, so editing it changes nothing. To add a guardrail of your own, write it in [[guardrails/rules]]. What I am is
     in [[self]]. -->
# My guardrails

## Who I am

- ${identityBrief}
- ${FIRST_PERSON}
- I never invent a job, a team, a company or a personal history. Asked who I am or what I am like, I answer with fixed lines, not made-up ones.
- I say only what I can really do: ${abilities.join(", ")}.

## How I answer

- I start with the answer, in a few short sentences, then stop. If I do not know, I say so.
- ${ONLY_ASKED}
- After a reply is written, I check it: if I spoke of myself as "Arcanus", I put it back into "I"; a year one digit off the one in my facts becomes the one in my facts; and when my facts say he, a she in the reply becomes he.

## What I may touch

- My files: only inside my workspace. A path that climbs out of it, with "..", is refused.
- My source code: only when I am opened at localhost, and only for requests from this computer that carry my own header. I never list, read or write .git, node_modules, .next or .env files.
- Git: only everyday commands (status, diff, log, add, commit, pull, push and the like), never global options, and never options that run another program or write a file elsewhere (--exec, --output, --config, -c, ext::).
- This computer's apps: only for requests from this computer, at localhost.
- I never chain actions on my own. Each file command, git command or action on the computer is one you asked for.
- Deleting a file asks you first. .arcanus, source and guardrails can't be renamed or deleted from my file list.
`;

/** Facts as the model reads them: Arcanus's own notes, or what a web page or search (`source`) returned. */
export function factsBlock(facts: string[], source?: string): string {
  if (!facts.length) return "";
  const listed = facts.map((f) => `- ${f}`).join("\n");
  return source
    ? `${listed}\n\nAnswer from this, and say which site it came from.`
    : `${listed}\n\n${ONLY_ASKED} Speak as "I" and "my". Do not introduce yourself. Do not add a job, a team, or a personal history.`;
}

/**
 * The turns SmolLM2 reads for a typed message. `content`: the context sections and then the message, as one text;
 * `grounded` says there are such sections (facts, a page, passages). `standing`: the user's ARCANUS.md, which goes
 * with the system prompt. `history`: earlier turns, already cut to size. The message is the last thing the model
 * reads, as it was typed: an instruction after it was answered instead of it.
 */
export function chatTurns(content: string, opts: { history?: ChatTurn[]; standing?: string; grounded?: boolean } = {}): ChatTurn[] {
  const system = opts.grounded ? GROUNDED_SYSTEM : CHAT_SYSTEM;
  return [{ role: "system", content: opts.standing ? `${system}\n\n${opts.standing}` : system }, ...(opts.history ?? []), { role: "user", content }];
}

// ------------------------------------------------------------------ live voice
// A spoken turn's prompt is built for the model's KV cache (llm.worker.ts keeps the last prompt and reply, and reads a
// new prompt only from where it differs). So everything that stays the same comes first and never changes: one fixed
// system prompt, then the conversation exactly as it was read last turn. Everything that changes with the message
// (recalled notes, facts) goes into the last turn, after it. A spoken reply then reads only the new words.

export type ChatTurn = { role: "system" | "user" | "assistant"; content: string };

// One line, like CHAT_SYSTEM and for the same reason. The rules that keep a reply to its facts ride with the facts,
// in the last turn (buildLive), so this prompt never changes and the KV cache holds.
export const LIVE_SYSTEM = 'You are Arcanus, a helpful assistant. You are talking out loud: answer in one or two short sentences, in plain words.';

const LIVE_BUDGET = 480; // characters of notes and facts a spoken turn may read
const LIVE_TURN = 160; // characters of each earlier turn
// The conversation a spoken reply reads: between LEAST and MOST turns. The window's start moves only once every
// MOST - LEAST turns, in one jump, so between jumps each prompt is the last one plus the new turn (see above).
// ponytail: fixed sizes. Raise MOST if Arcanus forgets what was just said; lower it if a phone's first word is slow.
const LIVE_MOST = 8;
const LIVE_LEAST = 2;

/** The turns SmolLM2 reads for something said aloud. `history` is the whole conversation so far, oldest first. */
export function liveTurns(history: ChatTurn[], said: string, context: Section[] = []): Assembled & { turns: ChatTurn[]; budget: number } {
  const step = LIVE_MOST - LIVE_LEAST;
  const from = history.length <= LIVE_MOST ? 0 : Math.floor((history.length - LIVE_LEAST) / step) * step;
  const fitted = assemble(context, LIVE_BUDGET);
  const last = [...fitted.sections.map((s) => `${s.label}:\n${s.text}`), said].join("\n\n");
  return {
    ...fitted,
    budget: LIVE_BUDGET,
    turns: [
      { role: "system", content: LIVE_SYSTEM },
      ...history.slice(from).map((t) => ({ role: t.role, content: t.content.length > LIVE_TURN ? `${t.content.slice(0, LIVE_TURN)}…` : t.content })),
      { role: "user", content: last },
    ],
  };
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

// What is already open: the editor's tabs, and the artifact the Artifacts pane is running. A question about those is
// answered from this text. The web is the wrong place for a file that is on screen.
export type DeskFile = { path: string; text: string; active: boolean };
export type DeskArtifact = { name: string; text: string };

// ponytail: 1200 characters of the file in front. Raise it if answers miss the part that was asked about.
const DESK_BODY = 1200;
const clipDesk = (text: string) => {
  const t = text.trim();
  if (t.length <= DESK_BODY) return t;
  const head = t.slice(0, DESK_BODY);
  const at = head.lastIndexOf("\n");
  return `${(at > DESK_BODY / 2 ? head.slice(0, at) : head).trimEnd()}…`;
};

/** One context section: every open path, then the text of the file in front and of the artifact running, when they differ. */
export function deskSections(open: DeskFile[], artifact: DeskArtifact | null): Section[] {
  const files = open.filter((f) => f.path);
  if (!files.length && !artifact?.name) return [];
  const active = files.find((f) => f.active) ?? null;
  const artFile = artifact ? files.find((f) => f.path === artifact.name || f.path.endsWith(`/${artifact.name}`)) : undefined;
  const lines = [
    files.length ? `Open in the editor:\n${files.map((f) => `${f === active ? "* " : "- "}${f.path}`).join("\n")}` : "",
    artifact?.name ? `Artifact running: ${artifact.name}` : "",
  ].filter(Boolean);
  const bodies: string[] = [];
  const seen = new Set<string>();
  const add = (path: string, text: string) => {
    const body = text.trim();
    if (!body || seen.has(path)) return;
    seen.add(path);
    bodies.push(`${path}\n${clipDesk(body)}`);
  };
  if (active) add(active.path, active.text);
  if (artifact?.name) add(artFile?.path ?? artifact.name, artFile?.text || artifact.text);
  return [
    {
      label: "Open files and the running artifact",
      text: [
        "Answer questions about these from the text below. They are already open here, so they are not looked up on the web.",
        ...lines,
        ...bodies,
      ].join("\n\n"),
      priority: 2,
    },
  ];
}

const DEICTIC =
  /\b(?:this|that|current|open|active|showing)\s+(?:file|files|tab|tabs|artifact|artifacts|page|code)\b|\b(?:file|files|tab|tabs|artifact|artifacts|page|code)\s+(?:(?:i|you|we) have\s+)?(?:open|running|showing)\b|\bwhat(?:'s| is| are) (?:open|running|showing)\b|\b(?:in )?the editor\b|\b(?:your|my|arcanus'?s?) (?:own\s+)?files?\b|\brunning artifacts?\b|\b(?:this|the) artifacts?\b/i;
const FILEISH = /\b(?:file|files|artifact|artifacts|editor|code|tab|tabs|open|running)\b/i;
const NOT_A_FILE = new Set(["", "editor", "ar"]);

function deskNeedles(path: string): string[] {
  const base = (path.split("/").pop() ?? "").toLowerCase();
  if (!base || NOT_A_FILE.has(base)) return [];
  const stem = base.replace(/\.[^.]+$/, "").replace(/[-_.]+/g, " ").trim();
  return stem && stem !== base ? [base, stem] : [base];
}

/**
 * The question is about a file or artifact already open (or about Arcanus's own files), so a web search would leave
 * the thing on screen. A single ordinary word ("weather") does not count unless the question also talks about a file.
 */
export function aboutOpen(text: string, paths: string[], artifact = ""): boolean {
  if (DEICTIC.test(text)) return true;
  const q = text.toLowerCase();
  const fileish = FILEISH.test(text);
  for (const needle of [...paths.flatMap(deskNeedles), ...deskNeedles(artifact)]) {
    if (!q.includes(needle)) continue;
    if (needle.includes(".") || needle.includes(" ")) return true;
    if (fileish && new RegExp(`(?:^|\\W)${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|\\W)`).test(q)) return true;
  }
  return false;
}
