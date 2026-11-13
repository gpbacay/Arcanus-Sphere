// What sits around the chat: which side pane is open on the left over the stage (Arcanus's files, its browser or its
// Graph of Thought, one at a time, so the sphere stays in view), whether the world map is open on the right, and the
// page or file Arcanus is reading along with every message.
import { Store } from "./store";

export type PaneName = "files" | "browser" | "mind";
/** A file or web page handed to Arcanus. It goes into the model's context with each message until removed. */
export type Pinned = { label: string; text: string; href?: string };

// The Graph of Thought (left) and the world map (right) are open from the start; a phone closes both (app/page.tsx).
export const pane = new Store<{ open: PaneName | null; map: boolean; pinned: Pinned | null }>({ open: "mind", map: true, pinned: null });

/** The element id of the top bar's right-hand slot (shell's TopBar), where the studio puts the orb's ⋮ tools. */
export const TOP_ACTIONS = "app-top-actions";

export const openPane = (name: PaneName) => pane.set({ open: name });
export const togglePane = (name: PaneName) => pane.set({ open: pane.state.open === name ? null : name });
export const closePane = () => pane.set({ open: null });
export const toggleMap = (map = !pane.state.map) => pane.set({ map });
export const pin = (pinned: Pinned | null) => pane.set({ pinned });
