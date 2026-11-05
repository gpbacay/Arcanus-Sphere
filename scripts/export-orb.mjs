// Bakes Arcanus's orb into public/orb.glb. Motion and shaders stay in src/modules/sphere/orb.ts.
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

const newLines = () => ({ pos: [], along: [], seed: [], panel: [] });

/** Tags every vertex added since the last tag with the shell section it belongs to: [outward x, y, z, seed]. */
const mark = (lines, value) => {
  while (lines.panel.length / 4 < lines.pos.length / 3) lines.panel.push(...value);
};

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
// lands on a pad at some corners and at its end. It stops where it would leave its section (`inside`).
function trace(out, pads, r, lat, lon, steps, step, inside) {
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
    const nextLat = lat + Math.sin(a) * step;
    const nextLon = lon + (Math.cos(a) * step) / Math.cos(nextLat);
    if (!inside(nextLat, nextLon)) break;
    lat = nextLat;
    lon = nextLon;
    pts.push(onSphere(lat, lon, r));
    run--;
  }
  if (pts.length < 3) return;
  polyline(out, pts, traceSeed);
  if (random() < 0.45) pad(pads, pts[pts.length - 1], tangents(pts[pts.length - 1]), r * 0.008, traceSeed);
}

const POLE = Math.PI / 2;
const GAP = 0.03; // the seam between two sections, in radians
const MAX_LAT = 1.45; // traces stay off the pole, where longitude pinches

/** A section's edge on a sphere of radius `r`: lat a0..a1, lon b0..b1. A polar cap (`whole`) is only its rim circle. */
function outline(out, r, a0, a1, b0, b1, whole) {
  const arc = (lat, from, to) => {
    const n = Math.max(2, Math.ceil((Math.abs(to - from) * Math.cos(lat)) / 0.04));
    return Array.from({ length: n + 1 }, (_, i) => onSphere(lat, from + ((to - from) * i) / n, r));
  };
  const meridian = (lon, from, to) => {
    const n = Math.max(2, Math.ceil(Math.abs(to - from) / 0.04));
    return Array.from({ length: n + 1 }, (_, i) => onSphere(from + ((to - from) * i) / n, lon, r));
  };
  if (whole) return polyline(out, arc(Math.abs(a0) < Math.abs(a1) ? a0 : a1, b0, b1));
  polyline(out, [...arc(a0, b0, b1), ...meridian(b1, a0, a1).slice(1), ...arc(a1, b1, b0).slice(1), ...meridian(b0, a1, a0).slice(1)]);
}

/**
 * A shell as a layer of separate sections. Each [lat0, lat1, count] band is cut into `count` sections of uneven width
 * (one means a polar cap). Every section is a slab `thick` deep: outlined on its outer and inner face, with posts at its
 * corners, and circuit traces printed on both faces. Its vertices carry its outward direction and a seed, so the shader
 * can raise and sink each section on its own.
 */
