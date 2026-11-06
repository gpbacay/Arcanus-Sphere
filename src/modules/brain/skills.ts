// What each route does: Arcanus answers what it can without the language model. The routes themselves, their seed
// phrasings and claims, are in routes.ts. To teach Arcanus a new capability, add a route there and its runner here:
// Hippocampus and the chat pick it up with no other change.
import type { ThoughtStep } from "@/shared/ui/chain-of-thought";
import { Hippocampus } from "./arcane/hippocampus.mjs";
import { Occipital } from "./arcane/occipital.mjs";
import { KNOWLEDGE } from "./knowledge";
import { callTool, connectMcp, introduction, matchTool, personalityReply } from "@/modules/harness";
import { browse, search } from "@/modules/web";
import { plainText } from "@/shared/html";
import { errorText } from "@/shared/store";
import { cityIn, toolArguments } from "./arc1";
import { ASK_WEB, LINK, ROUTES, type Route } from "./routes";
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

/** Notes for a chat message that is about Arcanus: who it is always, plus the notes most like the message. */
export function selfNotes(text: string) {
  const identity = KNOWLEDGE.filter((k) => k.id === "identity");
  return [...identity, ...recall(text).filter((k) => k.id !== "identity")];
}

const route = (name: string) => ROUTES.find((r) => r.route === name)!;

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
      const notes = recall(text);
      if (!notes.length) return null;
      const step = { label: "Recalled from memory", results: notes.map((k) => k.title) };
      // Who it is, and who made it, are facts. The language model does not get to rewrite them.
      if (/\b(who are you|what are you|introduce yourself)\b/i.test(text)) return { step, reply: introduction };
      if (/\b(who (made|created|built) you|your creator|who is gianne)\b/i.test(text)) return { step, reply: "Gianne Bacay created me." };
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
    ...route("web"),
    async run(text) {
      const link = text.match(LINK)?.[0];
      try {
        if (link) {
          const page = await browse(link);
          return {
            step: { label: "Read a web page", description: page.url, results: [page.title] },
            facts: [plainText(page.text)],
            source: `The web page "${page.title}" (${page.url})`,
          };
        }
        // ponytail: the whole request, less the "search for" and "online": ARC 1 was measured here and dropped words
        // that matter ("the population of japan" became "japan"). Search engines read full sentences well.
        const query = text.replace(ASK_WEB, "").replace(/\s+(?:online|on the (?:web|internet))\s*[?.!]*$/i, "").trim() || text;
        const { results, engine } = await search(query);
        if (!results.length) return { step: { label: "Searched the web", description: query }, reply: `I searched the web for "${query}" and found nothing.` };
        const top = results.slice(0, 4);
        return {
          step: { label: `Searched ${engine}`, description: query, results: top.map((r) => r.title) },
          facts: top.map((r) => `${r.title}: ${r.snippet} (${r.url})`),
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
      const tool = matchTool(text);
      if (!tool) return null;
      // ARC 1 reads an MCP tool's fields from the message; the harness fills in what it missed.
      const args = tool.mcp ? await toolArguments(text, tool) : {};
      const read = Object.entries(args).map(([k, v]) => `${k} = ${String(v)}`);
      return {
        step: { label: `Tool · ${tool.name}`, description: tool.mcp ? `MCP ${tool.mcp}` : "Harness", results: read.length ? [`ARC 1 read: ${read.join(", ")}`] : undefined },
        reply: await callTool(tool.name, text, args),
      };
    },
  },
];
