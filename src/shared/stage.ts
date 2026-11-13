// Whether Arcanus's body is on screen: the sphere has drawn its first frame (the studio), the camera view is up (AR), or the
// CSS orb stands in for a scene that can't draw. The boot greeting waits for this, so Arcanus starts to speak as the
// page appears, not seconds before it: the voice is ready long before the three.js chunk and the orb are. Plain
// functions, no store: nothing renders from it. Pure, so stage.check.ts runs it in Node.

let shown = false;
const waiting = new Set<() => void>();

export const stageShown = () => shown;

/** The stage is on screen. Whoever was waiting for it runs now. */
export function showStage() {
  if (shown) return;
  shown = true;
  const run = [...waiting];
  waiting.clear();
  run.forEach((fn) => fn());
}

/** The stage is gone (its scene unmounted): whatever waits next waits for the next one to appear. */
export function hideStage() {
  shown = false;
}

/** Run `fn` once the stage is on screen: at once if it already is. Returns a function that cancels the wait. */
export function whenShown(fn: () => void): () => void {
  if (shown) {
    fn();
    return () => undefined;
  }
  waiting.add(fn);
  return () => void waiting.delete(fn);
}
