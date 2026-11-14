// The window's layout: three sections, left, center and right, each showing one page (the chat, the Artifacts or the
// Operating System) or none, so the orb shows there. The Artifacts page is tabbed: `artifact` is the tab it shows. Any page fits any
// section, and any page can be closed. A side section can be expanded over the center; the center's page then moves to the other side, and that
// side's own page waits behind it until the side is collapsed. On a phone one page is in front (`front`); the others wait.
// Also the page or file Arcanus reads with every message.
import { Store, useStore } from "./store";
import { closed, onlyChat, picked, placed, sectionOf, shifted, shownAt, toggled, type Page, type Section, type Side, type View } from "./sections";

export { editorInArtifacts, osDrawsEditor, sectionOf, SECTIONS, shownAt } from "./sections";
export type { Page, Section, Side } from "./sections";

/** A page that can be closed: every page. */
export type PaneName = Page;
/** A file or web page handed to Arcanus. It goes into the model's context with each message until removed. */
export type Pinned = { label: string; text: string; href?: string };

const ARTIFACT_KEY = "arcanus.artifact";

/** `artifact`: the Artifacts page's open tab, a file's name ("search-engine.html") or a built-in page ("ar" or "editor"); "" is the first tab.
 *  `artifactBack`: the last tab that isn't the editor, so closing the editor's place doesn't land on the Graph of Thought. */
export type State = View & { pinned: Pinned | null };

// The Artifacts (left), the chat (center) and the Operating System (right) from the start; a phone shows the chat alone (app/page.tsx).
export const pane = new Store<State>({ left: "artifacts", center: "chat", right: "os", expanded: null, pinned: null, artifact: "", artifactBack: "", front: "chat" });

/** Where a page sits and shows: `home` its section, `at` where it is drawn (null: closed or covered), `wide` expanded, `front` the phone's top page. */
export function usePlace(page: Page) {
  const home = useStore(pane, (s) => sectionOf(s, page));
  const at = useStore(pane, (s) => shownAt(s, page));
  const wide = useStore(pane, (s) => !!s.expanded && s.expanded === sectionOf(s, page));
  const front = useStore(pane, (s) => s.front === page);
  return { home, at, wide, front };
}

const phone = () => globalThis.matchMedia?.("(max-width: 767px)").matches ?? false;

/** Show a page: where it is if it is open, otherwise in its home section, in place of what was there. */
export const openPane = (page: Page) => pane.set(placed(pane.state, page));

export const closePane = (page: Page) => pane.set(closed(pane.state, page));

/** Open a page, or on a phone bring it to the front if it is open behind another. A second press there closes it. */
export const togglePane = (page: Page) => pane.set(toggled(pane.state, page, phone()));

/** Remember which artifact tab is open. The editor doesn't replace the tab the user was on. */
export const pickArtifact = (id: string) => pane.set(picked(pane.state, id));

/** Show one artifact: its tab, with the Artifacts page opened if it was closed. */
export function openArtifact(artifact: string) {
  pickArtifact(artifact);
  openPane("artifacts");
}

/** The tab from the last visit. Called once the page is up: sessionStorage isn't there while the server draws. */
export function restoreArtifactTab() {
  try {
    const saved = sessionStorage.getItem(ARTIFACT_KEY);
    if (saved && !pane.state.artifact) pane.set({ artifact: saved });
  } catch {
    /* private mode */
  }
}

/** Move a page to a section. The page there takes its place, so nothing is closed. */
export const movePane = (page: Page, to: Section) => pane.set(shifted(pane.state, page, to));

export const toggleExpand = (side: Side) => pane.set({ expanded: pane.state.expanded === side ? null : side });

/** Every page but the chat put away: a phone, where a page takes the whole screen. */
export const closeAllPanes = () => pane.set(onlyChat(pane.state));

if (typeof window !== "undefined") {
  pane.subscribe(() => {
    try {
      if (pane.state.artifact) sessionStorage.setItem(ARTIFACT_KEY, pane.state.artifact);
    } catch {
      /* private mode */
    }
  });
}

/** The element id of the top bar's right-hand slot (shell's TopBar), where the studio puts the orb's ⋮ tools. */
export const TOP_ACTIONS = "app-top-actions";

export const pin = (pinned: Pinned | null) => pane.set({ pinned });
/** Send a line to the chat as if typed there; false when it wasn't taken. The chat module fills it in (conversation.ts),
 *  so the Operating System can run a skill without importing the chat. */
export const chatLine: { send: (line: string) => boolean } = { send: () => false };
