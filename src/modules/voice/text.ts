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

// ponytail: phrase lists, not a classifier. Add a phrase when a boot line is the wrong kind of sentence.
const OPENING = /\b(hello|hi|hey|good (?:morning|afternoon|evening|day)|welcome|i(?:'m| am)\b|my name is)\b/i;
const SIGN_OFF =
  /\b(thank(?:s| you)|goodbye|bye|farewell|see you|take care|you(?:'re| are) welcome|hope to hear|hear from you|glad to\b[^.]{0,40}\bhelp|have a (?:good|nice|great)|until next|talk soon)\b/i;

/** A boot line that opens the meeting: a greeting or a self-introduction, never a sign-off. */
export function isIntroduction(line: string): boolean {
  const text = line.trim();
  return text.split(/\s+/).length >= 3 && OPENING.test(text) && /\barcanus\b/i.test(text) && !SIGN_OFF.test(text);
}

/** The greeting sentence in a model reply: quotes and a leading name stripped, one-word stubs skipped. */
export function openingLine(text: string): string {
  const cleaned = text
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/^arcanus\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = cleaned.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const line = parts.find((s) => s.split(/\s+/).length >= 3) ?? parts.at(-1) ?? "";
  return line.slice(0, 180);
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
