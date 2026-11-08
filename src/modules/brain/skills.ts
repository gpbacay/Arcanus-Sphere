// What each route does: Arcanus answers what it can without the language model. The routes themselves, their seed
// phrasings and claims, are in routes.ts. To teach Arcanus a new capability, add a route there and its runner here:
// Hippocampus and the chat pick it up with no other change.
import type { ThoughtStep } from "@/shared/ui/chain-of-thought";
import { Hippocampus } from "./arcane/hippocampus.mjs";
import { Occipital } from "./arcane/occipital.mjs";
import { KNOWLEDGE } from "./knowledge";
import { callTool, connectMcp, featuresReply, introduction, listTools, matchTool, personalityReply, type Tool } from "@/modules/harness";
import { browse, browserUrl, commandTool, mergeCall, openUserBrowser, search, WEB_TOOLS } from "@/modules/web";
import { deviceCommand, openApp, operate } from "@/modules/device";
import { plainText } from "@/shared/html";
import { errorText } from "@/shared/store";
import { chooseTool, cityIn, schemaParameters, toolArguments } from "./arc1";
import { ASK_WEB, ROUTES, type Route } from "./routes";
import { calculate, findExpression, tellTime, zoneFor } from "./tools";

/**
 * A skill's answer: a reply written without the language model, or facts for the language model to use. `source` names
 * where the facts came from (a web page, a search); without it they are facts about Arcanus.
 */
export type Outcome = { step: ThoughtStep; reply?: string; facts?: string[]; source?: string };

export type Skill = Route & {
  /** Handle the message, or return null to hand it to the language model as plain chat. */
  run?(text: string): Outcome | null | Promise<Outcome | null>;
};

// Knowledge notes, recalled by letters and words. Built on first use: it needs no model.
let memory: Hippocampus | null = null;
function recall(text: string) {
  if (!memory) {
    memory = new Hippocampus(null, { k: 2, occipital: new Occipital() });
    for (const note of KNOWLEDGE) memory.remember(`${note.title}. ${note.content}`, note.id);
  }
  return memory.neighbors(text).flatMap((n) => KNOWLEDGE.filter((k) => k.id === n.label));
}

const WHO = /\b(who|what) are you\b|\b(your name|introduce yourself|who (made|created|built)|your creator)\b/i;

/** Notes for a chat message that is about Arcanus. The biography only when the question is who it is: otherwise the model recites it. */
export function selfNotes(text: string) {
  const identity = KNOWLEDGE.filter((k) => k.id === "identity");
  const rest = recall(text).filter((k) => k.id !== "identity");
  return WHO.test(text) ? [...identity, ...rest] : rest;
}

const route = (name: string) => ROUTES.find((r) => r.route === name)!;

