// What sits beside the chat: which side pane is open over the stage (Arcanus's files, its browser or its Graph of Thought, one at a time,
// so the sphere stays in view), and the page or file Arcanus is reading along with every message.
import { Store } from "./store";

export type PaneName = "files" | "browser" | "mind";
/** A file or web page handed to Arcanus. It goes into the model's context with each message until removed. */
export type Pinned = { label: string; text: string; href?: string };

export const pane = new Store<{ open: PaneName | null; pinned: Pinned | null }>({ open: null, pinned: null });

export const openPane = (name: PaneName) => pane.set({ open: name });
export const togglePane = (name: PaneName) => pane.set({ open: pane.state.open === name ? null : name });
export const closePane = () => pane.set({ open: null });
export const pin = (pinned: Pinned | null) => pane.set({ pinned });