function shell(lines, pads, r, thick, bands, traces, steps, step) {
  const area = bands.reduce((sum, [a0, a1]) => sum + (Math.sin(a1) - Math.sin(a0)) * Math.PI * 2, 0);
  for (const [lat0, lat1, count] of bands) {
    const whole = count === 1;
    const weights = Array.from({ length: count }, () => rand(0.65, 1.35));
    const total = weights.reduce((sum, w) => sum + w, 0);
    let lon = rand(0, Math.PI * 2);
    for (const w of weights) {
      const span = (w / total) * Math.PI * 2;
      const a0 = lat0 === -POLE ? lat0 : lat0 + GAP / 2;
      const a1 = lat1 === POLE ? lat1 : lat1 - GAP / 2;
      const mid = (a0 + a1) / 2;
      const seam = whole ? 0 : GAP / 2 / Math.cos(mid);
      const b0 = lon + seam;
      const b1 = lon + span - seam;
      const out = whole ? new THREE.Vector3(0, Math.sign(mid), 0) : onSphere(mid, (b0 + b1) / 2, 1);
      // A polar cap's rim circle and posts go in the bright pad set, so the circle at each pole glows.
      const edges = whole ? pads : lines;
      for (const rr of [r, r - thick]) outline(edges, rr, a0, a1, b0, b1, whole);
      const rim = Math.abs(a0) < Math.abs(a1) ? a0 : a1;
      const corners = whole ? [0, 1, 2, 3].map((i) => [rim, lon + (i * Math.PI) / 2]) : [[a0, b0], [a0, b1], [a1, b0], [a1, b1]];
      for (const [la, ln] of corners) polyline(edges, [onSphere(la, ln, r - thick), onSphere(la, ln, r)]);
      const lo = Math.max(a0, -MAX_LAT);
      const hi = Math.min(a1, MAX_LAT);
      const inside = (la, ln) => la > lo && la < hi && (whole || (ln > b0 && ln < b1));
      const share = ((Math.sin(a1) - Math.sin(a0)) * (b1 - b0)) / area;
      for (let i = 0; i < Math.round(traces * share); i++) {
        trace(lines, pads, random() < 0.75 ? r : r - thick, rand(lo, hi), rand(b0, b1), steps, step, inside);
      }
      const id = random();
      mark(lines, [out.x, out.y, out.z, id]);
      mark(pads, [out.x, out.y, out.z, id]);
      lon += span;
    }
  }
}
/**
 * The northern bands plus their mirror in the south. Only the north pole keeps its round cap: the south pole is cut
 * into `wedges` sections meeting at a point, so each shell has a single circle.
 */
