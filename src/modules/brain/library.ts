// The main thread's side of the shelf: sends the books in .arcanus/knowledge/ to shelf.worker.ts (only the ones that
// changed) and asks it for passages. A reply never waits on indexing: a search that takes longer than WAIT ms (a big
// book still being indexed) answers nothing, and the next message finds the book ready.
import { books } from "@/modules/workspace";
import type { Passage } from "./shelf";

const WAIT = 300;

let worker: Worker | null = null;
const sent = new Map<string, string>(); // book -> stamp the worker holds
const waiting = new Map<number, (passages: Passage[]) => void>();
let asked = 0;
let syncing: Promise<void> = Promise.resolve();

function shelf() {
  if (!worker) {
    worker = new Worker(new URL("./shelf.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }: MessageEvent<{ id: number; passages: Passage[] }>) => {
      waiting.get(data.id)?.(data.passages);
      waiting.delete(data.id);
    };
  }
  return worker;
}

/** Send the worker what changed in .arcanus/knowledge/. Cheap when nothing did: one listing, no file is read. */
export function syncShelf() {
  syncing = syncing.then(async () => {
    const found = await books().catch(() => []);
    const changed = found.filter((b) => sent.get(b.id) !== b.stamp);
    if (!changed.length && found.length === sent.size) return;
    const texts = await Promise.all(changed.map(async (b) => ({ id: b.id, stamp: b.stamp, text: await b.text() })));
    shelf().postMessage({ type: "update", books: texts, keep: found.map((b) => b.id) });
    sent.clear();
    for (const b of found) sent.set(b.id, b.stamp);
  });
  return syncing;
}

/** Passages from the user's books that answer `question`; none when nothing fits, no books, or the shelf is busy. */
export async function recallPassages(question: string): Promise<Passage[]> {
  await syncShelf().catch(() => undefined);
  if (!sent.size) return [];
  const id = ++asked;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    shelf().postMessage({ type: "search", id, text: question });
    setTimeout(() => waiting.delete(id) && resolve([]), WAIT);
  });
}
