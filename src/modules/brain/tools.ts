// Tools Arcanus runs itself, without the language model. Pure functions: no imports, so tools.check.ts runs them in Node.

const ARITHMETIC = /[\d.()\s+\-*/%^]+/g;

const N = String.raw`(-?\d+(?:\.\d+)?)`;

const UNITS = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
const TENS = "twenty thirty forty fifty sixty seventy eighty ninety".split(" ");
const NUMBER_WORD = [...UNITS, ...TENS, "hundred", "thousand"].join("|");
// A run of number words. "and" joins only after hundred or thousand: "three hundred and five" is one number, "twenty and nineteen" is two.
const NUMBER_WORDS = new RegExp(String.raw`\b(?:${NUMBER_WORD})(?:(?:[\s-]+|(?<=hundred|thousand)\s+and\s+)(?:${NUMBER_WORD}))*\b`, "gi");

/**
 * Numbers written as words, in digits: "twelve" -> "12", "twenty-one" -> "21", "three hundred and five" -> "305".
 * A speech model writes numbers this way, so a sum said aloud ("twelve times seven") has no digits in it.
 * ponytail: whole numbers under a million, and digits read out one by one ("one two three") come out added up.
 */
export function numerals(text: string): string {
  return text.replace(NUMBER_WORDS, (run) => {
    let total = 0;
    let part = 0;
    for (const word of run.toLowerCase().split(/[\s-]+/)) {
      const unit = UNITS.indexOf(word);
      const ten = TENS.indexOf(word);
      if (unit >= 0) part += unit;
      else if (ten >= 0) part += (ten + 2) * 10;
      else if (word === "hundred") part = (part || 1) * 100;
      else if (word === "thousand") {
        total += (part || 1) * 1000;
        part = 0;
      }
    }
    return String(total + part);
  });
}

/**
 * Arithmetic said in words, written as symbols: "multiply 6 by 7" -> "6 * 7", "2 to the power of 8" -> "2 ^ 8".
 * ponytail: the common phrasings only. ARC 1 was measured for this and mixed up operations, so it stays rules.
 */
export function spoken(text: string): string {
  return numerals(text)
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

/** The current clock, in `zone`, an IANA zone named in `text` ("time in Asia/Tokyo"), or the device's own.
 *  Returns time, date and zone as separate facts so the language model can answer only what was asked. */
export function tellTime(text: string, now = new Date(), zone?: string | null): { zone: string; text: string; time: string; date: string } {
  const named = zone ?? text.match(/\b[A-Za-z]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?\b/)?.[0];
  for (const zone of [named, undefined]) {
    try {
      const opts = { timeZone: zone };
      const time = now.toLocaleTimeString(undefined, { ...opts, timeStyle: "short" });
      const date = now.toLocaleDateString(undefined, { ...opts, dateStyle: "full" });
      const shown = now.toLocaleString(undefined, { ...opts, dateStyle: "full", timeStyle: "short" });
      return { zone: zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, text: shown, time, date };
    } catch {
      /* unknown zone: fall back to the device's */
    }
  }
  const iso = now.toISOString();
  return { zone: "UTC", text: iso, time: iso.slice(11, 16), date: iso.slice(0, 10) };
}
