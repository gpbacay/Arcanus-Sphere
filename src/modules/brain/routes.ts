// The routes a message can take, and how one is chosen. Pure (no browser, no models), so routing.check.ts measures
// routing in Node. skills.ts adds what each route does.
//
// Hippocampus (remembered example phrasings) with Occipital (letter matching, for typos) decides. ARC 1 is not in
// the vote: measured on held-out messages it routed 43% right alone, and mixing it in made Hippocampus worse (70% to
// 68%). It reads arguments instead (skills.ts), where it is reliable. Re-measure with routing.check.ts before
// putting a retrained ARC 1 back into the vote.
//
// Also measured and left out, on set 3 (written before it was tried):
// - ARC 1 embeddings as Hippocampus's model (nearest seeds by meaning): routing up 1 to 3 messages on some sets, down
//   on others, and chat messages wrongly answered as questions about Arcanus went from 3 of 37 to 11-15.
// - Occipital tuned (minCoverage .15, weight .7): +5 on sets 1 and 2, 0 on set 3, so fitted to sets 1 and 2.
//   Occipital at its defaults is within one message of no Occipital at all, typos included; it stays because it is
//   cheap and is what lets a misspelled seed word still count.
import { Hippocampus, type Neighbor } from "./arcane/hippocampus.mjs";
import { Occipital } from "./arcane/occipital.mjs";
import { findExpression, numerals, spoken } from "./tools.ts"; // with its extension, so Node runs routing.check.ts
// eslint-disable-next-line no-restricted-imports -- Node runs routing.check.ts and can't resolve "@/"; command.ts is pure
import { deviceCommand } from "../device/command.ts";
// eslint-disable-next-line no-restricted-imports -- as above: workspace/command.ts is pure
import { sourceCommand } from "../workspace/command.ts";

export type Route = {
  route: string;
  /** What kind of message belongs here. */
  description: string;
  /** Remembered examples; Hippocampus votes with them at every request. Add a line to teach a phrasing, no retraining. */
  seeds: string[];
  /** Take a message before the vote, for what words can't show (a bare "12*7"). Returns the reason, or nothing. */
  claim?(text: string): string | undefined;
};

