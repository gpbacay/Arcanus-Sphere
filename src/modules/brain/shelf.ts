// The user's books (.arcanus/knowledge/) as passages Arcanus can find: its RAG. Pure, so shelf.check.ts measures it
// in Node; shelf.worker.ts runs it off the main thread, because indexing a 2 MB book takes seconds.
//
// Paragraphs (and Occipital's chunk() for long ones) make the passages, and Hippocampus's word search (BM25) finds
// them. Occipital's letter search is left out: measured on a 2 MB text it made indexing 7x slower (27 s against 3.7 s) and each search about 6x slower,
// for typo recall that questions about a book rarely need.
import { Hippocampus } from "./arcane/hippocampus.mjs";
import { chunk } from "./arcane/occipital.mjs";

export type Book = { id: string; stamp: string; text: string };
export type Passage = { book: string; text: string };

const SIZE = 600; // characters a passage holds: two of them are ~300 tokens, which SmolLM2 reads in well under a second
const OVERLAP = 60;
const TOP = 2;

// Words that say nothing about which passage is meant.
const STOP = new Set(
  ("the and for are was were you your yours not but with this that these those there their they them what which who whom whose " +
    "when where why how does did have has had been being from into over under than then also just like tell show give know think " +
    "say says said would could should will shall can may might must make made about book books passage chapter author write wrote " +
    "explain describe mean means one any all some more most much many very please me my our its it's i'm " +
    "today now here hello thanks thank okay yes good great nice well because since while though although still even " +
    "every other another such same each both either neither only own again ever never always often usually really " +
    "sure yeah yep certainly sorry glad").split(" ")
);
export const words = (text: string) => [...new Set(text.toLowerCase().match(/\p{L}{3,}/gu) ?? [])].filter((w) => !STOP.has(w));
// "whales" and "whale", "eggs" and "egg", "sailed" and "sailor" meet; the shorter stem must start the longer.
export const stem = (w: string) => (w.length > 5 ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
export const same = (a: string, b: string) => (a.length < b.length ? b.startsWith(a) : a.startsWith(b));

/**
 * Hippocampus ranks passages against each other (the best always scores 1), so it can't say when none fits. This does:
 * a passage counts only if it holds at least half of the question's telling words, and two of them when there are two.
 * ponytail: prefix matching, not real stemming; swap for Hippocampus's own tokenizer if it is ever exported.
 */
// A fact question. Small talk, capability checks, and "write me a poem" are not: those still go to the language model.
// No bare `?` catch-all: that sent every question to books→web and pulled random Wikipedia into the answer.
// ponytail: a pattern, not a classifier. Add a phrase when a real fact slips through and gets invented.
const LOOKUP = /\bquotes?\b|^(?:who|what|when|where|why|how many|how much)\b/i;
const CHATTER = /^(?:hi|hello|hey|thanks|thank you|ok|okay)\b|\b(joke|poem|story)\b|\bhow are you\b|\b(?:can|could|do|would|will|are) you\b/i;
const DANGLING = /\b(he|she|his|her|hers|their|they|them|it|its|that|this)\b/i;

export function asksForFact(text: string) {
  const t = text.trim();
  return LOOKUP.test(t) && !CHATTER.test(t);
}

/** The words to retrieve for `text`. A follow-up ("what's his famous quote?") keeps the previous question's topic. */
export function lookupQuery(text: string, earlier = "") {
  const q = text.replace(/\s+/g, " ").trim();
  const prev = earlier.replace(/[?.!]+$/g, "").replace(/\s+/g, " ").trim();
  return prev && DANGLING.test(q) ? `${prev} ${q}` : q;
}

export function fits(question: string, passage: string) {
  const asked = words(question);
  if (!asked.length) return false;
  const has = (passage.toLowerCase().match(/\p{L}{3,}/gu) ?? []).map(stem);
  const found = asked.filter((w) => has.some((h) => same(h, stem(w)))).length;
  return found >= Math.min(2, asked.length) && found / asked.length >= 0.5;
}

/** A book as passages: its paragraphs, short ones joined up to SIZE and long ones cut by Occipital's chunk(), so a
 *  passage rarely runs across two topics. */
export function passagesOf(text: string) {
  const out: string[] = [];
  let open = "";
  for (const para of text.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean)) {
    if (open && open.length + para.length + 1 > SIZE) {
      out.push(open);
      open = "";
    }
    if (para.length > SIZE) out.push(...chunk(para, SIZE, OVERLAP));
    else open = open ? `${open} ${para}` : para;
  }
  if (open) out.push(open);
  return out;
}

export class Shelf {
  private memory = new Hippocampus(null, { k: 8 });
  private books = new Map<string, string[]>();

  /** Add or replace `books`, and drop every book not named in `keep`. */
  update(books: Book[], keep: string[]) {
    for (const [id, pieces] of this.books) {
      if (keep.includes(id) && !books.some((b) => b.id === id)) continue;
      // ponytail: a passage two books share word for word is forgotten for both; re-adding the other book restores it.
      for (const piece of pieces) this.memory.forget(piece);
      this.books.delete(id);
    }
    for (const book of books) {
      const pieces = passagesOf(book.text);
      for (const piece of pieces) this.memory.remember(piece, book.id);
      this.books.set(book.id, pieces);
    }
  }

  /** The passages that answer `question`, best first; none when nothing fits. */
  search(question: string): Passage[] {
    if (!this.books.size || !question.trim()) return [];
    return this.memory
      .neighbors(question)
      .filter((n) => fits(question, n.text))
      .slice(0, TOP)
      .map((n) => ({ book: n.label ?? "", text: n.text }));
  }
}
