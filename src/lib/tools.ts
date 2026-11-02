// Tools Arcanus runs itself, without the language model. Pure functions: no imports, so tools.check.ts runs them in Node.

const ARITHMETIC = /[\d.()\s+\-*/%^]+/g;

/** The longest arithmetic expression in `text` ("what's (3+4)*2?" -> "(3+4)*2"), or null. */
export function findExpression(text: string): string | null {
  const found = (text.match(ARITHMETIC) ?? [])
    .map((s) => s.trim())
    .filter((s) => /\d/.test(s) && /\d\s*[+\-*/%^]\s*[\d(]/.test(s));
  return found.sort((a, b) => b.length - a.length)[0] ?? null;
}

/** Evaluate + - * / % ^ and parentheses. Anything else is refused before it reaches Function(). */
export function calculate(expression: string): string {
  const cleaned = expression.replace(/\s+/g, "");
  if (!/^[\d+\-*/%^().]+$/.test(cleaned)) return "Error: only digits and + - * / % ^ ( ) are allowed.";
  try {
    const value: unknown = Function(`"use strict"; return (${cleaned.replace(/\^/g, "**")});`)();
    if (typeof value !== "number" || !Number.isFinite(value)) return "Error: that has no finite answer.";
    return String(Number(value.toPrecision(12)));
  } catch {
    return "Error: that expression doesn't parse.";
  }
}

/** The current date and time, in an IANA zone named in `text` ("time in Asia/Tokyo") or the device's own. */
export function tellTime(text: string, now = new Date()): { zone: string; text: string } {
  const named = text.match(/\b[A-Za-z]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?\b/)?.[0];
  for (const zone of [named, undefined]) {
    try {
      const shown = now.toLocaleString(undefined, { dateStyle: "full", timeStyle: "short", timeZone: zone });
      return { zone: zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, text: shown };
    } catch {
      /* unknown zone: fall back to the device's */
    }
  }
  return { zone: "UTC", text: now.toISOString() };
}

/** Text as it should be spoken: markdown marks and links dropped. */
export function forSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_#`>~|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split streamed text into finished sentences and the unfinished rest, so speech can start before the reply ends. */
export function takeSentences(buffer: string): { sentences: string[]; rest: string } {
  const parts = buffer.split(/(?<=[.!?…])\s+|\n+/);
  const rest = parts.pop() ?? "";
  return { sentences: parts.map((s) => s.trim()).filter(Boolean), rest };
}
