// Tools Arcanus runs itself, without the language model. Pure functions: no imports, so tools.check.ts runs them in Node.

const ARITHMETIC = /[\d.()\s+\-*/%^]+/g;

const N = String.raw`(-?\d+(?:\.\d+)?)`;

/**
 * Arithmetic said in words, written as symbols: "multiply 6 by 7" -> "6 * 7", "2 to the power of 8" -> "2 ^ 8".
 * ponytail: the common phrasings only. ARC 1 was measured for this and mixed up operations, so it stays rules.
 */
export function spoken(text: string): string {
  return text
    .replace(new RegExp(String.raw`\bmultiply\s+${N}\s+(?:by|and|with)\s+${N}`, "gi"), "$1 * $2")
    .replace(new RegExp(String.raw`\bdivide\s+${N}\s+by\s+${N}`, "gi"), "$1 / $2")
    .replace(new RegExp(String.raw`\badd\s+${N}\s+(?:and|to|plus)\s+${N}`, "gi"), "$1 + $2")
    .replace(new RegExp(String.raw`\bsubtract\s+${N}\s+from\s+${N}`, "gi"), "$2 - $1")
    .replace(new RegExp(String.raw`${N}\s*(?:%|percent)\s+of\s+${N}`, "gi"), "$1 / 100 * $2")
    .replace(/\bto the power of\b|\braised to\b/gi, "^")
    .replace(/\bsquared\b/gi, "^ 2")
    .replace(/\b(?:times|multiplied by|x)\b(?=\s*-?\d)/gi, "*")
    .replace(/\b(?:divided by|over)\b(?=\s*-?\d)/gi, "/")
    .replace(/\bplus\b(?=\s*-?\d)/gi, "+")
    .replace(/\bminus\b(?=\s*-?\d)/gi, "-");
}

/** The longest arithmetic expression in `text`, in symbols or words ("what's (3+4)*2?" -> "(3+4)*2"), or null. */
export function findExpression(text: string): string | null {
  const found = (spoken(text).match(ARITHMETIC) ?? [])
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

/** The IANA zone named after `city` ("new york" -> "America/New_York"), or null. Only cities zones are named for. */
export function zoneFor(city: string): string | null {
  const want = city.trim().toLowerCase().replace(/\s+/g, "_");
  if (!want) return null;
  return Intl.supportedValuesOf("timeZone").find((zone) => zone.toLowerCase().split("/").at(-1) === want) ?? null;
}

/** The current date and time, in `zone`, an IANA zone named in `text` ("time in Asia/Tokyo"), or the device's own. */
export function tellTime(text: string, now = new Date(), zone?: string | null): { zone: string; text: string } {
  const named = zone ?? text.match(/\b[A-Za-z]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?\b/)?.[0];
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
