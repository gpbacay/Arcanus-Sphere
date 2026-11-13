// Copies MapLibre's web worker into public/maplibre/<version>/, so the world map loads it from Arcanus's own server
// (and from the service worker's cache offline) instead of a path the bundler can't resolve. Runs after npm install;
// the copy is git-ignored. location/WorldMap.tsx points MapLibre at it with setWorkerUrl().
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = join(root, "node_modules", "maplibre-gl");
const { version } = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));
const dest = join(root, "public", "maplibre", version);
rmSync(join(root, "public", "maplibre"), { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(join(pkg, "dist", "maplibre-gl-worker.mjs"), join(dest, "maplibre-gl-worker.mjs"));
console.log(`[copy-maplibre] Copied the map worker to public/maplibre/${version}`);
