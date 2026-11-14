// Copies MapLibre (its code, its web worker and its stylesheet) into public/maplibre/<version>/, so the world map
// artifact is handed it from Arcanus's own server (and from the service worker's cache offline): a sealed artifact
// can't fetch it. Runs after npm install; the copy is git-ignored. modules/artifacts/bridge.ts reads it.
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = join(root, "node_modules", "maplibre-gl");
const { version } = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));
const dest = join(root, "public", "maplibre", version);
rmSync(join(root, "public", "maplibre"), { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const file of ["maplibre-gl.mjs", "maplibre-gl-worker.mjs", "maplibre-gl.css"]) cpSync(join(pkg, "dist", file), join(dest, file));
console.log(`[copy-maplibre] Copied MapLibre to public/maplibre/${version}`);
