// Turning written replies into speech: what to say, and where a streamed reply can start speaking. Pure functions,
// so text.check.ts runs them in Node.

const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]*[^\s<>"')\].,!?;:]/gi;
/** What a link is called aloud: its site ("wikipedia" for https://en.wikipedia.org/wiki/X), never its characters. */
const siteName = (url: string) => {
  const labels = url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#:]/)[0].split(".");
  return labels.length > 1 ? labels[labels.length - 2] : labels[0];
};

/**
 * Text as it should be spoken: markdown marks dropped, and links never read out character by character. A link that
 * only shows where something is ("Opened it in your browser: https://…", or a link on its own) is left unsaid; one
 * inside a sentence is called by its site's name.
 */
export function forSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(new RegExp(`(^|:)\\s*(?:${LINK.source})[.!?]*\\s*$`, "i"), (_, colon: string) => (colon ? "." : ""))
    .replace(LINK, siteName)
    .replace(/[*_#`>~|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split streamed text into finished sentences and the unfinished rest, so speech can start before the reply ends.
 * A sentence still being written past `long` characters is cut at its last comma, semicolon or colon, so a long
 * sentence starts speaking without waiting for its full stop.
 */
export function takeSentences(buffer: string, long = 80): { sentences: string[]; rest: string } {
  const parts = buffer.split(/(?<=[.!?…])\s+|\n+/);
  let rest = parts.pop() ?? "";
  if (rest.length > long) {
    const cut = Math.max(rest.lastIndexOf(", "), rest.lastIndexOf("; "), rest.lastIndexOf(": "));
    if (cut > 0) {
      parts.push(rest.slice(0, cut + 1));
      rest = rest.slice(cut + 2);
    }
  }
  return { sentences: parts.map((s) => s.trim()).filter(Boolean), rest };
}

/** The words to say from a note or a tool result: the first sentence, kept short enough to speak at once. */
export function spokenLine(text: string) {
  const sentence = text.split(/(?<=[.!?])\s/)[0]?.trim() ?? "";
  const line = (sentence || text).replace(/\s+/g, " ").trim();
  return line.length > 220 ? `${line.slice(0, 217)}…` : line;
}

/** `text` without a sentence cut off at the end (a reply stopped at its token cap); whole if it has no full stop yet. */
export const wholeSentences = (text: string) => text.match(/^[\s\S]*[.!?…]/)?.[0] ?? text;

/** Whether words heard while Arcanus was speaking are mostly its own: the microphone picking up the speaker. */
export function isEcho(heard: string, said: string): boolean {
  const words = (s: string) => s.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  const pool = new Set(words(said));
  const w = words(heard);
  return w.length >= 2 && w.filter((x) => pool.has(x)).length / w.length >= 0.7;
}