const mirror = (bands, wedges) => [...bands, ...bands.map(([a0, a1, n]) => [-a1, -a0, a1 === POLE ? wedges : n])];

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
// With `slices` above one, the bar is cut into that many pieces with a seam between them, each capped with a rib at both
// ends, and every piece's vertices carry the ring's axis and a seed, so the shader can raise and sink each piece on its own.
// `tag` goes into each slice's seed so the shader knows whose slice it is: 1 an outer ring's, 2 a core ring's.
// A `curve`d ring is a belt instead of a box: its `height` bends round a sphere of radius `r` (as an arc that long), so
// a wide ring still hugs the orb like a band round a ball, and stays in a thin shell of distance from the core.
function band(out, pads, r, width, height, span = Math.PI * 2, h = 0, slices = 1, tag = 1, curve = false) {
  const whole = span >= Math.PI * 2;
  const start = rand(0, Math.PI * 2);
  const seam = slices > 1 ? 0.04 / r : 0; // the same gap in length on every ring, small or large
  // A point of the bar at angle `a` round the ring: `u` is its radius, `v` its height (or, curved, its latitude).
  const at = curve ? (a, u, v) => flat(a, u * Math.cos(v), u * Math.sin(v) + h) : (a, u, v) => flat(a, u, v);
  const tall = curve ? height / r : height; // the cross-section's extent in `v`
  const mid = curve ? 0 : h;
  const rs = Array.from({ length: lanesFor(width) }, (_, i) => r - width / 2 + (width * i) / Math.max(1, lanesFor(width) - 1));
  const hs = Array.from({ length: lanesFor(height) }, (_, i) => mid - tall / 2 + (tall * i) / Math.max(1, lanesFor(height) - 1));
  // The faces, each a list of [u, v] traces: the walls run up the axis, the top and bottom run across.
  const faces = [];
  if (width) faces.push(hs.map((hh) => [rs[0], hh]), hs.map((hh) => [rs[rs.length - 1], hh]));
  if (height) faces.push(rs.map((rr) => [rr, hs[0]]), rs.map((rr) => [rr, hs[hs.length - 1]]));
  if (!faces.length) faces.push([[r, mid]]);
  for (let k = 0; k < slices; k++) {
    // A broken ring's two outer ends are torn; every other end is a clean seam.
    const tornStart = k === 0 && !whole;
    const tornEnd = k === slices - 1 && !whole;
    const from = start + (span * k) / slices + (tornStart ? 0 : seam / 2);
    const to = start + (span * (k + 1)) / slices - (tornEnd ? 0 : seam / 2);
    const seen = new Set();
    for (const face of faces) {
      for (const [rr, hh] of face) {
        const key = rr.toFixed(4) + ":" + hh.toFixed(4);
        if (seen.has(key)) continue; // the corners belong to two faces: trace them once
        seen.add(key);
        let a = tornStart ? from + rand(0, 0.12) : from;
        const until = tornEnd ? to - rand(0, 0.12) : to;
        while (a < until) {
          const len = Math.min(rand(0.3, 1.6), until - a);
          const pts = [];
          for (let t = 0; t <= len; t += 0.03) pts.push(at(a + t, rr, hh));
          if (pts.length > 1) polyline(out, pts);
          a += len + rand(0.03, 0.25);
        }
      }
    }
    // Jumpers: short hops between neighbouring traces of a face, some landing on a pad.
    for (const face of faces) {
      const wall = face.length > 1 && face[0][0] === face[1][0]; // a wall: traces stacked up the axis
      for (let i = 0; i < Math.ceil(((face.length - 1) * 10) / slices); i++) {
        const l = Math.floor(rand(0, face.length - 1));
        const a = rand(from, to);
        const traceSeed = random();
        polyline(out, [at(a, ...face[l]), at(a, ...face[l + 1])], traceSeed);
        if (random() < 0.5) {
          const [radial, around] = flatTangents(a);
          pad(pads, at(a, ...face[random() < 0.5 ? l : l + 1]), [wall ? new THREE.Vector3(0, 1, 0) : radial, around], Math.min(0.008, Math.max(width, height) * 0.1), traceSeed);
        }
      }
    }
    // Ribs: the bar's cross-section, at both ends and along the way.
    if (width && height) {
      const ribs = [from, to];
      for (let a = from + rand(0.08, 0.2); a < to - 0.05; a += rand(0.1, 0.3)) ribs.push(a);
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([du, dv]) => [r + (du * width) / 2, mid + (dv * tall) / 2]);
      for (const a of ribs) {
        // Round the cross-section's edge; a curved one's long sides are bent, so they are drawn in short steps.
        const pts = [at(a, ...corners[0])];
        for (let i = 0; i < 4; i++) {
          const [[u0, v0], [u1, v1]] = [corners[i], corners[i + 1]];
          const n = curve ? Math.max(1, Math.ceil((Math.abs(v1 - v0) * r) / 0.03)) : 1;
          for (let k = 1; k <= n; k++) pts.push(at(a, u0 + ((u1 - u0) * k) / n, v0 + ((v1 - v0) * k) / n));
        }
        polyline(out, pts);
      }
    }
    if (slices > 1) {
      const id = tag + random(); // a seed of 1 or more tells the shader this is a ring slice, not a shell section
      mark(out, [0, 1, 0, id]);
      mark(pads, [0, 1, 0, id]);
    }
  }
}
/** How many pieces a ring of radius `r` covering `span` radians is cut into: about one per 0.3 of its length. */
const slicesFor = (r, span) => Math.max(3, Math.round((r * span) / 0.3));

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
  if (lines.panel.length) {
    if (lines.panel.length / 4 !== lines.pos.length / 3) throw new Error("a shell vertex has no section");
    geometry.setAttribute("panel", new THREE.Float32BufferAttribute(lines.panel, 4));
  }
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

const PARTS = 17;

// How far a shell section (`shell`, outward) or a ring slice (`ring`, along the ring's axis) is ever lifted, as a share
// of its distance from the core. orb.ts reads these from the file and holds the shader to them, and zone() leaves room
// for them, so a lifted section or slice never touches its neighbour.
const REACH = { shell: 0.05, ring: 0.1 };

/** The point of segment a-b nearest the core, and how far it is. */
function nearest(a, b) {
  const ab = b.clone().sub(a);
  const len = ab.lengthSq();
  const t = len ? Math.min(1, Math.max(0, -a.dot(ab) / len)) : 0;
  return a.clone().addScaledVector(ab, t).length();
}

