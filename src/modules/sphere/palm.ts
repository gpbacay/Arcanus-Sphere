import * as THREE from "three";
import { frameToNdc, isOpen, OneEuro, palmCentre, palmDepth, type Hand } from "./palm.math";

/**
 * Finds an open hand held out in front of the camera, so Arcanus can rest on the palm and follow it. The hand tracker
 * (public/palm.worker.js, MediaPipe) runs in its own worker, so it never costs the orb a frame. It looks at a small copy of
 * the camera frame: a few times a second while there is no hand, faster once it has one.
 * The world tracking (XR8) cannot do both at once, so this reads the same camera frames XR8 hands out and turns the palm
 * back into a point in XR8's world, using the camera's pose from the moment the frame was taken.
 */
export type Frame = { pixels: Uint8Array; cols: number; rows: number };

const SEARCH_EVERY = 160; // ms between looks while no hand is in view
const TRACK_EVERY = 33; // ms between looks once there is one (about 30 a second at most)
const GRACE = 0.7; // s a hand may vanish, or close for a moment, before Arcanus lets go of it

export type Palm = ReturnType<typeof createPalm>;

export function createPalm({ camera, size, onReady }: { camera: () => THREE.PerspectiveCamera | null; size: () => { w: number; h: number }; onReady: () => void }) {
  const worker = new Worker("/palm.worker.js", { type: "module" });
  const target = new THREE.Vector3(); // the middle of the palm, in the world, smoothed
  const filters = [new OneEuro(), new OneEuro(), new OneEuro()];
  const pose = new THREE.Matrix4(); // where the camera was when the frame in flight was taken
  const inverse = new THREE.Matrix4();
  const point = new THREE.Vector3();
  let ready = false;
  let busy = false;
  let next = 0;
  let seenAt = -Infinity; // s, when an open hand was last seen
  let suppressed = false; // the person placed Arcanus by hand: leave it until the hand has gone away once
  let frame = { cols: 0, rows: 0 };

  const found = (hand: Hand) => {
    const cam = camera();
    const { cols, rows } = frame;
    if (!cam || !isOpen(hand, cols, rows)) return; // a fist, or a finger pointing, is not an offered palm
    const { w, h } = size();
    const z = palmDepth(hand, cols, rows, h, cam.projectionMatrix.elements[5]);
    if (z === null) return;
    const [u, v] = palmCentre(hand);
    const [x, y] = frameToNdc(u, v, cols, rows, w, h);
    // Out along the ray through the palm, to the distance the hand's size gives, then into the world.
    point.set(x, y, 0.5).applyMatrix4(inverse.copy(cam.projectionMatrix).invert());
    point.multiplyScalar(z / -point.z).applyMatrix4(pose);
    const now = performance.now() / 1000;
    if (now - seenAt > GRACE) for (const filter of filters) filter.reset(); // a new hand: start from where it is
    seenAt = now;
    target.set(filters[0].filter(point.x, now), filters[1].filter(point.y, now), filters[2].filter(point.z, now));
  };

  worker.onerror = (event) => console.warn("Palm tracking is unavailable:", event.message);
  worker.onmessage = ({ data }: MessageEvent<{ type: string; points: Float32Array | null; world: Float32Array | null; message?: string }>) => {
    if (data.type === "ready") {
      ready = true;
      onReady();
    } else if (data.type === "error") {
      console.warn("Palm tracking is unavailable:", data.message);
    } else if (data.type === "hand") {
      busy = false;
      if (data.points && data.world) found({ points: data.points, world: data.world });
    }
  };
  worker.postMessage({ type: "load", model: new URL("/hand_landmarker.task", location.origin).href });

  const holding = () => {
    const since = performance.now() / 1000 - seenAt;
    if (since > GRACE) suppressed = false; // the hand has been away: it may pick Arcanus up again
    return !suppressed && since < GRACE;
  };

  return {
    target,
    /** Offer this frame's camera pixels. Taken up only when the worker is free and it is time to look again. */
    offer(pixels: Frame | undefined, ms: number) {
      const cam = camera();
      if (!ready || busy || ms < next || !cam || !pixels?.pixels || pixels.pixels.byteLength !== pixels.cols * pixels.rows * 4) return;
      next = ms + (holding() ? TRACK_EVERY : SEARCH_EVERY);
      busy = true;
      frame = { cols: pixels.cols, rows: pixels.rows };
      cam.updateMatrixWorld();
      pose.copy(cam.matrixWorld);
      const buffer = pixels.pixels.buffer; // the engine makes a fresh buffer every frame: hand it over, no copy
      worker.postMessage({ type: "frame", id: 0, buffer, cols: pixels.cols, rows: pixels.rows }, [buffer]);
    },
    /** Whether Arcanus is resting on a palm right now. */
    holding,
    /** Arcanus was placed or moved by touch: let it stay there. */
    suppress() {
      suppressed = true;
    },
    stop() {
      worker.terminate();
    },
  };
}
