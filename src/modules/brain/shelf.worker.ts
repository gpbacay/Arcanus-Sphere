// The shelf (shelf.ts) in its own thread, so indexing a book never stalls the sphere or the chat. Messages are handled
// in order: a search sent after an update answers from the updated shelf.
import { Shelf, type Book } from "./shelf";

const shelf = new Shelf();

self.onmessage = ({ data }: MessageEvent<{ type: "update"; books: Book[]; keep: string[] } | { type: "search"; id: number; text: string }>) => {
  if (data.type === "update") shelf.update(data.books, data.keep);
  else postMessage({ id: data.id, passages: shelf.search(data.text) });
};