/** How near to and far from the core `obj` ever gets, with its sections or slices lifted as far as they go. */
function extent(obj) {
  let lo = Infinity;
  let hi = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  obj.traverse((o) => {
    if (!o.geometry) return;
    const pos = o.geometry.getAttribute("position");
    const panel = o.geometry.getAttribute("panel");
    const pairs = o.isLineSegments;
    for (let i = 0; i < pos.count; i += pairs ? 2 : 1) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, pairs ? i + 1 : i);
      const far = Math.max(a.length(), b.length());
      const moves = panel && (panel.getX(i) || panel.getY(i) || panel.getZ(i));
      if (moves && panel.getW(i) >= 1) {
        // A ring slice slides along the ring's axis (y): that never brings it nearer than its distance from the axis.
        const flat = (v) => new THREE.Vector3(v.x, 0, v.z);
        lo = Math.min(lo, nearest(flat(a), flat(b)));
        hi = Math.max(hi, Math.hypot(Math.max(flat(a).length(), flat(b).length()), Math.max(Math.abs(a.y), Math.abs(b.y)) + REACH.ring * far));
      } else {
        const lift = moves ? REACH.shell * far : 0;
        lo = Math.min(lo, nearest(a, b) - lift);
        hi = Math.max(hi, far + lift);
      }
    }
  });
  return [lo, hi];
}

/**
 * Every shell, ring and the core keep to their own band of distance from the centre. Since they only ever turn about
 * the centre, bands that don't overlap mean nothing ever passes through anything else, however they turn. This checks
 * that, and tells each body how far it may shrink and grow (`shrink`, `grow`) before it would reach halfway to its
 * neighbour; orb.ts keeps its size changes inside that. The wires run in towards the core through everything, by design.
 */
function zone(scene) {
  const bodies = [];
  scene.traverse((o) => {
    if ((o.userData.part && o.userData.kind !== "wires") || o.name === "core-eye") bodies.push(o);
  });
  const bands = bodies.map((o) => [o, ...extent(o)]).sort((p, q) => p[1] - q[1]);
  const label = (o) => `${o.userData.kind ?? o.name} at ${o.userData.radius ?? 0.07}`;
  bands.forEach(([o, lo, hi], i) => {
    const below = bands[i - 1];
    const above = bands[i + 1];
    if (above && hi >= above[1]) throw new Error(`${label(o)} reaches ${hi.toFixed(3)}, into ${label(above[0])} from ${above[1].toFixed(3)}`);
    o.userData.shrink = below ? (below[2] + lo) / 2 / lo : 0.5;
    o.userData.grow = above ? (hi + above[1]) / 2 / hi : 1.05; // the outermost stays clear of the studio's floor grid
    console.log(`${label(o).padEnd(16)} ${lo.toFixed(3)}..${hi.toFixed(3)}  size ${o.userData.shrink.toFixed(3)}..${o.userData.grow.toFixed(3)}`);
  });
}

