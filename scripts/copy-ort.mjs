// Copies ONNX Runtime Web's WebAssembly files into public/ort/<version>/, so Arcanus serves its own runtime instead
// of fetching it from a CDN at boot (src/shared/served.ts). Runs after npm install; the copy is git-ignored.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = join(root, "node_modules", "onnxruntime-web");
const { version } = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));
const served = readFileSync(join(root, "src", "shared", "served.ts"), "utf8").match(/ORT_PATH = `[^`]*?ort.([^/`]+)/)?.[1];
if (served !== version) console.warn(`[copy-ort] onnxruntime-web is ${version} but src/shared/served.ts serves ${served}: update ORT_PATH.`);
const dest = join(root, "public", "ort", version);
rmSync(join(root, "public", "ort"), { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const file of readdirSync(join(pkg, "dist"))) if (/^ort-wasm-simd-threaded(\.jsep)?\.(mjs|wasm)$/.test(file)) cpSync(join(pkg, "dist", file), join(dest, file));
console.log(`[copy-ort] Copied the runtime to public/ort/${version}`);
