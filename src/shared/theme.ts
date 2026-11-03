// Light or dark panels. The sphere stage stays dark either way: the orb is drawn for a black room.
import { Store } from "./store";

const KEY = "arcanus_theme";
export type Theme = "dark" | "light";

export const theme = new Store<{ mode: Theme }>({ mode: "dark" });

export function applyTheme(mode: Theme, save = true) {
  theme.set({ mode });
  document.documentElement.classList.toggle("light", mode === "light");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mode === "light" ? "#e8ebf0" : "#07080a");
  if (!save) return;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* storage blocked: the choice lasts this session */
  }
}

/** Read the saved choice. Call once on the client. A script in the root layout paints the class first, so this does not flash. */
export function restoreTheme() {
  let mode: Theme = "dark";
  try {
    if (localStorage.getItem(KEY) === "light") mode = "light";
  } catch {
    /* storage blocked: stay dark */
  }
  applyTheme(mode, false);
}
