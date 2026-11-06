// Run: node src/modules/brain/routing.check.ts   (Node 22.18+ strips the types)
// Measures routing on held-out messages (none of them is a seed) and fails if it gets worse. Re-run it after changing
// seeds, SURE or SELF_SHARE, or before putting a model back into the vote.
import assert from "node:assert/strict";
import { decide, routerMemory } from "./routes.ts";

// Set 1 was written to judge routing; sets 2 and 3 separately, to check a change isn't just fitted to set 1.
// "tool" messages need a registered tool to be claimed (skills.ts), so they aren't measured here.
const SETS: Record<string, Record<string, string[]>> = {
  "set 1": {
    chat: ["hello!", "how's it going", "can you write me a haiku about rain", "what should I cook tonight", "why is the sky blue", "give me tips to sleep better", "translate thank you into spanish", "what's a good name for a cat", "help me write an email to my boss", "tell me something interesting", "recommend a book", "how do plants grow", "hey arcanus", "i'm feeling sad today", "explain gravity like i'm five"],
    personality: ["what kind of personality do you have", "are you friendly", "how would you describe yourself", "what's your vibe", "do you have feelings or a temper", "what is your tone like"],
    about: ["who built you", "what are you exactly", "who's your developer", "what can you help me with", "which language model do you use", "do you send my data anywhere", "how do you speak", "what is arcanus", "are you running locally", "whats ARC 1", "how does your memorry work", "tell me about the glowing orb"],
    time: ["what's the time", "what time is it now", "which day of the week is it", "what is the date today", "tell me the current time", "time in Europe/London please", "do you know what day it is", "waht time is it"],
    math: ["what's 15 + 27", "how much is 9 times 8", "calculate 100 / 4", "what is 2 to the power of 8", "solve 45 - 17", "multiply 6 by 7", "what's 3.5 * 2", "add 120 and 80"],
    web: ["search for the best laptops 2026", "look up flights to tokyo", "find news about nasa online", "check the internet for pizza places near me", "can you google who won the world cup", "read https://news.ycombinator.com", "what does wikipedia say about volcanoes, look it up", "search online for cheap headphones"],
  },
  "set 2": {
    chat: ["good evening", "write a limerick about a dog", "what is the difference between a virus and bacteria", "any advice for a job interview", "summarize the plot of hamlet", "i cannot decide what to wear", "teach me a word in french", "which is healthier, rice or bread", "thanks, that helped", "make up a bedtime story"],
    personality: ["are you always this calm", "do you have a sense of humor", "how do you usually talk to people", "would you call yourself serious"],
    about: ["are you an ai", "who owns you", "does anything leave my computer", "what makes you different from chatgpt", "where do you run", "what voice do you have", "can you see images", "how big is your brain", "what are your abilities", "do you keep my chats"],
    time: ["what is the date", "is it monday today", "what year is it", "current time please"],
    math: ["what is 81 / 9", "(5 + 5) * 3", "compute 7 * 13", "what is 1000 - 1"],
    web: ["look up the population of japan", "search for vegan recipes", "open https://github.com", "find reviews of the iphone online"],
  },
  // Written before any setting was tried on it. It showed that two changes that looked good on sets 1 and 2 were
  // fitted to them: Occipital tuned (minCoverage .15, weight .7) and ARC 1 embeddings in the vote (see routes.ts).
  "set 3": {
    chat: ["what's the tallest mountain in the world", "write a thank-you note to my teacher", "how can I stop procrastinating", "give me a fun fact about octopuses", "what rhymes with orange", "suggest a name for my bakery", "how do I make pancakes fluffy", "is it bad to drink coffee at night", "tell me a riddle", "what's a good workout for beginners", "explain how vaccines work", "help me plan a birthday party"],
    personality: ["are you shy", "what's your temperament", "do you ever get grumpy", "how would your friends describe you", "are you more playful or formal"],
    about: ["who designed you", "what's your name", "what do you run on", "is this conversation private", "how do you talk out loud", "what are you made of", "who wrote your code", "do you need the internet to work", "what tools do you have", "what is hippocampus"],
    time: ["got the time?", "what's the date tomorrow", "which month is it", "what time is it in paris", "tell me today's day"],
    math: ["what is 7 plus 8", "how much is 50 divided by 5", "12 squared", "what's 99 minus 33", "calculate 15% of 200"],
    web: ["look up the weather in cebu", "search the internet for used cars", "find recipes for adobo online", "google the meaning of serendipity", "open https://www.bbc.com"],
  },
};

// The floor each set must stay at or above. Measured when this check was written; raise it when routing improves.
const FLOOR = { "set 1": 0.75, "set 2": 0.6, "set 3": 0.65 };
// Questions about Arcanus (about and personality) answered from its own notes or the harness (routed there, or chat
// marked aboutSelf), and chat messages wrongly grounded in them.
const GROUNDED_FLOOR = 0.9;
const FALSE_GROUNDING_CEILING = 0.1;

const memory = routerMemory();
let aboutGrounded = 0, aboutAll = 0, chatGrounded = 0, chatAll = 0;
for (const [name, set] of Object.entries(SETS)) {
  let right = 0, all = 0;
  const per: string[] = [];
  const misses: string[] = [];
  for (const [route, texts] of Object.entries(set)) {
    let r = 0;
    for (const text of texts) {
      const d = await decide(memory, text);
      all++;
      if (d.route === route) {
        r++;
        right++;
      } else misses.push(`${text} → ${d.route}`);
      const grounded = Number(d.route === "about" || d.route === "personality" || d.aboutSelf);
      if (route === "about" || route === "personality") {
        aboutAll++;
        aboutGrounded += grounded;
      }
      if (route === "chat") {
        chatAll++;
        chatGrounded += grounded;
      }
    }
    per.push(`${route} ${r}/${texts.length}`);
  }
  console.log(`${name}: ${right}/${all} = ${Math.round((100 * right) / all)}%  (${per.join(", ")})`);
  if (process.argv.includes("-v")) console.log(`  misses: ${misses.join(" | ")}`);
  assert.ok(right / all >= FLOOR[name as keyof typeof FLOOR], `${name} routing fell below ${FLOOR[name as keyof typeof FLOOR] * 100}%`);
}
console.log(`questions about Arcanus grounded in its notes: ${aboutGrounded}/${aboutAll} · chat wrongly grounded: ${chatGrounded}/${chatAll}`);
assert.ok(aboutGrounded / aboutAll >= GROUNDED_FLOOR, "too few questions about Arcanus are grounded");
assert.ok(chatGrounded / chatAll <= FALSE_GROUNDING_CEILING, "too many chat messages are grounded in Arcanus's notes");
// A number shared with a math seed ("what is 12 * 7") is not arithmetic.
assert.equal((await decide(routerMemory(), "I have 12 apples")).route, "chat");
assert.equal((await decide(routerMemory(), "go to youtube and search ASMR")).route, "web");
assert.equal((await decide(routerMemory(), "go to youtube and search ASMR")).claimed, "asked to open a site");
// Device commands are claimed; a plain "open X" stays with web, which opens an app of that exact name first.
for (const text of ["launch spotify", "open the calculator app", "click Save in Notepad", "how much ram do I have", "what apps are running"]) {
  assert.equal((await decide(routerMemory(), text)).route, "device", text);
}
assert.equal((await decide(routerMemory(), "open notepad")).route, "web");
console.log("routing ok");
