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

/** The two directions along a sphere's surface at `p`, for drawing pads flat on it. */
function tangents(p) {
  const n = p.clone().normalize();
  const t1 = new THREE.Vector3(0, 1, 0).cross(n).normalize();
  return [t1, n.cross(t1)];
}

/** A solder pad: a small square (or a `ring`) flat on the surface at `p`, in the bright `pads` set. */
function pad(pads, p, [t1, t2], size, traceSeed, ring = random() < 0.3) {
  const n = ring ? 8 : 4;
  const s = ring ? size : size * Math.SQRT2;
  const pts = Array.from({ length: n + 1 }, (_, i) => {
    const a = ((i % n) / n) * Math.PI * 2 + (ring ? 0 : Math.PI / 4);
    return p.clone().addScaledVector(t1, Math.cos(a) * s).addScaledVector(t2, Math.sin(a) * s);
  });
  polyline(pads, pts, traceSeed);
}

// A printed trace on a shell: it runs straight, turns at right angles (now and then 45 degrees, as circuit boards do), and
// lands on a pad at some corners and at its end.
function trace(out, pads, r, lat, lon, steps = 14, step = 0.03, maxLat = 1.3) {
  const traceSeed = random();
  let k = Math.floor(random() * 8);
  let run = 0;
  const pts = [onSphere(lat, lon, r)];
  for (let s = 0; s < steps; s++) {
    if (run <= 0) {
      if (s) {
        k = (k + (random() < 0.7 ? 2 : 1) * (random() < 0.5 ? 1 : 7)) % 8;
        if (random() < 0.25) pad(pads, pts[pts.length - 1], tangents(pts[pts.length - 1]), r * 0.006, traceSeed);
      }
      run = Math.floor(rand(2, 7));
    }
    const a = (k / 8) * Math.PI * 2;
    if (Math.abs(lat + Math.sin(a) * step) > maxLat) break;
    lat += Math.sin(a) * step;
    lon += (Math.cos(a) * step) / Math.cos(lat);
    pts.push(onSphere(lat, lon, r));
    run--;
  }
  if (pts.length < 3) return;
  polyline(out, pts, traceSeed);
  if (random() < 0.45) pad(pads, pts[pts.length - 1], tangents(pts[pts.length - 1]), r * 0.008, traceSeed);
}

/** A point of a flat ring: angle `a`, radius `r`, `h` above its plane. */
const flat = (a, r, h = 0) => new THREE.Vector3(r * Math.cos(a), h, r * Math.sin(a));
/** Outward and around at angle `a` of a flat ring. */
const flatTangents = (a) => [new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), new THREE.Vector3(-Math.sin(a), 0, Math.cos(a))];

const LANE = 0.02; // spacing of the traces that cover a ring's faces
const lanesFor = (size) => Math.max(1, Math.round(size / LANE) + 1);

