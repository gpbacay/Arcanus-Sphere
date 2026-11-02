// Copies the 8th Wall XR engine (@8thwall/engine-binary) into public/external/xr so /ar can load xr.js as a plain
// static script, not a bundled one. Runs after npm install; the copy is git-ignored.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "@8thwall", "engine-binary", "dist");
const dest = join(root, "public", "external", "xr");

if (!existsSync(src)) {
  console.warn("[copy-8thwall-engine] @8thwall/engine-binary is not installed; AR will be unavailable.");
  process.exit(0);
}
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log("[copy-8thwall-engine] Copied the engine to public/external/xr");

// The hand tracker (MediaPipe) that lets Arcanus rest on your palm. Its worker (public/palm.worker.js) is a plain static
// file, so the library is served the same way instead of being bundled.
const hands = join(root, "node_modules", "@mediapipe", "tasks-vision");
if (existsSync(hands)) {
  const out = join(root, "public", "external", "mediapipe");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(join(hands, "vision_bundle.mjs"), join(out, "vision_bundle.mjs"));
  cpSync(join(hands, "wasm"), join(out, "wasm"), { recursive: true });
  console.log("[copy-8thwall-engine] Copied the hand tracker to public/external/mediapipe");
} else {
  console.warn("[copy-8thwall-engine] @mediapipe/tasks-vision is not installed; palm tracking will be unavailable.");
}
