// Bakes Arcanus's orb into public/orb.glb. Motion, shaders, and bloom stay in SphereScene.
// Re-run after changing the shape: npm run orb
import { writeFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

// Node has Blob, not FileReader. The exporter reads its buffer through FileReader.
if (typeof globalThis.FileReader === "undefined") {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        this.onloadend?.();
      });
    }
  };
}

// One frozen circuit layout. Change the seed and re-run to get a different orb.
let seed = 0xa5c4a05;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rand = (a, b) => a + random() * (b - a);

const newLines = () => ({ pos: [], along: [], seed: [] });

function polyline(out, pts, traceSeed = random()) {
  const n = pts.length - 1;
  for (let i = 0; i < n; i++) {
    out.pos.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
    out.along.push(i / n, (i + 1) / n);
    out.seed.push(traceSeed, traceSeed);
  }
}

const onSphere = (lat, lon, r) =>
  new THREE.Vector3(r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), r * Math.cos(lat) * Math.sin(lon));

function trace(out, r, lat, lon, dirs = 8, steps = 14, step = 0.03, maxLat = 1.3) {
  const traceSeed = random();
  let k = Math.floor(random() * dirs);
  const pts = [onSphere(lat, lon, r)];
  for (let s = 0; s < steps; s++) {
    if (random() < 0.3) k = (k + (random() < 0.5 ? 1 : dirs - 1)) % dirs;
    const a = (k / dirs) * Math.PI * 2;
    if (Math.abs(lat + Math.sin(a) * step) > maxLat) break;
    lat += Math.sin(a) * step;
    lon += (Math.cos(a) * step) / Math.cos(lat);
    pts.push(onSphere(lat, lon, r));
  }
  if (pts.length < 3) return;
  polyline(out, pts, traceSeed);
  if (random() < 0.55) {
    const end = pts[pts.length - 1];
    const n = end.clone().normalize();
    const t1 = new THREE.Vector3(0, 1, 0).cross(n).normalize();
    const t2 = n.clone().cross(t1);
    const pad = r * 0.012;
    const ring = Array.from({ length: 7 }, (_, i) => {
      const a = (i / 6) * Math.PI * 2;
      return end.clone().addScaledVector(t1, Math.cos(a) * pad).addScaledVector(t2, Math.sin(a) * pad);
    });
    polyline(out, ring, traceSeed);
  }
}

// `width` > 0 makes a thick band: `strands` parallel lines spread across it (1px lines can't be thicker).
function brokenRing(out, r, arcs, span, wiggle = 0, y = 0, tilt, width = 0, strands = 7) {
  const turn = tilt ? new THREE.Matrix4().makeRotationFromEuler(tilt) : null;
  for (let i = 0; i < arcs; i++) {
    const start = rand(0, Math.PI * 2);
    const end = start + rand(span[0], span[1]);
    let rr = r;
    let yy = y;
    const path = [];
    for (let a = start; a <= end; a += 0.02) {
      if (wiggle && random() < 0.06) rr += (random() < 0.5 ? -1 : 1) * wiggle;
      if (wiggle && random() < 0.03) yy += (random() < 0.5 ? -1 : 1) * wiggle * 0.6;
      path.push([a, rr, yy]);
    }
    if (path.length < 2) continue;
    const traceSeed = random();
    for (let s = 0; s < (width ? strands : 1); s++) {
      const off = width ? (s / (strands - 1) - 0.5) * width : 0;
      // Like the circuit traces: each strand sidesteps now and then on its own, and starts and ends where it likes.
      let jog = 0;
      const from = width ? Math.floor(rand(0, 0.2) * path.length) : 0;
      const to = width ? path.length - Math.floor(rand(0, 0.2) * path.length) : path.length;
      const pts = path.slice(from, to).map(([a, rad, h]) => {
        if (width && random() < 0.05) jog += (random() < 0.5 ? -1 : 1) * (width / strands);
        const p = new THREE.Vector3((rad + off + jog) * Math.cos(a), h, (rad + off + jog) * Math.sin(a));
        return turn ? p.applyMatrix4(turn) : p;
      });
      if (pts.length > 1) polyline(out, pts, traceSeed);
    }
  }
}

function toGeometry(lines) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(lines.pos, 3));
  geometry.setAttribute("along", new THREE.Float32BufferAttribute(lines.along, 1));
  geometry.setAttribute("seed", new THREE.Float32BufferAttribute(lines.seed, 1));
  return geometry;
}

const ink = new THREE.MeshBasicMaterial();
const segments = (lines, base) => {
  const mesh = new THREE.LineSegments(toGeometry(lines), ink);
  mesh.name = "traces";
  mesh.userData = { base };
  return mesh;
};