// A ring as a solid bar of circuitry: a rectangular bar `width` thick (in and out) and `height` tall (along the axis),
// bent round at radius `r`. Traces run along all four faces, broken into runs with gaps, with jumpers hopping between
// neighbouring traces and pads where they land, and the bar's cross-section is drawn as a rib every so often and at both
// ends, which is what makes it read as a box from any angle. `span` is how much of the circle it covers: a half ring stops
// where it stops, each trace ending a little differently so the break looks torn, not cut.
function band(out, pads, r, width, height, span = Math.PI * 2, h = 0) {
  const whole = span >= Math.PI * 2;
  const start = rand(0, Math.PI * 2);
  const rs = Array.from({ length: lanesFor(width) }, (_, i) => r - width / 2 + (width * i) / Math.max(1, lanesFor(width) - 1));
  const hs = Array.from({ length: lanesFor(height) }, (_, i) => h - height / 2 + (height * i) / Math.max(1, lanesFor(height) - 1));
  // The faces, each a list of [radius, height] traces: the walls run up the axis, the top and bottom run across.
  const faces = [];
  if (width) faces.push(hs.map((hh) => [rs[0], hh]), hs.map((hh) => [rs[rs.length - 1], hh]));
  if (height) faces.push(rs.map((rr) => [rr, hs[0]]), rs.map((rr) => [rr, hs[hs.length - 1]]));
  if (!faces.length) faces.push([[r, h]]);
  const seen = new Set();
  for (const face of faces) {
    for (const [rr, hh] of face) {
      const key = rr.toFixed(4) + ":" + hh.toFixed(4);
      if (seen.has(key)) continue; // the corners belong to two faces: trace them once
      seen.add(key);
      let a = whole ? start : start + rand(0, 0.12);
      const until = whole ? a + span : start + span - rand(0, 0.12);
      while (a < until) {
        const len = Math.min(rand(0.3, 1.6), until - a);
        const pts = [];
        for (let t = 0; t <= len; t += 0.03) pts.push(flat(a + t, rr, hh));
        if (pts.length > 1) polyline(out, pts);
        a += len + rand(0.03, 0.25);
      }
    }
  }
  // Jumpers: short hops between neighbouring traces of a face, some landing on a pad.
  for (const face of faces) {
    const wall = face.length > 1 && face[0][0] === face[1][0]; // a wall: traces stacked up the axis
    for (let i = 0; i < (face.length - 1) * 10; i++) {
      const l = Math.floor(rand(0, face.length - 1));
      const a = start + rand(0, span);
      const traceSeed = random();
      polyline(out, [flat(a, ...face[l]), flat(a, ...face[l + 1])], traceSeed);
      if (random() < 0.5) {
        const [radial, around] = flatTangents(a);
        pad(pads, flat(a, ...face[random() < 0.5 ? l : l + 1]), [wall ? new THREE.Vector3(0, 1, 0) : radial, around], Math.min(0.008, Math.max(width, height) * 0.1), traceSeed);
      }
    }
  }
  // Ribs: the bar's cross-section, at both ends and along the way.
  if (width && height) {
    const ribs = [start, start + span];
    for (let a = start + rand(0.08, 0.2); a < start + span - 0.05; a += rand(0.1, 0.3)) ribs.push(a);
    for (const a of ribs) {
      const c = (dr, dh) => flat(a, r + dr, h + dh);
      polyline(out, [c(-width / 2, -height / 2), c(width / 2, -height / 2), c(width / 2, height / 2), c(-width / 2, height / 2), c(-width / 2, -height / 2)]);
    }
  }
}

