// Arcanus's power switch. Off: the sphere shuts down, it stops answering and listening, and the chat is locked.
// The models stay loaded in memory, so switching back on boots instantly instead of downloading again.
import { Store } from "./store";

const KEY = "arcanus_power_v1";
const BOOT_MS = 1100; // keep in step with BOOT and SHUT in sphere/orb.ts
const SHUT_MS = 800;

/** `changing` is true while the boot or shutdown animation plays. */
export const power = new Store({ on: true, changing: false });

let timer: number | undefined;

export function setPower(on: boolean, save = true) {
  power.set({ on, changing: true });
  window.clearTimeout(timer);
  timer = window.setTimeout(() => power.set({ changing: false }), on ? BOOT_MS : SHUT_MS);
  if (!save) return;
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* storage blocked: the choice lasts this session */
  }
}

/** Read the saved choice and boot (or stay off). Call once on the client. */
export function restorePower() {
  let on = true;
  try {
    on = localStorage.getItem(KEY) !== "off";
  } catch {
    /* storage blocked: Arcanus starts on */
  }
  if (on) setPower(true, false);
  else power.set({ on: false, changing: false });
}
