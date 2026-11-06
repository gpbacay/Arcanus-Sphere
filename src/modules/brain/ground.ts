// How well a reply is grounded in the evidence it was given: ARCANE's Graph of Thought check (DocumentGraph.support in
// gpbacay_arcane/got.py), ported. Each sentence's telling words are weighted by how rare they are in the evidence, so
// a word no piece of evidence holds (a likely invention) weighs most; up to two pieces are picked greedily to cover
// it, and the sentence is supported when they cover at least half its weight. No language model: under a millisecond.
// ARCANE also uses this to rerank and rewrite answers; Arcanus only reports it, since another SmolLM2 pass costs seconds.
import { same, stem, words } from "./shelf.ts"; // with its extension, so Node runs shelf.check.ts

const SENTENCE = /(?<=[.!?])\s+|\n+/;
const MIN_SUPPORT = 0.5;
const MAX_PIECES = 2;

export type Grounding = {
  /** Share of the reply's telling-word weight the evidence covers, 0 to 1. */
  score: number;
  supported: number;
  sentences: number;
  /** Sentences the evidence doesn't back. */
  unsupported: string[];
};

export function grounding(answer: string, evidence: string[]): Grounding {
  const pieces = evidence.map((e) => (e.toLowerCase().match(/\p{L}{3,}/gu) ?? []).map(stem));
  const holds = (piece: string[], term: string) => piece.some((h) => same(h, term));
  const idf = (term: string) => {
    const df = pieces.filter((p) => holds(p, term)).length;
    return Math.log(1 + (pieces.length - df + 0.5) / (df + 0.5));
  };
  let mass = 0;
  let covered = 0;
  let supported = 0;
  let sentences = 0;
  const unsupported: string[] = [];
  for (const raw of answer.split(SENTENCE)) {
    const sentence = raw.trim().replace(/^[-*\s]+/, "");
    let need = new Map(words(sentence).map((w) => [stem(w), 0]));
    if (!need.size) continue; // nothing to check: "Sure!"
    for (const term of need.keys()) need.set(term, idf(term));
    const weight = [...need.values()].reduce((a, b) => a + b, 0);
    const used = new Set<number>();
    while (need.size && used.size < MAX_PIECES) {
      let best = -1;
      let gain = 0;
      pieces.forEach((p, i) => {
        if (used.has(i)) return;
        const g = [...need].reduce((sum, [t, w]) => sum + (holds(p, t) ? w : 0), 0);
        if (g <= gain) return;
        gain = g;
        best = i;
      });
      if (best < 0) break;
      used.add(best);
      need = new Map([...need].filter(([t]) => !holds(pieces[best], t)));
    }
    const share = weight ? 1 - [...need.values()].reduce((a, b) => a + b, 0) / weight : 1;
    sentences++;
    mass += weight;
    covered += share * weight;
    if (share >= MIN_SUPPORT) supported++;
    else unsupported.push(sentence);
  }
  return { score: mass ? covered / mass : 1, supported, sentences, unsupported };
}
