// Where each page sits. Pure, so sections are checked from Node (sections.check.ts) without the React store.
export type Page = "chat" | "artifacts" | "os";
export type Section = "left" | "center" | "right";
export type Side = "left" | "right";
export const SECTIONS: Section[] = ["left", "center", "right"];

export type Layout = Record<Section, Page | null>;
/** The part of the window the layout functions read and write. */
export type View = Layout & { expanded: Side | null; artifact: string; artifactBack: string; front: Page | null };

const HOME: Record<Page, Section> = { chat: "center", artifacts: "left", os: "right" };

/** The section a page is in, or null when it is closed. */
export const sectionOf = (s: Layout, page: Page) => SECTIONS.find((k) => s[k] === page) ?? null;

/** Where a page is drawn: its section, or the other side when it is the center's and a side is expanded over it.
 *  Null when it is closed, or waiting behind the center's page. */
export function shownAt(s: View, page: Page): Section | null {
  const home = sectionOf(s, page);
  if (!home || !s.expanded) return home;
  const other: Side = s.expanded === "left" ? "right" : "left";
  if (home === "center") return other;
  if (home === other) return s.center ? null : other;
  return home;
}

/** The Operating System is drawing the editor itself: that section is expanded, or the Operating System sits in the center. */
export const osDrawsEditor = (s: View) => (s.expanded !== null && s[s.expanded] === "os") || shownAt(s, "os") === "center";
/** The editor is an Artifacts tab: the Operating System isn't drawing it, and that pane is open or the editor is the tab in use.
 *  Closing the Operating System leaves the editor tab when it was the one open. */
export const editorInArtifacts = (s: View) => !osDrawsEditor(s) && (shownAt(s, "os") != null || s.artifact === "editor");

const openPage = (s: Layout) => SECTIONS.map((k) => s[k]).find((p): p is Page => !!p) ?? null;

function finish(s: View, next: Layout, page?: Page): View {
  const merged = { ...s, ...next };
  const expanded = merged.expanded && next[merged.expanded] && (!page || shownAt(merged, page)) ? merged.expanded : null;
  return { ...merged, expanded, ...(page ? { front: page } : {}) };
}

/** Show a page in its home section, in place of what was there, and bring it to the front. */
export function placed(s: View, page: Page): View {
  if (sectionOf(s, page)) return { ...s, expanded: shownAt(s, page) ? s.expanded : null, front: page };
  const next: Layout = { left: s.left, center: s.center, right: s.right };
  next[HOME[page]] = page;
  return finish(s, next, page);
}

/** Close a page. The front page, once closed, is the next one that is still open. */
export function closed(s: View, page: Page): View {
  const from = sectionOf(s, page);
  if (!from) return s;
  const next: Layout = { ...{ left: s.left, center: s.center, right: s.right }, [from]: null };
  const laid = finish(s, next);
  return s.front === page ? { ...laid, front: openPage(next) } : laid;
}

/** Open a page, or on a phone bring an open one to the front. A second press there closes it. */
export function toggled(s: View, page: Page, narrow: boolean): View {
  if (!sectionOf(s, page)) return placed(s, page);
  if (narrow && s.front !== page) return { ...s, front: page };
  return closed(s, page);
}

/** Move a page. The page in the destination takes its place, so nothing is closed. */
export function shifted(s: View, page: Page, to: Section): View {
  const next: Layout = { left: s.left, center: s.center, right: s.right };
  const from = sectionOf(next, page);
  if (!from || from === to) return s;
  next[from] = next[to];
  next[to] = page;
  return { ...s, ...next, expanded: null, front: page };
}

/** Every page but the chat put away. */
export function onlyChat(s: View): View {
  const next: Layout = {
    left: s.left === "chat" ? "chat" : null,
    center: s.center === "chat" ? "chat" : null,
    right: s.right === "chat" ? "chat" : null,
  };
  return { ...s, ...next, expanded: null, front: openPage(next) };
}

/** The editor doesn't replace the artifact tab the user was on. */
export function picked(s: { artifact: string; artifactBack: string }, id: string) {
  const artifactBack = id !== "editor" ? id : s.artifactBack || (s.artifact && s.artifact !== "editor" ? s.artifact : s.artifactBack);
  return { artifact: id, artifactBack };
}
