// Turn "launch spotify", "click Save in Notepad" or "how much RAM do I have" into a device command, and read what open
// computer use reports back. Pure: no browser, no network, so command.check.ts runs it in Node.

export type Command =
  | { kind: "open"; app: string; /** "launch X" or "open X app": surely an app, not a site. */ explicit: boolean }
  | { kind: "apps" }
  | { kind: "specs" }
  | { kind: "click"; target: string; app?: string }
  | { kind: "type"; text: string; app?: string }
  | { kind: "key"; key: string; app?: string }
  | { kind: "scroll"; direction: "up" | "down" | "left" | "right"; app?: string }
  | { kind: "read"; app?: string };

const POLITE = /^(?:(?:please|arcanus|hey arcanus|can you|could you|would you|now|then)[,\s]+)*/i;
const APP_WORD = /\s+(?:app|application|program|window)$/i;
const SPEC = /\b(?:specs?|specifications|hardware|ram|cpu|processor|cores|gpu|graphics card|graphics|battery|storage|disk space|disks?|free space|operating system|os version|uptime|hostname|screen resolution)\b/i;
const MINE = /\b(?:my|this|i|i'm|am i)\b|\bthe (?:device|computer|pc|laptop|machine|system)\b/i;
const MODIFIER = "ctrl|control|alt|shift|win|windows|super|cmd|command|meta";
const KEY = new RegExp(`^(?:(?:${MODIFIER})\\s*[+-]\\s*)*(?:enter|return|tab|escape|esc|backspace|delete|del|space|spacebar|up|down|left|right|home|end|page ?up|page ?down|f\\d{1,2}|[a-z0-9])(?:\\s+key)?$`, "i");
const XDO: Record<string, string> = { enter: "Return", return: "Return", esc: "Escape", escape: "Escape", backspace: "BackSpace", delete: "Delete", del: "Delete", space: "space", spacebar: "space", tab: "Tab", up: "Up", down: "Down", left: "Left", right: "Right", home: "Home", end: "End", pageup: "Page_Up", pagedown: "Page_Down" };
const MOD: Record<string, string> = { control: "ctrl", windows: "super", win: "super", command: "cmd", meta: "super" };

const clean = (s: string) => s.trim().replace(/^(?:the|my)\s+/i, "").replace(APP_WORD, "").trim();

/** "save in notepad" -> ["save", "notepad"]: split at the last " in " (or `words`), when something follows it. */
function splitApp(rest: string, words = "in|on|inside"): [string, string | undefined] {
  const m = rest.match(new RegExp(`^(.+)\\s+(?:${words})\\s+(?:the\\s+|my\\s+)?(\\S.*)$`, "i"));
  return m ? [m[1].trim(), clean(m[2])] : [rest.trim(), undefined];
}

/** "ctrl+s", "page down", "Enter key" in the xdotool names open computer use takes ("ctrl+s", "Page_Down", "Return"). */
export function keyName(spoken: string): string {
  const parts = spoken.toLowerCase().replace(/\s+key$/, "").split(/\s*[+-]\s*/);
  const key = parts.pop()!.replace(/\s+/g, "");
  const named = XDO[key] ?? (/^f\d{1,2}$/.test(key) ? key.toUpperCase() : key);
  return [...parts.map((m) => MOD[m] ?? m), named].join("+");
}

/**
 * `text` as one key per character ("Hi 2" -> shift+h, i, space, 2), or null when it holds a character with no plain key.
 * ponytail: letters, digits and spaces only, up to 80 characters; punctuation needs its xdotool name checked on each OS.
 */
export function typedKeys(text: string): string[] | null {
  if (!/^[A-Za-z0-9 ]{1,80}$/.test(text)) return null;
  return [...text].map((c) => (c === " " ? "space" : /[A-Z]/.test(c) ? `shift+${c.toLowerCase()}` : c));
}

/** The device command in `text`, or null when it isn't one. */
export function deviceCommand(input: string): Command | null {
  const text = input.trim().replace(/[.!?]+$/, "").replace(POLITE, "").trim();
  if (!text) return null;
  if (/\b(?:what|which|list|show)\b.*\b(?:apps?|applications|programs|windows)\b.*\b(?:open|running)\b|^(?:list|show)(?: me)?(?: the| my)? (?:open|running) (?:apps|applications|programs|windows)$/i.test(text)) return { kind: "apps" };
  if (SPEC.test(text) && MINE.test(text) && !/\b(?:you|your|arcanus)\b/i.test(text)) return { kind: "specs" };

  let m = text.match(/^(?:launch|start|fire up|open up)\s+(?!a\b|an\b|over\b)(.+)$/i);
  if (m) return { kind: "open", app: clean(m[1]), explicit: true };
  m = text.match(/^open\s+(.+)$/i);
  if (m && !/^https?:|\s(?:and|then)\s/i.test(m[1])) return { kind: "open", app: clean(m[1]), explicit: APP_WORD.test(m[1].trim()) };

  m = text.match(/^type\s+["“'](.+?)["”']\s*(?:(?:in|into)\s+(.+))?$/i);
  if (m) return { kind: "type", text: m[1], app: m[2] ? clean(m[2]) : undefined };
  m = text.match(/^type\s+(?!of\b)(.+)$/i);
  if (m) {
    const [typed, app] = / into /i.test(m[1]) ? splitApp(m[1], "into") : splitApp(m[1], "in");
    return { kind: "type", text: typed, app };
  }

  m = text.match(/^scroll\s+(up|down|left|right)\b(?:\s+(?:a\s+(?:bit|little)|more|some))?(?:\s+(?:in|on)\s+(.+))?$/i);
  if (m) return { kind: "scroll", direction: m[1].toLowerCase() as "up", app: m[2] ? clean(m[2]) : undefined };

  m = text.match(/^(?:click|tap|press|hit)\s+(?:on\s+)?(.+)$/i);
  if (m) {
    const [target, app] = splitApp(m[1]);
    const bare = target.replace(/^(?:the\s+)/i, "");
    if (KEY.test(bare) && !/^(?:click|tap)/i.test(text)) return { kind: "key", key: keyName(bare), app };
    if (/^hit/i.test(text)) return null; // "hit me with a joke"
    return { kind: "click", target: bare.replace(/\s+(?:button|link|tab|menu|icon|option|item|checkbox)$/i, ""), app };
  }

  if (/^(?:what(?:'s| is) on|read|look at|describe|check) (?:my |the )?screen$/i.test(text)) return { kind: "read" };
  m = text.match(/^(?:read|look at|check|inspect|describe|scan|what(?:'s| is| do you see)\s+(?:on|in))\s+(?:the\s+|my\s+)?(.+?)\s+(?:window|app|screen)$/i);
  if (m) return { kind: "read", app: clean(m[1]) };
  m = text.match(/^what do you see in\s+(.+)$/i);
  if (m) return { kind: "read", app: clean(m[1]) };
  return null;
}

// ------------------------------------------------------------------ apps on this device

export type App = { name: string; id: string };

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const ALIASES: Record<string, string> = { explorer: "file explorer", files: "file explorer", "file manager": "file explorer", calc: "calculator", cmd: "command prompt", terminal: "terminal", "control panel": "control panel", "task manager": "task manager" };

/**
 * The installed app `query` names. `exact` (an "open X" that may be a website) takes only the app's own name;
 * otherwise a name that starts with the words, then one holding them all, the shortest first.
 */
export function matchApp(apps: App[], query: string, exact = false): App | null {
  const q = norm(ALIASES[norm(query)] ?? query);
  if (!q) return null;
  const named = apps.filter((a) => norm(a.name) === q);
  if (named.length || exact) return named[0] ?? null;
  const words = q.split(" ");
  const by = (test: (n: string) => boolean) => apps.filter((a) => test(norm(a.name))).sort((a, b) => a.name.length - b.name.length)[0];
  return by((n) => n.startsWith(`${q} `)) ?? by((n) => words.every((w) => n.split(" ").includes(w))) ?? null;
}

// ------------------------------------------------------------------ what open computer use reports

export type Element = { index: string; depth: number; role: string; title: string; actions: string[]; area: number };

// Windows UI Automation names its roles in words ("menu item"); the longest is tried first.
const ROLES = ["split button", "radio button", "check box", "combo box", "menu item", "menu bar", "list item", "tab item", "tree item", "title bar", "tool bar", "scroll bar", "data item", "data grid", "button", "hyperlink", "link", "edit", "document", "text", "pane", "window", "list", "tree", "tab", "group", "image", "menu", "table", "toolbar", "slider", "header"];
const CLICKABLE = /button|item|link|check box|tab|combo box/;

/** The numbered elements of a get_app_state tree: "\t5 button Save Secondary Actions: Invoke Frame: {x: 1, …}". */
export function parseTree(state: string): Element[] {
  return state.split("\n").flatMap((line) => {
    const m = line.match(/^(\t*)\s*(\d+) (.*)$/);
    if (!m) return [];
    let rest = m[3];
    const frame = rest.match(/\s*Frame: \{x: -?\d+, y: -?\d+, width: (\d+), height: (\d+)\}/);
    if (frame) rest = rest.replace(frame[0], "");
    const acts = rest.match(/\s*Secondary Actions: (.*)$/);
    if (acts) rest = rest.replace(acts[0], "");
    const role = ROLES.find((r) => rest.toLowerCase() === r || rest.toLowerCase().startsWith(`${r} `)) ?? rest.split(" ")[0];
    return [{ index: m[2], depth: m[1].length, role, title: rest.slice(role.length).trim(), actions: acts ? acts[1].split(/,\s*/) : [], area: frame ? Number(frame[1]) * Number(frame[2]) : 0 }];
  });
}

/** The element `target` names: its exact title, then one starting with it, then one holding it; clickable ones first. */
export function pickElement(elements: Element[], target: string): Element | null {
  const t = norm(target);
  if (!t) return null;
  const score = (e: Element) => {
    const title = norm(e.title);
    const base = title === t ? 3 : title.startsWith(t) ? 2 : ` ${title} `.includes(` ${t} `) ? 1 : 0;
    return base && base + (CLICKABLE.test(e.role) ? 0.5 : 0);
  };
  let best: Element | null = null, top = 0;
  for (const e of elements) {
    const s = score(e);
    if (s > top) [best, top] = [e, s];
  }
  return best;
}

/** What to scroll: the biggest document, list or pane; else the window. */
export function scrollTarget(elements: Element[]): string {
  const fit = elements.filter((e) => e.index !== "0" && /document|list|tree|table|data grid|edit|pane/.test(e.role)).sort((a, b) => b.area - a.area)[0];
  return fit?.index ?? "0";
}

/** What to focus to bring a window forward: the text box first, else a button that isn't the title bar's. */
export function focusTarget(elements: Element[]): string | null {
  const edit = elements.find((e) => /^(?:edit|document)$/.test(e.role));
  const button = elements.find((e) => e.role === "button" && !/^(?:minimize|maximize|restore|close)\b/i.test(e.title));
  return (edit ?? button)?.index ?? null;
}

/** "notepad -- notepad [running, pid=1234, window=Untitled - Notepad]" -> "notepad: Untitled - Notepad". */
export function appLines(listed: string): string[] {
  return listed.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(.+?) -- .*?window=(.*)\]$/);
    return m ? `${m[1]}: ${m[2]}` : l;
  });
}

// ------------------------------------------------------------------ specs

export type Specs = {
  host: string;
  user: string;
  os: { name: string; release: string; arch: string };
  cpu: { model: string; cores: number };
  memory: { total: number; free: number };
  disks: { path: string; total: number; free: number }[];
  uptime: number;
  gpu?: string;
  battery?: { level: number; charging: boolean };
  screen?: { width: number; height: number; scale: number };
};

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
function duration(seconds: number) {
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60);
  return [d && `${d} d`, h && `${h} h`, `${m} min`].filter(Boolean).join(" ");
}

/** The spec lines a question asks about ("how much RAM"), or all of them. */
export function specLines(s: Specs, question = ""): string[] {
  const lines: [RegExp, string | null][] = [
    [/\b(?:name|hostname|user|signed)\b/i, `**Device:** ${s.host} (signed in as ${s.user})`],
    [/\b(?:os|operating system|windows|mac|linux|version)\b/i, `**System:** ${s.os.name} ${s.os.release} (${s.os.arch})`],
    [/\b(?:cpu|processor|cores?)\b/i, `**Processor:** ${s.cpu.model} · ${s.cpu.cores} threads`],
    [/\b(?:ram|memory)\b/i, `**Memory:** ${gb(s.memory.total)}, ${gb(s.memory.free)} free`],
    [/\b(?:storage|disks?|drives?|space)\b/i, s.disks.length ? `**Storage:** ${s.disks.map((d) => `${d.path} ${gb(d.total)}, ${gb(d.free)} free`).join(" · ")}` : null],
    [/\b(?:gpu|graphics)\b/i, s.gpu ? `**Graphics:** ${s.gpu}` : null],
    [/\b(?:battery|charging|power)\b/i, s.battery ? `**Battery:** ${Math.round(s.battery.level * 100)}%${s.battery.charging ? ", charging" : ""}` : null],
    [/\b(?:screen|display|resolution|monitor)\b/i, s.screen ? `**Display:** ${s.screen.width}×${s.screen.height} at ${Math.round(s.screen.scale * 100)}%` : null],
    [/\b(?:uptime|up|running)\b/i, `**Up for:** ${duration(s.uptime)}`],
  ];
  const asked = lines.filter(([topic, line]) => line && topic.test(question) && !/\bspecs?\b|specifications|hardware/i.test(question));
  return (asked.length ? asked : lines).flatMap(([, line]) => (line ? [line] : []));
}
