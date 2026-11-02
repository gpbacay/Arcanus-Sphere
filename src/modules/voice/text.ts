// Turning written replies into speech: what to say, and where a streamed reply can start speaking. Pure functions,
// so text.check.ts runs them in Node.

/** Text as it should be spoken: markdown marks and links dropped. */
export function forSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
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
