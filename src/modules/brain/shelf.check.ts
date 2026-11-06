// Run: node src/modules/brain/shelf.check.ts   (Node 22.18+ strips the types)
// Measures the book shelf (RAG): does a question find the passage that answers it, and does small talk find nothing?
// Re-run it after changing SIZE, TOP, STOP or fits() in shelf.ts.
import assert from "node:assert/strict";
import { grounding } from "./ground.ts";
import { Shelf, fits } from "./shelf.ts";

// A small "book": one topic per paragraph, so each question has exactly one right passage.
const BOOK = [
  "Lighthouses guided ships along dangerous coasts for centuries. The Pharos of Alexandria, built around 280 BC, was one of the Seven Wonders of the Ancient World and stood over 100 metres tall. Later lighthouses used Fresnel lenses, invented by Augustin-Jean Fresnel in 1822, which bent light into a strong beam visible far out at sea.",
  "Honeybees live in colonies led by a single queen, who can lay up to 2,000 eggs a day. Worker bees tell each other where flowers are with the waggle dance: the angle of the dance shows the direction relative to the sun, and its length shows the distance.",
  "Roman aqueducts carried water into cities using only gravity. Engineers kept a slight, steady downhill slope over many kilometres. The Pont du Gard in southern France, built in the first century, is one of the best preserved aqueduct bridges and has three tiers of arches.",
  "Volcanoes form where molten rock, called magma, reaches the surface. Shield volcanoes such as Mauna Loa in Hawaii have gentle slopes made by runny lava, while stratovolcanoes like Mount Fuji are steep cones built from layers of ash and thick lava.",
  "Ocean tides are caused mostly by the Moon's gravity pulling on the Earth's oceans. Most coasts see two high tides and two low tides each day. When the Sun and Moon line up, at new and full moon, their pull combines into stronger spring tides.",
  "Coffee is said to have been discovered in Ethiopia, where a goat herder named Kaldi noticed his goats became lively after eating the red berries of a certain shrub. By the fifteenth century coffee was being roasted and brewed in Yemen, and coffeehouses spread across the Middle East.",
  "Johannes Gutenberg built a printing press with movable metal type in Mainz around 1440. His press made books far cheaper to produce, and the Gutenberg Bible, printed in the 1450s, is one of the first major books printed in Europe this way.",
  "The octopus has three hearts and blue blood, which carries oxygen with a copper-based protein called hemocyanin. Two hearts pump blood through the gills and the third pumps it to the rest of the body. Octopuses can change colour and texture to hide from predators.",
  "Mount Everest, on the border of Nepal and China, is the highest mountain above sea level at about 8,849 metres. Edmund Hillary and Tenzing Norgay were the first climbers confirmed to reach its summit, on 29 May 1953.",
  "Emperor penguins breed during the Antarctic winter. After the female lays a single egg, the male balances it on his feet under a fold of skin and fasts for about two months, huddling with other males against the freezing wind while the female feeds at sea.",
  "Glass is made by melting sand, which is mostly silica, together with soda ash and limestone at around 1,700 degrees Celsius. Glassblowers shape molten glass by blowing air into it through a long metal pipe, a technique developed in the Roman Empire.",
  "Saturn's rings are made of countless pieces of ice and rock, from tiny grains to chunks as big as houses. The rings are very wide but usually only about ten metres thick. Galileo first saw them in 1610 but could not tell what they were.",
].join("\n\n");

const QUESTIONS: [string, RegExp][] = [
  ["who invented the lens used in lighthouses", /Fresnel/],
  ["how do bees tell each other where flowers are", /waggle/],
  ["how did roman aqueducts move water", /gravity/],
  ["what is the difference between shield volcanoes and stratovolcanoes", /Mauna Loa/],
  ["what causes spring tides", /spring tides/],
  ["where was coffee discovered", /Kaldi/],
  ["when did gutenberg build his printing press", /1440/],
  ["how many hearts does an octopus have", /three hearts/],
  ["who first climbed mount everest", /Hillary/],
  ["how do emperor penguins keep their eggs warm", /feet/],
  ["what is glass made from", /silica/],
  ["how thick are saturn's rings", /ten metres/],
  ["what did the goat herder notice", /goats/], // no topic word: the passage's own details
  ["how tall was the pharos of alexandria", /100 metres/],
];
const SMALL_TALK = ["hello there", "tell me a joke", "how are you today", "write a poem about love", "what time is it", "thanks, that helped"];

const shelf = new Shelf();
shelf.update([{ id: "wonders.txt", stamp: "1", text: BOOK }], ["wonders.txt"]);

let right = 0;
const misses: string[] = [];
for (const [question, answer] of QUESTIONS) {
  const found = shelf.search(question);
  if (found.some((p) => answer.test(p.text))) right++;
  else misses.push(`${question} → ${found[0]?.text.slice(0, 50) ?? "nothing"}`);
}
const noise = SMALL_TALK.filter((q) => shelf.search(q).length);
console.log(`passages found: ${right}/${QUESTIONS.length} · small talk that pulled a passage: ${noise.length}/${SMALL_TALK.length}`);
if (process.argv.includes("-v")) console.log(`  misses: ${misses.join(" | ")}\n  noise: ${noise.join(" | ")}`);
assert.ok(right >= 13, "the shelf finds too few answers");
assert.equal(noise.length, 0, "small talk pulled in passages");

// Books come and go: a removed book is forgotten, a changed one replaced.
shelf.update([], []);
assert.deepEqual(shelf.search("how many hearts does an octopus have"), []);
shelf.update([{ id: "a.md", stamp: "2", text: "The octopus has three hearts." }], ["a.md"]);
assert.equal(shelf.search("octopus hearts")[0]?.book, "a.md");
assert.ok(fits("octopus hearts", "Octopuses have three hearts"));
assert.ok(!fits("how are you today", "How are you today, reader?")); // no telling word at all
assert.ok(!fits("octopus recipes with garlic", "The octopus has three hearts.")); // one of three is not enough

// Grounding (ARCANE's Graph of Thought support check): a reply in the evidence's words is backed, an invention isn't.
const octopus = ["The octopus has three hearts and blue blood, which carries oxygen with a copper-based protein called hemocyanin."];
const backed = grounding("An octopus has three hearts. Its blood is blue because of hemocyanin.", octopus);
assert.equal(backed.supported, 2);
assert.ok(backed.score > 0.8);
const invented = grounding("An octopus has three hearts. It was first described by Aristotle in Athens.", octopus);
assert.deepEqual(invented.unsupported, ["It was first described by Aristotle in Athens."]);
assert.equal(grounding("Sure!", octopus).sentences, 0); // nothing to check
const g0 = performance.now();
grounding(BOOK.slice(0, 1200), BOOK.split("\n\n").slice(0, 2));
console.log(`grounding a reply: ${(performance.now() - g0).toFixed(2)} ms`);

// Speed: a book of about 1 MB, indexed and searched (in the app this runs in a worker).
const big = Array.from({ length: 85 }, (_, i) => BOOK.replace(/\b(\w)(\w{3,})/g, (_m, a: string, b: string) => b + a + (i % 7))).join("\n\n");
const t0 = performance.now();
const large = new Shelf();
large.update([{ id: "big.txt", stamp: "1", text: big }], ["big.txt"]);
const t1 = performance.now();
for (const [question] of QUESTIONS) large.search(question);
const t2 = performance.now();
console.log(`${(big.length / 1e6).toFixed(1)} MB: indexed in ${Math.round(t1 - t0)} ms, ${((t2 - t1) / QUESTIONS.length).toFixed(1)} ms a search`);
console.log("shelf ok");