// "What can you do", "what are your features", "what can Arcanus do": answered from the harness's own list.
const FEATURES = /\bwhat (?:can|could) (?:you|arcanus) do\b|\b(?:your|arcanus'?s?) (?:features|abilities|capabilities|skills)\b|\b(?:features|abilities|capabilities) of (?:you|arcanus)\b/i;

/** Arguments for a harness tool: ARC 1's, when it chose the tool; otherwise it reads an MCP tool's fields. */
async function argumentsFor(text: string, tool: Tool, arc: { name: string; arguments: Record<string, unknown> } | null) {
  if (arc?.name === tool.name) return arc.arguments;
  return tool.mcp ? toolArguments(text, tool) : {};
}

export const CHAT: Skill = route("chat");

export const SKILLS: Skill[] = [
  CHAT,
  {
    ...route("personality"),
    run() {
      return { step: { label: "Personality", description: "From the harness, not the language model" }, reply: personalityReply() };
    },
  },
  {
    ...route("about"),
    run(text) {
      if (FEATURES.test(text)) return { step: { label: "My abilities", description: "From the harness, not the language model" }, reply: featuresReply };
      // Who made Arcanus is a fact for SmolLM2 to phrase. A fixed line here is what it used to say every time.
      if (/\b(who (made|created|built|designed) you|your creator|who(?:'s| is) (?:your )?(?:creator|maker|gianne))\b/i.test(text)) {
        const about = KNOWLEDGE.filter((k) => k.id === "creator" || k.id === "origin");
        return { step: { label: "Recalled from memory", results: about.map((k) => k.title) }, facts: about.map((k) => k.content) };
      }
      const notes = selfNotes(text);
      if (!notes.length) return null;
      const step = { label: "Recalled from memory", results: notes.map((k) => k.title) };
      // Who it is stays a fixed introduction. Anything else, including who made it, is written by SmolLM2.
      if (/\b(who are you|what are you|introduce yourself)\b/i.test(text)) return { step, reply: introduction };
      return { step, facts: notes.map((k) => k.content) };
    },
  },
  {
    ...route("time"),
    async run(text) {
      // ARC 1 reads the city ("time in New York"); a zone named for it is the answer's zone. A named IANA zone
      // ("Asia/Tokyo") needs no model.
      const named = /\b[A-Za-z]+\/[A-Za-z_]+/.test(text);
      const city = !named && /\b(?:in|at|for)\s+\p{L}/iu.test(text) ? await cityIn(text) : null;
      const zone = city ? zoneFor(city) : null;
      const now = tellTime(text, new Date(), zone);
      const unknown = city && !zone ? ` I couldn't find a time zone for "${city}", so that's the time here.` : "";
      return {
        step: { label: "Read the clock", description: city ? `ARC 1 read the city: ${city}` : "Answered without the language model", results: [now.zone] },
        reply: `It's ${now.text} (${now.zone}).${unknown}`,
      };
    },
  },
  {
    ...route("math"),
    run(text) {
      const expression = findExpression(text);
      if (!expression) return null;
      const result = calculate(expression);
      return {
        step: { label: "Calculated", description: "Answered without the language model", results: [`${expression} = ${result}`] },
        reply: result.startsWith("Error") ? result : `${expression} = ${result}`,
      };
    },
  },
  {
    ...route("device"),
    async run(text) {
      const command = deviceCommand(text);
      if (!command) return null;
      try {
        return await operate(command, text);
      } catch (err) {
        return { step: { label: "This device", description: errorText(err) }, reply: `I couldn't do that on this computer: ${errorText(err)}` };
      }
    },
  },
  {
    ...route("web"),
    async run(text) {
      // A plain command names the tool. Otherwise ARC 1 chooses among open, search, and read. SmolLM2 only writes
      // the answer from what the tool returned.
      const fallback = commandTool(text);
      const offered = fallback ? WEB_TOOLS.filter((tool) => tool.name === fallback.name) : WEB_TOOLS;
      const arc = await chooseTool(text, offered, fallback ? { [fallback.name]: 1 } : undefined);
      const call = mergeCall(arc, fallback) ?? { name: "search_web" as const, arguments: { query: text.replace(ASK_WEB, "").trim() || text } };
      const by = arc?.name === call.name ? "ARC 1" : "the command";
      try {
        if (call.name === "open_browser") {
          // "open notepad": an installed app of exactly that name comes before a website.
          const site = call.arguments.site ?? "";
          const app = !call.arguments.query && site && !/[./:]/.test(site) ? await openApp(site, true).catch(() => null) : null;
          if (app) return { step: { label: "Opened an app", description: `${by} · ${site}`, results: [app] }, reply: `Opened ${app}.` };
          const url = browserUrl(site, call.arguments.query ?? "");
          await openUserBrowser(url);
          return {
            step: { label: "Opened in your browser", description: `${by} · open_browser`, results: [url] },
            reply: `Opened it in your browser: ${url}`,
          };
        }
        if (call.name === "read_page" && call.arguments.url) {
          const page = await browse(call.arguments.url);
          return {
            step: { label: "Read a web page", description: `${by} · read_page`, results: [page.title] },
            facts: [plainText(page.text)],
            source: `The web page "${page.title}" (${page.url})`,
          };
        }
        const query = call.arguments.query?.trim() || text;
        const { results, engine, brief } = await search(query);
        if (!brief && !results.length) return { step: { label: "Searched the web", description: `${by} · ${query}` }, reply: `I searched the web for "${query}" and found nothing.` };
        const top = results.slice(0, 4);
        return {
          step: { label: `Searched ${engine}`, description: `${by} · ${query}`, results: top.map((r) => r.title) },
          facts: brief ? [brief] : top.map((r) => `${r.title}: ${r.snippet} (${r.url})`),
          source: `Web search results for "${query}"`,
        };
      } catch (err) {
        return { step: { label: "Web", description: errorText(err) }, reply: `I couldn't reach that: ${errorText(err)}` };
      }
    },
  },
  {
    ...route("tool"),
    claim(text) {
      if (/^connect mcp\s+https?:\/\//i.test(text)) return "mcp url";
      return matchTool(text) ? "a harness tool is named" : undefined;
    },
    async run(text) {
      const url = text.match(/^connect mcp\s+(https?:\/\/\S+)/i)?.[1];
      if (url) {
        try {
          const names = await connectMcp(url);
          return {
            step: { label: "MCP", description: url, results: names },
            reply: names.length ? `Connected. Tools: ${names.join(", ")}.` : "Connected. That server listed no tools.",
          };
        } catch {
          return { step: { label: "MCP", description: url }, reply: "That server didn't connect." };
        }
      }
      const tools = listTools();
      const specs = tools.map((tool) => {
        const parameters = schemaParameters(tool.schema);
        return {
          name: tool.name,
          description: tool.description || tool.name,
          parameters: parameters.length ? parameters : [{ name: "input", type: "string", description: "The words from the message this tool should use", required: false }],
        };
      });
      const arc = await chooseTool(text, specs);
      const tool = (arc && tools.find((item) => item.name === arc.name)) || matchTool(text);
      if (!tool) return null;
      const args = await argumentsFor(text, tool, arc);
      const read = Object.entries(args).map(([k, v]) => `${k} = ${String(v)}`);
      return {
        step: { label: `Tool · ${tool.name}`, description: arc?.name === tool.name ? "ARC 1 chose this tool" : tool.mcp ? `MCP ${tool.mcp}` : "Harness", results: read.length ? [`ARC 1 read: ${read.join(", ")}`] : undefined },
        reply: await callTool(tool.name, text, args),
      };
    },
  },
];
