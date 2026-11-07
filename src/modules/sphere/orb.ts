import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * Arcanus's body: a holographic orb of gold circuit traces on three nested shells, loose broken rings and a 3D core.
 * Each shell is a layer of separate thick sections, and every ring is a solid bar with a box cross-section, cut into
 * slices. Shell sections rise and sink along their outward direction, ring slices along the ring's axis, so a ring
 * stays a ring while its pieces step up and down.
 * The shape is public/orb.glb. Each frame the CPU only turns and resizes the parts; the GPU raises and sinks each shell
 * section and ring slice on its own.
 * Every shell and every ring is its own part: it turns on its own axes at its own speed, drifting in pace and direction
 * so no two move alike. Nothing ever passes through anything else: each part keeps to its own band of distance from
 * the core (laid out and checked by scripts/export-orb.mjs), and every lift and size change here stays inside it.
 * - Idle: faint pulses run along the traces, and the orb has two rhythms.
 *   The core and the shells beat like a resting heart, lub-dub about 55 times a minute: on every beat some shell
 *   sections spring up while others drop, the core rings ripple, and the core and shells swell a touch.
 *   The outer rings tick round like clockwork, in small quick steps, and every few seconds, at random, they blink like
 *   eyes: their slices snap up or down and back, and a ring or two may swing back the other way, swell or shrink.
 * - Thinking (`boost`): the parts turn faster, with a small flutter in size.
 * - Speaking (`analyser`): swells roll across the shells and round the rings in waves that keep changing direction, the
 *   sections rising well past their idle beat, louder voice higher; the core jumps like a mouth.
 *
 * This file is the orb alone, with no renderer: the studio (SphereScene) and the AR view (ar.ts) each add `root`
 * to their own three.js scene and call `update(dt)` once per frame.
 */
export type Orb = {
  /** Add this to a scene. The studio and AR views wrap it in their own group to move, turn and resize the orb. */
  root: THREE.Object3D;
  update: (dt: number) => void;
  dispose: () => void;
};

export type OrbInputs = {
  /** The voice analyser while Arcanus speaks, else null. */
  analyser?: () => AnalyserNode | null;
  /** 0..1: how busy Arcanus is while there is no audio yet (thinking). */
  boost?: () => number;
  /** Whether Arcanus is switched on. Flipping it plays the boot-up or shutdown animation. Defaults to always on. */
  on?: () => boolean;
};

/** Bloom the studio composites over the orb. AR uses the same numbers so the two views stay one look. */
// Kept low and tight with a high threshold: only pads and pulses bloom, so the traces stay crisp instead of a haze.
export const ORB_BLOOM = { strength: 0.28, radius: 0.15, threshold: 0.25 } as const;

const GOLD = new THREE.Color("#ff9a2e");
const HOT = new THREE.Color("#fff1c9");
const rand = (a: number, b: number) => a + Math.random() * (b - a);

// ------------------------------------------------------------------ shaders

