// The window's layout: three sections, left, center and right, each showing one page (the chat, the Artifacts or the
// Operating System) or none, so the orb shows there. The Artifacts page is tabbed: `artifact` is the tab it shows. Any page fits any
// section. A side section can be expanded over the center; the center's page then moves to the other side, and that
// side's own page waits behind it until the side is collapsed. Also the page or file Arcanus reads with every message.
import { Store, useStore } from "./store";

export type Page = "chat" | "artifacts" | "os";
/** A page that can be closed: every page but the chat. */
export type PaneName = Exclude<Page, "chat">;
export type Section = "left" | "center" | "right";
export type Side = "left" | "right";
/** A file or web page handed to Arcanus. It goes into the model's context with each message until removed. */
export type Pinned = { label: string; text: string; href?: string };

export const SECTIONS: Section[] = ["left", "center", "right"];
/** Where a page opens from the top bar. */
const HOME: Record<Page, Section> = { chat: "center", artifacts: "left", os: "right" };

type Layout = Record<Section, Page | null>;
/** `artifact`: the Artifacts page's open tab, a file's name ("search-engine.html") or a built-in page ("ar"); "" is the first tab. */
export type State = Layout & { expanded: Side | null; pinned: Pinned | null; artifact: string };

// The Artifacts on the Graph of Thought (left), the chat (center) and the Operating System (right) from the start; a phone shows the chat alone (app/page.tsx).
export const pane = new Store<State>({ left: "artifacts", center: "chat", right: "os", expanded: null, pinned: null, artifact: "" });

/** The section a page is in, or null when it is closed. */
export const sectionOf = (s: Layout, page: Page) => SECTIONS.find((k) => s[k] === page) ?? null;

/** Where a page is drawn: its section, or the other side when it is the center's and a side is expanded over it.
 *  Null when it is closed, or waiting behind the center's page. */
export function shownAt(s: State, page: Page): Section | null {
  const home = sectionOf(s, page);
  if (!home || !s.expanded) return home;
  const other: Side = s.expanded === "left" ? "right" : "left";
  if (home === "center") return other;
  if (home === other) return s.center ? null : other;
  return home;
}

/** Where a page sits and shows: `home` its section, `at` where it is drawn (null: closed or covered), `wide` expanded. */
export function usePlace(page: Page) {
  const home = useStore(pane, (s) => sectionOf(s, page));
  const at = useStore(pane, (s) => shownAt(s, page));
  const wide = useStore(pane, (s) => !!s.expanded && s.expanded === sectionOf(s, page));
  return { home, at, wide };
}

/** Lay out `next`, keeping a side expanded only while it still holds a page and `page` stays in view. */
function lay(next: Layout, page?: Page) {
  const s = { ...pane.state, ...next };
  const expanded = s.expanded && next[s.expanded] && (!page || shownAt(s, page)) ? s.expanded : null;
  pane.set({ ...next, expanded });
}

const layout = (): Layout => ({ left: pane.state.left, center: pane.state.center, right: pane.state.right });

/** Show a page: where it is if it is open, otherwise in its home section, in place of what was there. The chat is never
 *  put away: when it holds that section, the page opens in the center instead. */
export function openPane(page: Page) {
  if (sectionOf(pane.state, page)) {
    if (!shownAt(pane.state, page)) pane.set({ expanded: null }); // it was waiting behind the center's page
    return;
  }
  const next = layout();
  const to = next[HOME[page]] === "chat" ? "center" : HOME[page];
  next[to] = page;
  lay(next, page);
}

export function closePane(page: PaneName) {
  const from = sectionOf(pane.state, page);
  if (!from) return;
  lay({ ...layout(), [from]: null });
}

export const togglePane = (page: PaneName) => (sectionOf(pane.state, page) ? closePane(page) : openPane(page));

/** Show one artifact: its tab, with the Artifacts page opened if it was closed. */
export function openArtifact(artifact: string) {
  pane.set({ artifact });
  openPane("artifacts");
}

/** Move a page to a section. The page there takes its place, so nothing is closed. */
export function movePane(page: Page, to: Section) {
  const next = layout();
  const from = sectionOf(next, page);
  if (from === to) return;
  if (from) next[from] = next[to];
  else if (next[to] === "chat") return; // ponytail: only an open page is moved; opening is openPane's
  next[to] = page;
  pane.set({ ...next, expanded: null });
}

export const toggleExpand = (side: Side) => pane.set({ expanded: pane.state.expanded === side ? null : side });

/** Every page but the chat put away: a phone, where a page takes the whole screen. */
export function closeAllPanes() {
  const keep = (k: Section) => (pane.state[k] === "chat" ? "chat" : null);
  pane.set({ left: keep("left"), center: keep("center"), right: keep("right"), expanded: null });
}

/** The element id of the top bar's right-hand slot (shell's TopBar), where the studio puts the orb's ⋮ tools. */
export const TOP_ACTIONS = "app-top-actions";

export const pin = (pinned: Pinned | null) => pane.set({ pinned });
/** Send a line to the chat as if typed there; false when it wasn't taken. The chat module fills it in (conversation.ts),
 *  so the Operating System can run a skill without importing the chat. */
export const chatLine: { send: (line: string) => boolean } = { send: () => false };