// Circuits wired in towards the core: traces from rFrom to rTo across one plane, each stepping aside at a right angle
// once or twice on the way, with a pad where it turns and a small component body on some.
function spokes(out, pads, count, rFrom, rTo) {
  for (let i = 0; i < count; i++) {
    const a = rand(0, Math.PI * 2);
    const h = rand(-0.06, 0.06); // not all exactly in the plane: a little depth
    const traceSeed = random();
    const frame = flatTangents(a);
    const at = (r, s) => flat(a, r, h).addScaledVector(frame[1], s);
    let s = 0;
    const pts = [at(rFrom, 0)];
    const jogs = Array.from({ length: Math.floor(rand(1, 4)) }, () => rand(rTo + 0.04, rFrom - 0.04)).sort((p, q) => q - p);
    for (const r of jogs) {
      pts.push(at(r, s));
      if (random() < 0.5) pad(pads, pts[pts.length - 1], frame, 0.007, traceSeed);
      s += (random() < 0.5 ? -1 : 1) * rand(0.015, 0.05);
      pts.push(at(r, s));
    }
    pts.push(at(rTo, s));
    polyline(out, pts, traceSeed);
    if (random() < 0.7) pad(pads, pts[pts.length - 1], frame, 0.009, traceSeed, false);
    if (random() < 0.5) {
      // A component: a small rectangle sitting on the trace.
      const r = rand(rTo + 0.1, rFrom - 0.1);
      const along = rand(0.02, 0.05);
      const across = rand(0.01, 0.02);
      const corner = (dr, ds) => at(r + dr, s + ds);
      polyline(out, [corner(-along, -across), corner(along, -across), corner(along, across), corner(-along, across), corner(-along, -across)], traceSeed);
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
/** A part's traces, plus its pads as a brighter set of their own, so they read as hot solder points. */
const draw = (group, lines, pads, base) => {
  group.add(segments(lines, base));
  if (pads.pos.length) group.add(segments(pads, base * 2.6));
  return group;
};

const PARTS = 23;

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

  // Three shells of circuitry. The outer one is two printed caps with thin rings at their edges and an open band between,
  // so the dial and the shells inside show through.
  const outerLines = newLines();
  const outerPads = newLines();
  for (let i = 0; i < 320; i++) trace(outerLines, outerPads, 1, rand(0.72, 1.22) * (i % 2 ? 1 : -1), rand(0, Math.PI * 2), 16, 0.028);
  for (let i = 0; i < 120; i++) trace(outerLines, outerPads, 1, rand(-0.7, 0.7), rand(0, Math.PI * 2), 12, 0.03);
  for (const side of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const lat = (0.66 + i * 0.06) * side;
      band(outerLines, outerPads, Math.cos(lat) * 1.02, 0.015, 0.015, Math.PI * 2, Math.sin(lat) * 1.02);
    }
  }
  draw(part(1, rand(0.08, 0.14), 0.07), outerLines, outerPads, 0.13);

  const middleLines = newLines();
  const middlePads = newLines();
  for (let i = 0; i < 380; i++) trace(middleLines, middlePads, 0.78, rand(-1.25, 1.25), rand(0, Math.PI * 2), 12, 0.032);
  draw(part(0.78, rand(0.14, 0.22), 0.11), middleLines, middlePads, 0.08);

  const innerLines = newLines();
  const innerPads = newLines();
  for (let i = 0; i < 240; i++) trace(innerLines, innerPads, 0.44, rand(-1.3, 1.3), rand(0, Math.PI * 2), 9, 0.05);
  draw(part(0.44, rand(0.2, 0.32), 0.15), innerLines, innerPads, 0.11);

  // The dial: concentric bars in roughly one plane, inside the shells and around them: some flat and wide, some tall
  // thin walls, some square. None is a whole circle: [radius, width (in and out), height (along the axis), how much of
  // the circle].
  const dial = [
    [0.52, 0.03, 0.03, 0.7],
    [0.6, 0.04, 0.1, 0.55],
    [0.7, 0.12, 0.05, 0.5],
    [0.86, 0.03, 0.06, 0.8],
    [0.94, 0.06, 0.16, 0.6],
    [1.08, 0.2, 0.08, 0.5],
    [1.28, 0.05, 0.22, 0.75],
    [1.38, 0.035, 0.035, 0.45],
  ];
  for (const [r, width, height, span] of dial) {
    const lines = newLines();
    const pads = newLines();
    band(lines, pads, r, width, height, Math.PI * 2 * span);
    const ring = part(r, rand(0.15, 0.5), 0.06, ringAxes);
    ring.rotation.set(rand(-0.25, 0.25), rand(0, Math.PI * 2), rand(-0.25, 0.25));
    draw(ring, lines, pads, 0.15);
  }

  // Halos: a few bands standing across the dial, so the orb reads as a sphere from every side.
  for (const [width, height, span] of [
    [0.04, 0.12, 0.5],
    [0.08, 0.06, 0.65],
    [0.14, 0.1, 0.5],
    [0.05, 0.2, 0.8],
  ]) {
    const lines = newLines();
    const pads = newLines();
    const r = rand(1.1, 1.22);
    band(lines, pads, r, width, height, Math.PI * 2 * span);
    const halo = part(r, rand(0.1, 0.35), 0.05, ringAxes);
    halo.rotation.set(Math.PI / 2 + rand(-0.3, 0.3), rand(0, Math.PI * 2), rand(-0.3, 0.3));
    draw(halo, lines, pads, 0.15);
  }

  // Circuits wired in towards the core, in a few planes: long ones from the middle shell, short ones from the inner shell.
  for (const [from, to, count] of [
    [0.76, 0.12, 26],
    [0.76, 0.12, 20],
    [0.42, 0.09, 24],
    [0.42, 0.09, 18],
  ]) {
    const lines = newLines();
    const pads = newLines();
    spokes(lines, pads, count, from, to);
    const wires = part((from + to) / 2, rand(0.1, 0.3), 0.08, ringAxes);
    wires.rotation.set(rand(-0.6, 0.6), rand(0, Math.PI * 2), rand(-0.6, 0.6));
    draw(wires, lines, pads, 0.2);
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
  for (const [r, width, height] of [
    [0.15, 0.01, 0.01],
    [0.19, 0.02, 0.03],
    [0.25, 0.035, 0.02],
  ]) {
    const lines = newLines();
    const pads = newLines();
    band(lines, pads, r, width, height, Math.PI * 2 * rand(0.55, 0.85));
    const ring = part(r, rand(0.6, 1.4), 0.15, undefined, core);
    ring.rotation.set(rand(0, Math.PI), rand(0, Math.PI * 2), 0);
    draw(ring, lines, pads, 0.9);
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
  if (parts.length !== PARTS) throw new Error(`expected ${PARTS} parts, got ` + parts.length);
  if (!json.nodes.some((node) => node.name === "core")) throw new Error("no core");
  if (!json.nodes.some((node) => node.name === "core-eye")) throw new Error("no core eye");
  console.log(`public/orb.glb ${buf.byteLength} bytes, ${parts.length} parts`);
}

const glb = await new GLTFExporter().parseAsync(build(), { binary: true });
check(glb);
writeFileSync(new URL("../public/orb.glb", import.meta.url), Buffer.from(glb));
