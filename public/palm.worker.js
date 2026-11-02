// Hand Landmarker (MediaPipe, Apache-2.0) off the main thread, so finding a hand never costs the orb a frame.
// A plain static module worker, not bundled: the library loads its WebAssembly with a runtime import() that a bundler would
// rewrite. scripts/copy-8thwall-engine.mjs puts the library in /external/mediapipe.
// In:  { type: "load", model }  |  { type: "frame", id, buffer, cols, rows }  (RGBA pixels, top row first)
// Out: { type: "ready", delegate }  |  { type: "error", message }  |  { type: "hand", id, points, world }
//      points: 21 x (u, v) in the frame, 0..1.  world: 21 x (x, y) in metres around the hand's centre, y down.
//      Both are null when no hand is in the frame.
import { FilesetResolver, HandLandmarker } from "/external/mediapipe/vision_bundle.mjs";

// MediaPipe loads its WebAssembly glue with importScripts, which a module worker does not have. Its fallback calls
// self.import when there is one. The glue is a classic script that must define a global (ModuleFactory), so run it as one.
self.import = async (url) => (0, eval)(await (await fetch(url)).text());

let landmarker = null;
let delegate = "GPU";
let last = 0; // detectForVideo wants strictly rising timestamps

const make = async (model, which) =>
  HandLandmarker.createFromOptions(await FilesetResolver.forVisionTasks("/external/mediapipe/wasm"), {
    baseOptions: { modelAssetPath: model, delegate: which },
    runningMode: "VIDEO", // tracks from frame to frame: the palm detector only runs when the hand is lost
    numHands: 1,
  });

let model = "";
async function load() {
  try {
    landmarker = await make(model, "GPU");
  } catch {
    delegate = "CPU"; // no WebGL in this worker (older Safari): slower, still off the main thread
    landmarker = await make(model, "CPU");
  }
  self.postMessage({ type: "ready", delegate });
}

const flat = (list, xy) => {
  const out = new Float32Array(42);
  list.forEach((p, i) => ((out[2 * i] = p.x), (out[2 * i + 1] = p.y)));
  return out;
};

async function detect({ id, buffer, cols, rows }) {
  const now = Math.max(Math.round(performance.now()), last + 1);
  last = now;
  let result;
  try {
    result = landmarker.detectForVideo(new ImageData(new Uint8ClampedArray(buffer), cols, rows), now);
  } catch (error) {
    if (delegate === "GPU") {
      // The GPU path loaded but cannot run here: fall back to the CPU once.
      delegate = "CPU";
      landmarker = await make(model, "CPU");
    }
    self.postMessage({ type: "hand", id, points: null, world: null });
    return void console.error(error);
  }
  const found = result.landmarks[0] && result.worldLandmarks[0];
  const points = found ? flat(result.landmarks[0]) : null;
  const world = found ? flat(result.worldLandmarks[0]) : null;
  self.postMessage({ type: "hand", id, points, world }, found ? [points.buffer, world.buffer] : []);
}

self.onmessage = ({ data }) => {
  if (data.type === "load") {
    model = data.model;
    load().catch((error) => self.postMessage({ type: "error", message: String(error?.message ?? error) }));
  } else if (data.type === "frame" && landmarker) {
    detect(data).catch((error) => self.postMessage({ type: "error", message: String(error?.message ?? error) }));
  }
};
