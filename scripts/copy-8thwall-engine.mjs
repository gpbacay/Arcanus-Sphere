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