export const LINK = /\bhttps?:\/\/[^\s<>"')\]]+/i;
export const ASK_WEB = /^(?:please\s+)?(?:search(?:\s+(?:the\s+)?(?:web|internet|online))?(?:\s+for)?|google|look\s+up|browse(?:\s+to)?|find\s+online)\s+/i;
/** "go to youtube", "open github", "browse to wikipedia.org": open the user's browser, not the reader. */
export const GO = /^(?:please\s+)?(?:go\s*to|navigate to|take me to|pull up|open|browse to)\b/i;

/** A question about the present moment: the time, the day, the date, the month or the year it is now. */
const NOW =
  /\b(?:what|which) (?:time|day|date|month|year)(?: of the week)? (?:is it|is this|is today|are we in)\b|\bwhat(?:'s| is) the (?:time|date|day)(?: (?:today|now|right now))?\s*\??$|\bis it (?:mon|tues|wednes|thurs|fri|satur|sun)day\b/i;
/** A question about where the user or Arcanus is right now. "Where are you from" is about its origin, not this. */
export const WHERE =
  /\bwhere (?:am i|are (?:you|we)(?! from)|is (?:this|here)|in the world are (?:you|we))\b|\b(?:my|your|our) (?:current |live |exact |gps )?(?:location|position|coordinates|whereabouts)\b|\bwhat (?:city|town|country|place) (?:am i|are (?:you|we)) in\b/i;
/** The words a sum is asked with. */
const ASKING = /^(?:what|what's|whats|how|much|many|is|are|do|does|you|get|from|calculate|compute|solve|work|out|the|answer|result|to|of|equals?|please|tell|me|can|could)$/i;

export const ROUTES: Route[] = [
  {
    route: "chat",
    description: "Conversation, writing, advice, or a general question answered from general knowledge",
    seeds: [
      "hi there",
      "good morning, how are you",
      // Small talk, as it is said aloud. Without these, "how are you today" was answered with the date ("today")
      // and "what's up" with a web search ("up": "look up the latest news online").
      "hello, how are you today",
      "how are you doing today",
      "hey, what's up",
      "nice to meet you",
      "okay, thanks a lot",
      "goodbye for now",
      "tell me a joke",
      "write a short poem about the sea",
      "what is the capital of france",
      "explain photosynthesis simply",
      "give me ideas for dinner",
      "how do I center a div in css",
    ],
  },
  {
    route: "personality",
    description: "Asks what Arcanus is like: its personality, character, tone, or how it behaves",
    seeds: [
      "what's your personality",
      "describe your personality",
      "what are you like",
      "how do you behave",
      "what's your character",
      "are you nice",
      "what's your attitude",
      "are you funny or serious",
      "what's your mood like",
    ],
  },
  {
    route: "about",
    description: "A question about Arcanus itself: who it is, who created it, what it can do, its source code, its files, its models, voice, sphere, memory or privacy",
    seeds: [
      "who are you",
      "who made you",
      "who created you",
      "who is your creator",
      "who is gianne bacay",
      "what can you do",
      "what model do you run on",
      "how does your voice work",
      "are my messages sent to a server",
      "what is the sphere",
      "how do you remember things",
      "what is arc 1",
      "tell me about yourself",
      "who programmed you",
      "what are your features",
      "do you work offline",
      "is my data private",
      "which ai model are you",
      "what is the orb",
      "are you an assistant",
      "where is your source code",
      "can you edit your own files",
    ],
  },
  {
    route: "time",
    description: "Asks for the current time, date, or day of the week",
    seeds: ["what time is it", "what's today's date", "what day is it today", "current time in Asia/Tokyo", "what time is it in london"],
    // The seeds say "time", "date" and "day"; a question about the month or the year shares only "what is it" with
    // them, which every route's seeds hold. Only a question about now is taken: "what year did the war end" is not.
    claim(text) {
      return NOW.test(text) ? "asked about now" : undefined;
    },
  },
  {
    route: "location",
    description: "Asks where the user or Arcanus is: the live position, city, country or coordinates",
    // No seeds, and no vote, like device: WHERE reads every such question, and seeds would pull "where" questions
    // about other things ("where are my notes kept") off their routes.
    seeds: [],
    claim(text) {
      return WHERE.test(text) ? "asked where we are" : undefined;
    },
  },
  {
    route: "math",
    description: "Arithmetic to compute",
    seeds: ["what is 12 * 7", "calculate (3 + 4) * 2", "what's 144 / 12", "compute 2^10", "what is 5 times 3", "multiply 4 by 9", "add 10 and 15"],
    // Digits and operators share no words with remembered examples, so a bare expression is caught here.
    // So is a sum wrapped only in the words of asking ("how much is 9 times 8"): "is" and "how" vote for every route.
    // A sentence that merely holds one ("the score was 3 - 1") is left to the vote.
    claim(text) {
      const expression = findExpression(text);
      if (expression === null) return undefined;
      const rest = spoken(text).replace(expression, "").split(/\s+/).map((w) => w.replace(/[^\p{L}']/gu, "")).filter(Boolean);
      return rest.length <= 2 || rest.every((w) => ASKING.test(w)) ? "arithmetic spotted" : undefined;
    },
  },
  {
    // Before device and web, so "open your source code" and "open page.tsx" are Arcanus's own files, not an app or a site.
    route: "source",
    description: "Asks Arcanus to open, search or commit its own source code, or for its git status or history",
    // No seeds, and no vote, like device: sourceCommand() reads every request it can carry out. "Where is your source
    // code" and "who wrote your code" are questions, and stay with about.
    seeds: [],
    claim(text) {
      const command = sourceCommand(text);
      return command ? `asked to ${command.kind === "open" ? "open" : command.kind === "find" ? "search" : command.kind === "commit" ? "commit" : "read the git " + command.kind + " of"} my source` : undefined;
    },
  },
  {
    // Before web, so "launch spotify" and "open the calculator app" are apps. A plain "open X" stays with web, which
    // opens an installed app of exactly that name and a website otherwise.
    route: "device",
    description: "Asks about this computer's hardware, or to open an app, or to click, type, press, scroll or read in an app on it",
    // No seeds, and no vote: measured, seeds like "how much ram do i have" pulled "how much is 9 times 8" off math and
    // "does anything leave my computer" off about. Every command it can carry out is one deviceCommand() reads, so
    // the claim alone decides.
    seeds: [],
    claim(text) {
      const command = deviceCommand(text);
      if (!command || (command.kind === "open" && !command.explicit)) return undefined;
      return command.kind === "specs" ? "asked about this device" : command.kind === "open" ? "asked to open an app" : `asked to ${command.kind === "apps" ? "list apps" : command.kind} on this device`;
    },
  },
  {
    route: "web",
    description: "Asks to search the internet, look something up online, or open or read a web page or link",
    seeds: [
      "search the web for electric cars",
      "look up the latest news online",
      "google the weather in manila",
      "open https://example.com",
      "find this on the internet",
      "browse to wikipedia.org",
      "summarize this article https://example.com/post",
      "go to youtube and search asmr",
      "open github",
      "take me to wikipedia",
    ],
    claim(text) {
      if (/^connect mcp\s/i.test(text)) return undefined; // an MCP server's address belongs to the tool skill
      if (GO.test(text)) return "asked to open a site";
      return LINK.test(text) ? "a link" : ASK_WEB.test(text) ? "asked to search the web" : undefined;
    },
  },
  {
    route: "tool",
    description: "A request that names a harness tool from a plugin or an MCP server",
    seeds: ["run the echo tool", "call the weather tool", "use the plugin tool"],
  },
];

// Below this share of the vote, the memory isn't sure enough to skip the language model.
export const SURE = 0.35;
// A chat message that talks to "you" and either draws this share of "about" votes, or matches no example at all
// ("who built you": every word but one is a stop word), is likely about Arcanus. It is answered as chat, but grounded
// in Arcanus's knowledge notes, so the model doesn't invent a self.
export const SELF_SHARE = 0.15;
const TO_YOU = /\b(?<!thank )you\b|\b(your|yours|yourself|arcanus)\b/i; // "translate thank you" is about words, not Arcanus

/** A router memory: every route's seeds, plus what it learned before (`learned`, saved toJSON() output). */
export function routerMemory(routes: Route[] = ROUTES, learned: { text: string; label: string | null; source?: string }[] = []) {
  // ponytail: learned examples capped at 500; past that observe() drops its oldest.
  const memory = new Hippocampus(null, { occipital: new Occipital(), maxSize: 500, memory: learned });
  for (const r of routes) for (const seed of r.seeds) memory.remember(seed, r.route);
  return memory;
}

export type Decision = {
  route: string;
  /** Set when a claim took the message before the vote: why. */
  claimed?: string;
  /** The vote's own pick and its share, before SURE and claims. */
  label: string | null;
  confidence: number;
  /** A chat message that is likely about Arcanus (see SELF_SHARE). */
  aboutSelf: boolean;
  neighbors: Neighbor[];
};

/** Route `text`: a claim if one applies, else the memory's vote if sure enough, else chat. */
export async function decide(memory: Hippocampus, text: string, routes: Route[] = ROUTES): Promise<Decision> {
  const labels = routes.map((r) => r.route);
  // Numbers said aloud are read as digits ("twelve times seven" -> "12 times 7"), so a spoken sum votes like a typed one.
  const voted = await memory.classify(numerals(text), labels);
  const claim = routes.map((r) => ({ route: r.route, why: r.claim?.(text) })).find((c) => c.why);
  let route = claim?.route ?? (voted.label && voted.confidence >= SURE ? voted.label : "chat");
  // Seeds hold numbers ("what is 12 * 7"), so any "12" votes math. Math with nothing to compute is chat.
  if (route === "math" && !findExpression(text)) route = "chat";
  if ((route === "device" || route === "source" || route === "location") && !claim) route = "chat";
  const unmatched = !voted.neighbors.length;
  const aboutSelf = route === "chat" && TO_YOU.test(text) && (unmatched || (voted.distribution.about ?? 0) >= SELF_SHARE);
  return { route, claimed: claim?.why, label: voted.label, confidence: voted.confidence, aboutSelf, neighbors: voted.neighbors };
}