function build() {
  const scene = new THREE.Scene();
  scene.name = "orb";
  const part = (radius, spin, size, axes = [1, 1, 1], parent = scene) => {
    const g = new THREE.Group();
    g.name = "part";
    g.userData = { part: true, radius, spin, size, axes };
    parent.add(g);
    return g;
  };
  const ringAxes = [0.35, 1, 0.35];

  const outerLines = newLines();
  for (let i = 0; i < 320; i++) trace(outerLines, 1, rand(0.72, 1.22) * (i % 2 ? 1 : -1), rand(0, Math.PI * 2), 8, 16, 0.028);
  for (let i = 0; i < 140; i++) trace(outerLines, 1, rand(-0.7, 0.7), rand(0, Math.PI * 2), 8, 12, 0.03);
  for (const side of [1, -1]) {
    for (let i = 0; i < 4; i++) {
      const lat = (0.66 + i * 0.05) * side;
      brokenRing(outerLines, Math.cos(lat) * 1.02, 5, [0.4, 1.8], 0, Math.sin(lat) * 1.02);
    }
  }
  part(1, rand(0.08, 0.14), 0.07).add(segments(outerLines, 0.13));

  const middleLines = newLines();
  for (let i = 0; i < 380; i++) trace(middleLines, 0.78, rand(-1.25, 1.25), rand(0, Math.PI * 2), 8, 12, 0.032);
  part(0.78, rand(0.14, 0.22), 0.11).add(segments(middleLines, 0.08));

  const innerLines = newLines();
  for (let i = 0; i < 240; i++) trace(innerLines, 0.44, rand(-1.3, 1.3), rand(0, Math.PI * 2), 6, 9, 0.05);
  part(0.44, rand(0.2, 0.32), 0.15).add(segments(innerLines, 0.11));

  for (let k = 0; k < 4; k++) {
    const lines = newLines();
    const inner = 1.04 + k * 0.1;
    // Thick bands, mostly half rings, a few short arcs: never a full circle.
    for (let i = 0; i < 3; i++) brokenRing(lines, rand(inner, inner + 0.1), 1, i ? [2.4, 3.6] : [0.8, 1.8], 0.014, rand(-0.02, 0.02), undefined, rand(0.02, 0.035));
    const ring = part(inner + 0.05, rand(0.25, 0.6), 0.06, ringAxes);
    ring.rotation.set(rand(-0.3, 0.3), rand(0, Math.PI * 2), rand(-0.3, 0.3));
    ring.add(segments(lines, 0.14));
  }

  for (let k = 0; k < 4; k++) {
    const lines = newLines();
    for (let i = 0; i < 2; i++) brokenRing(lines, rand(1.06, 1.2), 1, i ? [2.4, 3.4] : [0.8, 1.6], 0.01, 0, undefined, rand(0.015, 0.03), 5);
    const halo = part(1.13, rand(0.1, 0.35), 0.05, ringAxes);
    halo.rotation.set(Math.PI / 2 + rand(-0.3, 0.3), rand(0, Math.PI * 2), rand(-0.3, 0.3));
    halo.add(segments(lines, 0.16));
  }

  const core = new THREE.Group();
  core.name = "core";
  scene.add(core);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 32, 32), ink);
  eye.name = "core-eye";
  core.add(eye);

  const cageLines = newLines();
  const cage = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.11, 1)).attributes.position;
  for (let i = 0; i < cage.count; i += 2) {
    polyline(cageLines, [new THREE.Vector3().fromBufferAttribute(cage, i), new THREE.Vector3().fromBufferAttribute(cage, i + 1)]);
  }
  part(0.11, rand(0.3, 0.5), 0.1, undefined, core).add(segments(cageLines, 0.7));
  for (const r of [0.15, 0.19, 0.23]) {
    const lines = newLines();
    brokenRing(lines, r, 3, [1.2, 3], 0.004);
    const ring = part(r, rand(0.6, 1.4), 0.15, undefined, core);
    ring.rotation.set(rand(0, Math.PI), rand(0, Math.PI * 2), 0);
    ring.add(segments(lines, 0.9));
  }
  return scene;
}

function check(buf) {
  const view = new DataView(buf);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("not a glb");
  const jsonLen = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  const primitives = json.meshes.flatMap((mesh) => mesh.primitives);
  if (!primitives.some((p) => p.mode === 1)) throw new Error("no line primitives");
  const names = primitives.flatMap((p) => Object.keys(p.attributes));
  if (!names.includes("_ALONG") || !names.includes("_SEED")) throw new Error("trace attributes missing: " + names.join(","));
  const parts = json.nodes.filter((node) => node.extras?.part);
  if (parts.length !== 15) throw new Error("expected 15 parts, got " + parts.length);
  if (!json.nodes.some((node) => node.name === "core")) throw new Error("no core");
  if (!json.nodes.some((node) => node.name === "core-eye")) throw new Error("no core eye");
  console.log(`public/orb.glb ${buf.byteLength} bytes, ${parts.length} parts`);
}

const glb = await new GLTFExporter().parseAsync(build(), { binary: true });
check(glb);
writeFileSync(new URL("../public/orb.glb", import.meta.url), Buffer.from(glb));
