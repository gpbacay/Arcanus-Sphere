// What each route does: Arcanus answers what it can without the language model. The routes themselves, their seed
// phrasings and claims, are in routes.ts. To teach Arcanus a new capability, add a route there and its runner here:
// Hippocampus and the chat pick it up with no other change.
import type { ThoughtStep } from "@/shared/ui/chain-of-thought";
import { Hippocampus } from "./arcane/hippocampus.mjs";
import { Occipital } from "./arcane/occipital.mjs";
import { connectionNote, KNOWLEDGE } from "./knowledge";
import { callTool, connectMcp, featuresReply, introduction, listTools, matchTool, personalityReply, type Tool } from "@/modules/harness";
import { browse, browserUrl, commandTool, isSite, mergeCall, search, SEARCH, WEB_TOOLS } from "@/modules/web";
import { deviceCommand, openApp, operate } from "@/modules/device";
import { lore, searchFiles, shortPath, sourceAction, sourceCommand } from "@/modules/workspace";
import { coordinates, gps, MAP, noFixReason, whereabouts } from "@/modules/location";
import { engine, findFiles } from "@/modules/search";
import { openArtifact } from "@/shared/pane";
import { plainText } from "@/shared/html";
import { errorText } from "@/shared/store";
import { chooseTool, cityIn, schemaParameters, toolArguments } from "./arc1";
import { ASK_WEB, fileSearch, ORIGIN, ROUTES, type Route } from "./routes";
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