function build() {
  const scene = new THREE.Scene();
  scene.name = "orb";
  scene.userData = { reach: REACH };
  // kind: "shell" and "core" beat like a heart; "ring" blinks and ticks like clockwork; "wires" just turn.
  const part = (kind, radius, spin, size, axes = [1, 1, 1], parent = scene) => {
    const g = new THREE.Group();
    g.name = "part";
    g.userData = { part: true, kind, radius, spin, size, axes };
    parent.add(g);
    return g;
  };
  const ringAxes = [0.35, 1, 0.35];

  // Three whole shells of circuitry, each a layer of separate thick sections.
  const outerLines = newLines();
  const outerPads = newLines();
  shell(outerLines, outerPads, 1, 0.045, mirror([[0, 0.42, 16], [0.42, 0.84, 13], [0.84, 1.22, 8], [1.22, POLE, 1]], 6), 440, 16, 0.028);
  draw(part("shell", 1, rand(0.08, 0.14), 0.07), outerLines, outerPads, 0.17);

  const middleLines = newLines();
  const middlePads = newLines();
  shell(middleLines, middlePads, 0.78, 0.04, mirror([[0, 0.45, 13], [0.45, 0.9, 10], [0.9, 1.3, 6], [1.3, POLE, 1]], 5), 380, 12, 0.032);
  draw(part("shell", 0.78, rand(0.14, 0.22), 0.11), middleLines, middlePads, 0.11);

  const innerLines = newLines();
  const innerPads = newLines();
  shell(innerLines, innerPads, 0.44, 0.035, mirror([[0, 0.4, 8], [0.4, 1.1, 5], [1.1, POLE, 1]], 4), 240, 9, 0.05);
  draw(part("shell", 0.44, rand(0.2, 0.32), 0.15), innerLines, innerPads, 0.15);

  // The rings, each in a band of its own (see zone()): two between the inner and middle shells, four outside the outer
  // shell. Dial rings lie roughly in one plane; halos stand across them, so the orb reads as a sphere from every side.
  // The inner rings are narrow boxes, to fit between the shells. The outer ones are wide curved belts that hug the orb
  // like bands round a ball, each wider than the one within it: their width bends round the sphere, so it costs almost
  // no room between bands. None is a whole circle: [radius, thickness (in and out), width (along the axis), how much of
  // the circle, halo, curved].
  const rings = [
    [0.53, 0.04, 0.06, 0.7, false, false],
    [0.63, 0.04, 0.1, 0.55, true, false],
    [1.12, 0.03, 0.2, 0.5, false, true],
    [1.25, 0.03, 0.24, 0.65, true, true],
    [1.38, 0.03, 0.28, 0.75, false, true],
    [1.51, 0.035, 0.32, 0.6, true, true],
  ];
  for (const [r, width, height, span, halo, curve] of rings) {
    const lines = newLines();
    const pads = newLines();
    band(lines, pads, r, width, height, Math.PI * 2 * span, 0, slicesFor(r, Math.PI * 2 * span), 1, curve);
    const ring = part("ring", r, rand(0.15, 0.5), 0.06, ringAxes);
    const tilt = halo ? 0.3 : 0.25;
    ring.rotation.set((halo ? Math.PI / 2 : 0) + rand(-tilt, tilt), rand(0, Math.PI * 2), rand(-tilt, tilt));
    draw(ring, lines, pads, 0.15);
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
    const wires = part("wires", (from + to) / 2, rand(0.1, 0.3), 0.08, ringAxes);
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
  part("core", 0.11, rand(0.3, 0.5), 0.1, undefined, core).add(segments(cageLines, 0.7));
  for (const [r, width, height] of [
    [0.15, 0.02, 0.02],
    [0.2, 0.025, 0.03],
    [0.27, 0.035, 0.025],
  ]) {
    const lines = newLines();
    const pads = newLines();
    const span = Math.PI * 2 * rand(0.55, 0.85);
    band(lines, pads, r, width, height, span, 0, slicesFor(r, span), 2); // core ring slices beat with the core
    const ring = part("core", r, rand(0.6, 1.4), 0.15, undefined, core);
    ring.rotation.set(rand(0, Math.PI), rand(0, Math.PI * 2), 0);
    draw(ring, lines, pads, 0.9);
  }
  zone(scene);
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
  if (!names.includes("_PANEL")) throw new Error("shell sections missing");
  const parts = json.nodes.filter((node) => node.extras?.part);
  if (parts.length !== PARTS) throw new Error(`expected ${PARTS} parts, got ` + parts.length);
  if (!json.nodes.some((node) => node.name === "core")) throw new Error("no core");
  if (!json.nodes.some((node) => node.name === "core-eye")) throw new Error("no core eye");
  if (!json.scenes[0].extras?.reach) throw new Error("no reach on the scene");
  if (!parts.every((node) => node.extras.kind === "wires" || node.extras.grow > 1)) throw new Error("a part has no room to move");
  console.log(`public/orb.glb ${buf.byteLength} bytes, ${parts.length} parts`);
}

const glb = await new GLTFExporter().parseAsync(build(), { binary: true });
check(glb);
writeFileSync(new URL("../public/orb.glb", import.meta.url), Buffer.from(glb));