// Everything that depends only on a trace's seed (twinkle, where its pulse is, whether and where it fires) is worked out
// once per vertex here, not once per pixel. Both ends of a segment share a seed, so the values interpolate unchanged.
const LINE_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uPhase;
  uniform float uTalk;
  uniform float uBoost;
  uniform float uLift;
  uniform vec2 uReach; // the furthest a shell section (x) or ring slice (y) ever moves, as a share of its distance
  uniform vec4 uBeat; // xyz: the side the shell sections lift toward, w: how strong the heartbeat is (0 when busy)
  uniform float uBeatAge; // seconds since the last heartbeat began at the very centre
  uniform float uWave; // seconds the heartbeat takes to travel one unit out from the centre
  uniform float uScatter; // 0: one side of a shell rises and the other sinks; 1: scattered sections rise, others sink
  uniform float uBeatSeed;
  uniform float uBlink; // the outer rings' blink, 0..1
  uniform float uBlinkSeed;
  attribute float along;
  attribute float seed;
  #ifdef PANELS
  attribute vec4 panel; // the shell section or ring slice this vertex belongs to: the way it moves, and a seed
  #endif
  varying float vAlong;
  varying float vTwinkle;
  varying float vHead;
  varying float vTip;
  varying float vFire;
  varying float vRaise;
  float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
  // Smooth random in [-1, 1]: a new level every whole step of x, eased into from the last one.
  float wander(float x, float id) {
    float i = floor(x);
    return mix(hash(i + id), hash(i + 1.0 + id), smoothstep(0.0, 1.0, x - i)) * 2.0 - 1.0;
  }
  // A pulse over 0..1: a quick rise, then a slower fall; 0 outside. Matches bump() in orb.ts.
  float bump(float x) { return x < 0.3 ? smoothstep(0.0, 0.3, x) : 1.0 - smoothstep(0.3, 1.0, x); }
  // Lub-dub, \`age\` seconds after the beat reached this point. Matches heartAt() in orb.ts.
  float heart(float age) { return bump(age / 0.22) + 0.6 * bump((age - 0.28) / 0.2); }
  void main() {
    vec3 p = position;
    vRaise = 0.0;
    #ifdef PANELS
    // Every shell section and ring slice rises and sinks on its own, each at its own pace. Thinking: a restless wander.
    // Talking: quick, uneven jumps, as if it were speaking. Idle, the shells and core beat like a heart (a slow breath
    // between beats), while the outer rings blink like eyes.
    float kind = floor(panel.w); // 0: shell section, 1: outer ring slice, 2: core ring slice
    float id = panel.w * 97.0;
    float beats = kind == 1.0 ? 0.0 : 1.0;
    float breathe = sin(uTime * (0.35 + hash(id) * 1.1) + hash(id + 1.0) * 6.28) * beats;
    float think = wander(uTime * (1.2 + hash(id + 2.0) * 2.0), id + 3.0);
    float speak = wander(uTime * (4.0 + hash(id + 4.0) * 10.0), id + 5.0);
    // A heartbeat: on each pulse some sections spring up while others drop. Core ring slices pick at random, so the
    // ring ripples around its circle.
    float side = clamp(dot(panel.xyz, uBeat.xyz) * 2.0, -1.0, 1.0);
    float pick = hash(id + uBeatSeed);
    float scattered = pick > 0.66 ? 1.0 : (pick < 0.33 ? -1.0 : 0.0);
    // The beat travels out from the centre like a wave: the further out, the later it arrives, and within a shell it
    // reaches the sections on the beat's side first, each a touch early or late.
    float arrive = length(position) * uWave + (0.5 - 0.5 * dot(panel.xyz, uBeat.xyz)) * 0.1 + hash(id + 6.0) * 0.05;
    float beat = (kind == 0.0 ? mix(side, scattered, uScatter) : scattered) * heart(uBeatAge - arrive) * uBeat.w * beats;
    // A blink: every slice of an outer ring snaps up or down and back, quick as an eyelid.
    float blink = (hash(id + uBlinkSeed) > 0.5 ? 1.0 : -1.0) * uBlink * (1.0 - beats);
    // Talking: swells roll across each shell and round each ring like waves, in directions that keep wandering, every
    // section a touch early or late, so it never repeats. It leans outward, so the orb visibly grows with the voice.
    vec3 n = kind == 0.0 ? panel.xyz : normalize(vec3(position.x, 0.0, position.z) + 0.0001); // where round the ring
    vec3 d1 = normalize(vec3(wander(uTime * 1.3, 11.0), wander(uTime * 1.3, 23.0), wander(uTime * 1.3, 37.0)) + 0.0001);
    vec3 d2 = normalize(vec3(wander(uTime * 0.9, 41.0), wander(uTime * 0.9, 53.0), wander(uTime * 0.9, 67.0)) + 0.0001);
    float wave = 0.6 * sin(dot(n, d1) * 4.0 - uTime * 18.0 + hash(id + 7.0) * 1.2)
               + 0.4 * sin(dot(n, d2) * 2.5 - uTime * 11.0 + hash(id + 8.0) * 1.2);
    float talking = 0.3 + 0.7 * wave + 0.3 * speak;
    // The idle moves keep their old size: the reach was raised (export-orb.mjs) only to give talking more room.
    float idle = kind == 0.0 ? 0.05 / uReach.x : 0.1 / uReach.y;
    float raw = (breathe * 0.2 + think * 0.35 * uBoost + beat * 0.6 + blink * 0.8) * idle + talking * uTalk;
    // Held to the reach the orb was laid out for, so a lifted section or slice never touches its neighbour.
    vRaise = clamp(raw, -1.0, 1.0) * (kind == 0.0 ? uReach.x : uReach.y) * uLift;
    p += panel.xyz * vRaise * length(position);
    #endif
    vAlong = along;
    vTwinkle = 0.65 + 0.35 * sin(uTime * (1.0 + seed * 2.5) + seed * 50.0);
    // A pulse of light runs down each trace, each at its own pace.
    vHead = fract(uPhase * (0.6 + seed * 0.8) + seed * 7.0);
    // On top of that glow, neurons: now and then, at random, a trace fires. A sharp spike of light runs down it and
    // dies out, then it is quiet again until its next turn. Talking and thinking (uPhase) fire them faster.
    float cycle = (uTime * 0.3 + uPhase * 1.5) * (0.6 + seed * 0.8) + seed * 31.0;
    float fires = step(0.86, hash(floor(cycle) + seed * 57.0)); // about one turn in seven
    float t = fract(cycle) / 0.3; // the spike runs down the trace in the first part of the turn
    vTip = t * 1.25 - 0.1;
    vFire = fires * step(t, 1.0) * (1.0 - smoothstep(0.6, 1.0, t));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const LINE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHot;
  uniform float uFlow;
  uniform float uBase;
  uniform float uPower;
  varying float vAlong;
  varying float vTwinkle;
  varying float vHead;
  varying float vTip;
  varying float vFire;
  varying float vRaise;
  void main() {
    float pulse = smoothstep(0.15, 0.0, abs(vAlong - vHead)) * uFlow;
    float spike = 0.0;
    if (vFire > 0.0) {
      float behind = vTip - vAlong;
      spike = (behind >= 0.0 ? exp(-behind * 14.0) : exp(behind * 45.0)) * vFire;
    }
    // Thousands of lines overlap, so brightness is only ever this line's own base, scaled.
    // A raised shell section catches more light, a sunken one less.
    float glow = uBase * (vTwinkle + pulse * 4.0 + spike * 5.0) * uPower * (1.0 + vRaise * 6.0);
    vec3 color = mix(uColor, uHot, clamp(pulse * 0.6 + spike, 0.0, 1.0));
    gl_FragColor = vec4(color * glow, 1.0);
  }
`;

// A shaded sphere for the core: brightest face-on, deeper gold toward the rim, so it reads as a ball, not a disc.
const CORE_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CORE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHot;
  uniform float uGlow;
  varying vec3 vNormal;
  void main() {
    float f = pow(clamp(vNormal.z, 0.0, 1.0), 1.4);
    gl_FragColor = vec4(mix(uColor, uHot, f) * (0.5 + 0.9 * f) * uGlow, 1.0);
  }
`;

// ------------------------------------------------------------------ component

/**
 * A twitch: a random target in [-1, 1] picked anew every 30 to 90 ms and chased almost at once, so the value jumps
 * from one level to another instead of gliding like a sine wave would.
 */
type Twitch = { target: number; value: number; next: number };
const twitch = (): Twitch => ({ target: 0, value: 0, next: 0 });
const tick = (w: Twitch, t: number, snap: number) => {
  if (t >= w.next) {
    w.target = rand(-1, 1);
    w.next = t + rand(0.03, 0.09);
  }
  return (w.value += (w.target - w.value) * snap);
};

/**
 * One part that moves on its own. It turns about its axes at `spin` rad/s, each axis drifting in pace and sometimes
 * reversing (`rate` swings through zero). While Arcanus talks its size twitches by up to `size`; its turn keeps pace.
 * `axes` weights how much it turns about x, y and z: a ring mostly spins in its own plane.
 * `jitter` (from its distance to the core) scales that twitch: the core quivers most, the far shells least.
 */
type Kind = "shell" | "ring" | "core" | "wires";

type Mover = {
  obj: THREE.Object3D;
  kind: Kind;
  /** How far it may shrink and grow before it would reach halfway to its neighbour (baked by export-orb.mjs). */
  shrink: number;
  grow: number;
  spin: number;
  axes: [number, number, number];
  drift: number[];
  phase: number[];
  bias: number[];
  size: number;
  jitter: number;
  /** Boot-up and shutdown: the orb comes on from the core outward, so the farther the part, the later it starts. */
  delay: number;
  radius: number;
  twitch: Twitch;
  // Clockwork: an idle outer ring holds still and moves in small quick steps instead of turning smoothly, every
  // `period` seconds or so. `want` is where its smooth turn has got to, `held` the last step, `shown` what is drawn.
  period: number;
  nextTick: number;
  ready: boolean;
  want: number[];
  held: number[];
  shown: number[];
  // A gesture on a blink: for `actLen` seconds from `actStart`, it swings back the other way, swells or shrinks.
  act: "turn" | "grow" | "shrink";
  actStart: number;
  actLen: number;
};

// Full jitter at the core, fading with distance to 12% at the outermost rings (radius ~1.45).
// ponytail: linear falloff; tune the 1.5 / 1.3 if the shells read too still or too busy.
const jitterAt = (radius: number) => Math.min(1, Math.max(0.12, (1.5 - radius) / 1.3));

type PartData = { kind: Kind; radius: number; spin: number; size: number; axes?: [number, number, number]; shrink?: number; grow?: number };

const mover = (obj: THREE.Object3D, { kind, radius, spin, size, axes = [1, 1, 1], shrink = 0.5, grow = 1.5 }: PartData): Mover => ({
  obj,
  kind,
  shrink,
  grow,
  spin,
  axes,
  drift: [rand(0.05, 0.35), rand(0.05, 0.35), rand(0.05, 0.35)],
  phase: [rand(0, 6.3), rand(0, 6.3), rand(0, 6.3)],
  bias: [rand(-0.7, 0.7), rand(-0.7, 0.7), rand(-0.7, 0.7)],
  size,
  jitter: jitterAt(radius),
  delay: Math.min(1, radius / 1.45) * 0.5,
  radius,
  twitch: twitch(),
  period: rand(0.3, 1.1),
  nextTick: 0,
  ready: false,
  want: [0, 0, 0],
  held: [0, 0, 0],
  shown: [0, 0, 0],
  act: "turn",
  actStart: 0,
  actLen: 0,
});

const ACTS = ["turn", "grow", "shrink"] as const;
const BEAT = 60 / 55; // seconds between heartbeats: a calm resting pulse, about 55 a minute
// Seconds a heartbeat takes to travel one unit out from the centre: the eye beats first, then the core, then each shell
// in turn. Keep WAVE * 1.05 + 0.15 (the outer shell's latest start) + 0.48 (one lub-dub) under BEAT * 0.92.
const WAVE = 0.3;

const BOOT = 1.0; // seconds from dark to fully on
const SHUT = 0.7; // seconds from fully on to dark
const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
/**
 * A size change `dev` (0 is as baked) squeezed softly into [shrink - 1, grow - 1]: small changes pass as they are,
 * big ones flatten out before the part would reach its neighbour.
 */
const within = (dev: number, shrink: number, grow: number) => {
  const room = dev > 0 ? grow - 1 : 1 - shrink;
  return room > 0 ? room * Math.tanh(dev / room) : 0;
};
/** The shape of a pulse over `len` seconds from `start`: a quick rise to 1, then a slower fall back to 0. */
const bump = (t: number, start: number, len: number) => {
  const x = len ? (t - start) / len : 1;
  if (x <= 0 || x >= 1) return 0;
  return x < 0.3 ? smooth(x / 0.3) : 1 - smooth((x - 0.3) / 0.7);
};

const disposeDraw = (object: THREE.Object3D) => {
  if (object instanceof THREE.LineSegments || object instanceof THREE.Mesh) {
    object.geometry.dispose();
    (object.material as THREE.Material).dispose();
  }
};

/** The file stores the shells, rings, and core. These shaders and the mover loop are what make it Arcanus. */
export async function loadOrb({ analyser = () => null, boost: boostIn = () => 0, on = () => true }: OrbInputs = {}): Promise<Orb> {
  const gltf = await new GLTFLoader().loadAsync("/orb.glb");
  // Shared uniforms: every material reads the same objects, so one write per frame drives them all.
  const shared = {
    uColor: { value: GOLD },
    uHot: { value: HOT },
    uTime: { value: 0 },
    uPhase: { value: 0 },
    uFlow: { value: 0.35 },
    uPower: { value: 0 },
    uTalk: { value: 0 },
    uBoost: { value: 0 },
    uLift: { value: 1 },
    uReach: { value: new THREE.Vector2() },
    uBeat: { value: new THREE.Vector4() },
    uBeatAge: { value: 10 },
    uWave: { value: WAVE },
    uScatter: { value: 0 },
    uBeatSeed: { value: 0 },
    uBlink: { value: 0 },
    uBlinkSeed: { value: 0 },
  };
  const reach = (gltf.scene.userData as { reach?: { shell: number; ring: number } }).reach;
  if (!reach) throw new Error("orb.glb has no reach: re-run npm run orb");
  shared.uReach.value.set(reach.shell, reach.ring);
  // Heartbeat (the core and shells): lub-dub, like a resting heart. Blinks (the outer rings): every few seconds at
  // random, now and then twice in a row, like eyes.
  let nextBeat = 1;
  let beatAt = -10;
  let nextBlink = rand(2, 4);
  let blinkAt = -10;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const motion = reduced ? 0.25 : 1;
  shared.uLift.value = motion;
  const spectrum = new Uint8Array(256);
  const ease = (from: number, to: number, attack: number, release: number) => from + (to - from) * (to > from ? attack : release);
  let talk = 0;
  let boost = 0;
  let flick = 1; // lightbulb: held for a few tens of ms, then re-rolled
  let nextFlick = 0;
  let power = 0; // 0 is dark, 1 is fully on; it moves toward the switch at BOOT / SHUT speed
  const coreTwitch = twitch();

  const movers: Mover[] = [];
  const coreGlow = { value: 1 };
  gltf.scene.traverse((obj) => {
    const data = obj.userData as Partial<PartData> & { part?: boolean; base?: number };
    if (data.part) movers.push(mover(obj, data as PartData));
    if (obj instanceof THREE.LineSegments) {
      const along = obj.geometry.getAttribute("_along");
      const seed = obj.geometry.getAttribute("_seed");
      const panel = obj.geometry.getAttribute("_panel");
      if (along) obj.geometry.setAttribute("along", along);
      if (seed) obj.geometry.setAttribute("seed", seed);
      if (panel) obj.geometry.setAttribute("panel", panel);
      // Raised sections reach past the baked bounds.
      if (panel) obj.frustumCulled = false;
      (obj.material as THREE.Material).dispose();
      obj.material = new THREE.ShaderMaterial({
        defines: panel ? { PANELS: "" } : {},
        // ponytail: one global dimmer for the denser sliced shells; tune 0.8 (or the baked bases) if it reads too dark.
        uniforms: { ...shared, uBase: { value: (data.base ?? 0.13) * 0.8 } },
        vertexShader: LINE_VERTEX,
        fragmentShader: LINE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
    }
    if (obj.name === "core-eye" && obj instanceof THREE.Mesh) {
      (obj.material as THREE.Material).dispose();
      obj.material = new THREE.ShaderMaterial({
        uniforms: { ...shared, uGlow: coreGlow },
        vertexShader: CORE_VERTEX,
        fragmentShader: CORE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
    }
  });
  const core = gltf.scene.getObjectByName("core");
  const mouth = gltf.scene.getObjectByName("core-eye");
  if (!core || !mouth || movers.length === 0) throw new Error("orb.glb is missing the orb parts");
  const { shrink: mouthShrink = 0.5, grow: mouthGrow = 1.25 } = mouth.userData as { shrink?: number; grow?: number };

  const update = (dt: number) => {
    // Power: ramp toward the switch. Fully dark costs nothing: nothing is drawn or moved.
    const goal = on() ? 1 : 0;
    power = goal > power ? Math.min(goal, power + dt / BOOT) : Math.max(goal, power - dt / SHUT);
    gltf.scene.visible = power > 0;
    if (power === 0) return;
    // Lightbulb: while the power is changing the light stutters on and off, more often on the nearer it is to full.
    // The same dice run both ways, so it sputters into life and sputters out.
    if (power < 1 && shared.uTime.value >= nextFlick) {
      nextFlick = shared.uTime.value + rand(0.025, 0.07);
      flick = Math.random() < smooth((power - 0.1) / 0.8) ? 1 : 0.12;
    } else if (power === 1) flick = 1;
    shared.uPower.value = smooth(power / 0.6) * flick;
    // While changing, everything whirls: fastest halfway through, calm at both ends.
    const whirl = 1 + 24 * power * (1 - power);
    const t = (shared.uTime.value += dt);

    // Voice: the overall level over the speech range says whether Arcanus is talking.
    const live = analyser();
    let level = 0;
    if (live) {
      live.getByteFrequencyData(spectrum);
      for (let i = 1; i < 40; i++) level += spectrum[i];
      level /= 39 * 255;
    }
    talk = ease(talk, Math.min(1, Math.max(0, (level - 0.1) * 2.5)), 0.7, 0.3);
    boost = ease(boost, boostIn(), 0.05, 0.05);

    const busy = Math.max(talk, boost);
    shared.uFlow.value = 0.35 + 0.15 * busy;
    shared.uPhase.value += dt * (0.15 + boost * 0.3 + talk * 0.8);
    shared.uTalk.value = talk;
    shared.uBoost.value = boost;

    // Both idle rhythms fade out while Arcanus thinks or talks.
    const calm = (1 - smooth(busy / 0.3)) * power;
    if (t >= nextBeat) {
      // A new beat: a fresh pick of which sections and slices rise and which drop.
      beatAt = t;
      nextBeat = t + BEAT * rand(0.92, 1.08);
      const axis = new THREE.Vector3().randomDirection();
      shared.uBeat.value.set(axis.x, axis.y, axis.z, 0);
      shared.uScatter.value = Math.random() < 0.5 ? 1 : 0;
      shared.uBeatSeed.value = rand(0, 100);
    }
    // Lub-dub: a strong pulse, then a softer one right after, reaching each part `delay` seconds after the centre.
    const heartAt = (delay: number) => (bump(t, beatAt + delay, 0.22) + 0.6 * bump(t, beatAt + delay + 0.28, 0.2)) * calm;
    const pulse = heartAt(0); // the eye, at the very centre, beats first
    shared.uBeat.value.w = calm;
    shared.uBeatAge.value = t - beatAt;
    if (t >= nextBlink) {
      blinkAt = t;
      nextBlink = t + (Math.random() < 0.2 ? 0.4 : rand(2.5, 7)); // now and then a double blink
      shared.uBlinkSeed.value = rand(0, 100);
      // Now and then a blink also sets a ring or two off on a gesture.
      if (busy < 0.15 && power === 1 && Math.random() < 0.5) {
        const rings = movers.filter((m) => m.kind === "ring");
        for (let n = Math.floor(rand(1, 3)); n > 0; n--) {
          const m = rings[Math.floor(Math.random() * rings.length)];
          m.act = ACTS[Math.floor(Math.random() * ACTS.length)];
          m.actStart = t;
          m.actLen = rand(0.5, 1.2);
        }
      }
    }
    shared.uBlink.value = bump(t, blinkAt, 0.25) * calm;

    // Each part: its own drifting turn and a twitching size. Talking never speeds the turn up: the parts only swell
    // and shrink with the voice, like a mouth. Thinking flutters a little and slowly: the twitch is smoothed harder for it.
    const pace = (1 + boost * 2.5) * whirl * motion * dt;
    // Talking mostly moves the sections in waves (the shader), so whole parts only twitch a little, not all at once.
    const flutter = Math.max(talk * 0.4, boost * 0.35) * motion;
    const snap = 1 - Math.exp(-dt * (boost > talk ? 12 : 45));
    const tickSnap = 1 - Math.exp(-dt * 30);
    for (const m of movers) {
      const { rotation } = m.obj;
      // Far parts also follow their turn more softly, which smooths what shake is left.
      const easeSnap = 1 - Math.exp(-dt * (busy > 0.15 ? 10 + 30 * m.jitter : 10));
      if (!m.ready) {
        m.want = [rotation.x, rotation.y, rotation.z];
        m.held = [...m.want];
        m.shown = [...m.want];
        m.ready = true;
      }
      // A gesture, if this part is in one: swing back the other way (fast), or swell, or shrink.
      const act = bump(t, m.actStart, m.actLen) * motion;
      const turn = m.act === "turn" ? 1 - 6 * act : 1;
      const swell = m.act === "grow" ? 1 + 0.15 * act : m.act === "shrink" ? 1 - 0.15 * act : 1;
      // Each part keeps turning smoothly in `want`; it is drawn from there, or stepped in clockwork fashion.
      for (let i = 0; i < 3; i++) {
        m.want[i] += turn * pace * m.spin * m.axes[i] * (Math.sin(t * m.drift[i] + m.phase[i]) + m.bias[i]);
      }
      const clockwork = m.kind === "ring" && busy < 0.15 && motion === 1 && act === 0;
      if (clockwork && t >= m.nextTick) {
        m.nextTick = t + m.period * rand(0.85, 1.15);
        // A tick: catch up with the smooth turn in one quick step, with a small mechanical shiver.
        for (let i = 0; i < 3; i++) m.held[i] = m.want[i] + (Math.random() - 0.5) * 0.015 * m.axes[i];
      }
      const k = clockwork ? tickSnap : easeSnap;
      for (let i = 0; i < 3; i++) m.shown[i] += ((clockwork ? m.held[i] : m.want[i]) - m.shown[i]) * k;
      rotation.set(m.shown[0], m.shown[1], m.shown[2]);
      // Each part grows out of the core as the power comes up, and falls back into it as it goes down.
      const grown = Math.max(0.001, smooth((power - m.delay) / 0.5));
      // The core and shells swell a touch on each heartbeat; the rings don't beat.
      const heart = m.kind === "shell" || m.kind === "core" ? 1 + 0.03 * heartAt(m.radius * WAVE) * motion : 1;
      // While talking the far rings and shells swell too, not just the parts near the core.
      const reach = m.jitter + (1 - m.jitter) * talk * 0.6;
      const size = (1 + flutter * m.size * reach * tick(m.twitch, t, snap)) * swell * heart;
      m.obj.scale.setScalar((1 + within(size - 1, m.shrink, m.grow)) * grown);
    }

    // The core is the mouth: while talking its size twitches between small and large in quick jumps, and it glows a
    // little brighter when large.
    const jump = tick(coreTwitch, t, snap);
    // The core is first to light and last to go out, and it flickers with the rest.
    const lit = smooth(power / 0.3);
    // Only the eye itself jumps, inside the cage, so it never breaks through it.
    mouth.scale.setScalar(1 + within(((talk * 0.7 + boost * 0.12) * jump + 0.12 * pulse) * motion, mouthShrink, mouthGrow));
    core.scale.setScalar(0.3 + 0.7 * lit);
    coreGlow.value = (1 + 0.25 * talk * (0.5 + 0.5 * jump) + 0.35 * pulse) * lit * flick;
  };

  return { root: gltf.scene, update, dispose: () => gltf.scene.traverse(disposeDraw) };
}
