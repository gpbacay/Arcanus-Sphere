// What Arcanus can do without the language model, one entry per route ARC 1 chooses between. To teach Arcanus a new
// capability, add a skill here: ARC 1, Hippocampus and the chat pick it up with no other change.
import type { ThoughtStep } from "@/shared/ui/chain-of-thought";
import { Hippocampus } from "./arcane/web.mjs";
import { Occipital } from "./arcane/occipital.mjs";
import { KNOWLEDGE } from "./knowledge";
import { calculate, findExpression, tellTime } from "./tools";

/** A skill's answer: a reply written without the language model, or facts for the language model to use. */
export type Outcome = { step: ThoughtStep; reply?: string; facts?: string[] };

export interface Skill {
  route: string;
  /** Read by ARC 1: what kind of message belongs here. */
  description: string;
  /** Remembered examples; Hippocampus votes with them at every request. Add a line to teach a phrasing, no retraining. */
  seeds: string[];
  /** Take a message before ARC 1 votes, for what words can't show (a bare "12*7"). Returns the reason, or nothing. */
  claim?(text: string): string | undefined;
  /** Handle the message, or return null to hand it to the language model as plain chat. */
  run?(text: string): Outcome | null;
}

// Knowledge notes, recalled by letters and words. Built on first use: it needs no model.
let memory: Hippocampus | null = null;
function recall(text: string) {
  if (!memory) {
    memory = new Hippocampus(null, { k: 2, occipital: new Occipital() });
    for (const note of KNOWLEDGE) memory.remember(`${note.title}. ${note.content}`, note.id);
  }
  return memory.neighbors(text).flatMap((n) => KNOWLEDGE.filter((k) => k.id === n.label));
}

export const CHAT: Skill = {
  route: "chat",
  description: "Conversation, writing, advice, or a general question answered from general knowledge",
  seeds: [
    "hi there",
    "good morning, how are you",
    "tell me a joke",
    "write a short poem about the sea",
    "what is the capital of france",
    "explain photosynthesis simply",
    "give me ideas for dinner",
    "how do I center a div in css",
  ],
};

export const SKILLS: Skill[] = [
  CHAT,
  {
    route: "about",
    description: "A question about Arcanus itself: who it is, who created it, what it can do, its models, voice, sphere, memory or privacy",
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
    ],
    run(text) {
      const notes = recall(text);
      return notes.length ? { step: { label: "Recalled from memory", results: notes.map((k) => k.title) }, facts: notes.map((k) => k.content) } : null;
    },
  },
  {
    route: "time",
    description: "Asks for the current time, date, or day of the week",
    seeds: ["what time is it", "what's today's date", "what day is it today", "current time in Asia/Tokyo"],
    run(text) {
      const now = tellTime(text);
      return { step: { label: "Read the clock", description: "Answered without the language model", results: [now.zone] }, reply: `It's ${now.text} (${now.zone}).` };
    },
  },
  {
    route: "math",
    description: "Arithmetic to compute",
    seeds: ["what is 12 * 7", "calculate (3 + 4) * 2", "what's 144 / 12", "compute 2^10"],
    // Digits and operators share no words with remembered examples, so a bare expression is caught here.
    claim(text) {
      const expression = findExpression(text);
      const bare = expression !== null && text.replace(expression, "").split(/\s+/).filter(Boolean).length <= 2;
      return bare ? "arithmetic spotted" : undefined;
    },
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
];