/** The search engine on my files, said as a reply: how many files hold it, and where. Composed from the results. */
async function findInFiles(query: string, label: string): Promise<Outcome & { found: number }> {
  // The search engine shows the same search, opened if it wasn't: what Arcanus uses, you see.
  engine.set({ query });
  void findFiles(query);
  openArtifact(SEARCH);
  try {
    const { files, matches } = await searchFiles(query);
    if (!files.length) return { found: 0, step: { label, description: query, results: ["nothing found"] }, reply: `"${query}" isn't anywhere in my files.` };
    const top = files.slice(0, 3).map((f) => shortPath(f.path) + (f.lines[0] ? ` (line ${f.lines[0].line})` : ""));
    return {
      found: files.length,
      step: { label, description: `the search engine · ${query}`, results: files.slice(0, 6).map((f) => `${shortPath(f.path)} · ${f.lines.length || "name"}`) },
      reply: `"${query}" is in ${files.length} ${files.length === 1 ? "file" : "files"}${matches > files.length ? `, ${matches} matches` : ""}: ${top.join(", ")}${files.length > 3 ? ", and more" : ""}. The search engine pane shows them all.`,
    };
  } catch (err) {
    return { found: 0, step: { label, description: errorText(err) }, reply: `I couldn't search my files: ${errorText(err)}` };
  }
}

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
    async run(text) {
      if (FEATURES.test(text)) return { step: { label: "My abilities", description: "From the harness, not the language model" }, reply: featuresReply };
      // Who made Arcanus, where it comes from and why it is called Arcanus: facts for SmolLM2 to phrase, from lore.md
      // in its own files (so editing that file changes the answer), or the built-in notes when the file is gone.
      if (ORIGIN.test(text)) {
        // One section, the one that answers: "why are you called Arcanus" reads "my name", anything else "my origin".
        const sections = await lore().catch((): Record<string, string> => ({}));
        const heading = /\b(?:name|named|called|mean|arcane)\b/i.test(text) ? "my name" : "my origin";
        const told = sections[heading] ?? Object.values(sections)[0];
        if (told) return { step: { label: "Recalled my lore", description: ".arcanus/lore.md", results: [heading in sections ? heading : "the first section"] }, facts: [told] };
        const about = KNOWLEDGE.filter((k) => k.id === "creator" || k.id === "origin");
        return { step: { label: "Recalled from memory", results: about.map((k) => k.title) }, facts: about.map((k) => k.content) };
      }
      const notes = selfNotes(text);
      // "Do you work offline": what it can do, and whether it is online now.
      const live = /\b(?:online|offline|internet|connection|wi-?fi)\b/i.test(text) ? [connectionNote(navigator.onLine)] : [];
      if (!notes.length && !live.length) return null;
      const step = { label: "Recalled from memory", results: [...notes.map((k) => k.title), ...(live.length ? [navigator.onLine ? "online now" : "offline now"] : [])] };
      // Who it is stays a fixed introduction. Anything else, including who made it, is written by SmolLM2.
      if (/\b(who are you|what are you|introduce yourself)\b/i.test(text)) return { step, reply: introduction };
      return { step, facts: [...live, ...notes.map((k) => k.content)] };
    },
  },
  {
    ...route("connection"),
    run() {
      const online = navigator.onLine;
      return { step: { label: online ? "Online" : "Offline", description: "This device's connection, from the browser, right now" }, facts: [connectionNote(online)] };
    },
  },
  {
    ...route("time"),
    async run(text) {
      // ARC 1 reads the city ("time in New York"); a zone named for it is the answer's zone. A named IANA zone
      // ("Asia/Tokyo") needs no model.
      const named = text.match(/\b[A-Za-z]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?\b/)?.[0];
      const city = !named && /\b(?:in|at|for)\s+\p{L}/iu.test(text) ? await cityIn(text) : null;
      const zone = named ?? (city ? zoneFor(city) : null);
      const now = tellTime(text, new Date(), zone);
      // Full clock as separate facts; the system prompt / ONLY_ASKED tells SmolLM2 which one to speak.
      const facts = [`The current time is ${now.time}.`, `Today's date is ${now.date}.`, `The time zone is ${now.zone}.`];
      if (city && zone) facts.push(`The city asked about is ${city}.`);
      if (city && !zone) facts.push(`No time zone found for "${city}"; the times above are local.`);
      return {
        step: { label: "Read the clock", description: city ? `ARC 1 read the city: ${city}` : "Facts for the language model", results: [now.zone] },
        facts,
      };
    },
  },
  {
    ...route("location"),
    async run(text) {
      // From this device's GPS, said as it is: a small model would garble coordinates. Arcanus runs here, so "where are
      // you" is the same place.
      const self = /\b(?:where (?:in the world )?are you|your (?:current |live |exact |gps )?(?:location|position|coordinates|whereabouts)|what (?:city|town|country|place) are you in)\b/i.test(text);
      openArtifact(MAP); // the map shows where, opened if it wasn't
      const line = await whereabouts(self);
      const fix = gps.state.fix;
      return {
        step: { label: "Read this device's location", description: fix ? `GPS · ±${Math.round(fix.accuracy)} m · ${gps.state.status}` : `no fix · ${gps.state.status}`, results: fix ? [coordinates(fix)] : undefined },
        reply: line ?? noFixReason(),
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
    ...route("source"),
    async run(text) {
      const command = sourceCommand(text);
      if (!command) return null;
      try {
        const { label, reply, results } = await sourceAction(command);
        return { step: { label, description: "My own source code, not the language model", results }, reply };
      } catch (err) {
        return { step: { label: "My source", description: errorText(err) }, reply: `I couldn't do that with my source: ${errorText(err)}` };
      }
    },
  },
  {
    ...route("files"),
    async run(text) {
      const query = fileSearch(text);
      return query ? findInFiles(query, "Searched my files") : null;
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
      // Offline, a web search becomes a search of my own files: the search engine's other half, always there.
      if (call.name === "search_web" && !navigator.onLine) {
        const query = call.arguments.query?.trim() || text;
        const found = await findInFiles(query, "Offline, so I searched my files");
        if (found.found) return { step: found.step, reply: `I'm offline, so I searched my files instead. ${found.reply}` };
        return { step: found.step, facts: [connectionNote(false)] };
      }
      try {
        if (call.name === "open_browser") {
          // "open notepad": an installed app of exactly that name comes before a website. A site Arcanus knows
          // ("open youtube") never does: an app installed from it (a browser's web app) would leave Arcanus's browser.
          const site = call.arguments.site ?? "";
          const app = !call.arguments.query && site && !/[./:]/.test(site) && !isSite(site) ? await openApp(site, true).catch(() => null) : null;
          if (app) return { step: { label: "Opened an app", description: `${by} · ${site}`, results: [app] }, reply: `Opened ${app}.` };
          // In Arcanus's own browser, the search engine's reader. Its ↗ button opens the page in yours.
          const page = await browse(browserUrl(site, call.arguments.query ?? ""));
          return {
            step: { label: "Opened in my browser", description: `${by} · open_browser`, results: [page.url] },
            reply: `Opened ${page.title} in my browser.`,
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
        // Offline, the reason is the connection, and Arcanus says so in its own words.
        if (!navigator.onLine) return { step: { label: "Offline", description: `The web needs a connection · ${errorText(err)}` }, facts: [connectionNote(false)] };
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
