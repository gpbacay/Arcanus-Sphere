import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * Arcanus's body: a holographic orb of gold circuit traces on three nested shells, loose broken rings and a 3D core.
 * The shape is public/orb.glb. Each frame the CPU only turns and resizes the parts.
 * Every shell and every ring is its own part: it turns on its own axes at its own speed, drifting in pace and direction
 * so no two move alike.
 * - Idle: the parts drift slowly and faint pulses run along the traces. Now and then, a few parts at random hold still
 *   and tick forward in small quick steps, like clockwork, then go back to turning smoothly.
 * - Thinking (`boost`): the parts turn faster, with a small flutter in size.
 * - Speaking (`analyser`): everything whirls several times faster and shakes, and the shells, rings and core each
 *   twitch in size at their own random moments, as if the orb were talking. The brightness stays the same.
 *
 * This file is the orb alone, with no renderer: the studio (SphereScene) and the AR view (ArScene) each add `root`
 * to their own three.js scene and call `update(dt)` once per frame.
 */
export type Orb = {
  /** Add this to a scene. The studio and AR views wrap it in their own group to move, turn and resize the orb. */
  root: THREE.Object3D;
  update: (dt: number) => void;
  /** Go dark and play the boot-up animation again, as if Arcanus had just been switched on. */
  reboot: () => void;
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
export const ORB_BLOOM = { strength: 0.55, radius: 0.35, threshold: 0.08 } as const;

const GOLD = new THREE.Color("#ff9a2e");
const HOT = new THREE.Color("#fff1c9");
const rand = (a: number, b: number) => a + Math.random() * (b - a);

// ------------------------------------------------------------------ shaders

// Everything that depends only on a trace's seed (twinkle, where its pulse is, whether and where it fires) is worked out
// once per vertex here, not once per pixel. Both ends of a segment share a seed, so the values interpolate unchanged.
const LINE_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uPhase;
  attribute float along;
  attribute float seed;
  varying float vAlong;
  varying float vTwinkle;
  varying float vHead;
  varying float vTip;
  varying float vFire;
  float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
  void main() {
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
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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
  void main() {
    float pulse = smoothstep(0.15, 0.0, abs(vAlong - vHead)) * uFlow;
    float spike = 0.0;
    if (vFire > 0.0) {
      float behind = vTip - vAlong;
      spike = (behind >= 0.0 ? exp(-behind * 14.0) : exp(behind * 45.0)) * vFire;
    }
    // Thousands of lines overlap, so brightness is only ever this line's own base, scaled.
    float glow = uBase * (vTwinkle + pulse * 4.0 + spike * 5.0) * uPower;
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

/** At most this many parts tick like clockwork at once while idle, so it stays "some", never "all". */
const MAX_TICKING = 5;

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
 * reversing (`rate` swings through zero). While Arcanus talks it also shakes and its size twitches by up to `size`.
 * `axes` weights how much it turns about x, y and z: a ring mostly spins in its own plane.
 * `jitter` (from its distance to the core) scales that shake and twitch: the core quivers, the far shells stay calm.
 */
type Mover = {
  obj: THREE.Object3D;
  spin: number;
  axes: [number, number, number];
  drift: number[];
  phase: number[];
  bias: number[];
  size: number;
  jitter: number;
  /** Boot-up and shutdown: the orb comes on from the core outward, so the farther the part, the later it starts. */
  delay: number;
  twitch: Twitch;
  // Clockwork: for stretches at random, an idle part holds still and moves in small quick steps instead of turning
  // smoothly. `want` is where its smooth turn has got to, `held` the last step, `shown` what is drawn.
  ticking: boolean;
  until: number;
  period: number;
  nextTick: number;
  ready: boolean;
  want: number[];
  held: number[];
  shown: number[];
};

// Full jitter at the core, fading with distance to 12% at the outermost rings (radius ~1.45).
// ponytail: linear falloff; tune the 1.5 / 1.3 if the shells read too still or too busy.
const jitterAt = (radius: number) => Math.min(1, Math.max(0.12, (1.5 - radius) / 1.3));

const mover = (obj: THREE.Object3D, radius: number, spin: number, size: number, axes: [number, number, number] = [1, 1, 1]): Mover => ({
  obj,
  spin,
  axes,
  drift: [rand(0.05, 0.35), rand(0.05, 0.35), rand(0.05, 0.35)],
  phase: [rand(0, 6.3), rand(0, 6.3), rand(0, 6.3)],
  bias: [rand(-0.7, 0.7), rand(-0.7, 0.7), rand(-0.7, 0.7)],
  size,
  jitter: jitterAt(radius),
  delay: Math.min(1, radius / 1.45) * 0.5,
  twitch: twitch(),
  ticking: Math.random() < 0.3,
  until: rand(0, 5),
  period: rand(0.3, 1.1),
  nextTick: 0,
  ready: false,
  want: [0, 0, 0],
  held: [0, 0, 0],
  shown: [0, 0, 0],
});

const BOOT = 1.0; // seconds from dark to fully on
const SHUT = 0.7; // seconds from fully on to dark
const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
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
  };
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const motion = reduced ? 0.25 : 1;
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
    const data = obj.userData as { part?: boolean; radius?: number; spin?: number; size?: number; axes?: [number, number, number]; base?: number };
    if (data.part && data.radius != null && data.spin != null && data.size != null) movers.push(mover(obj, data.radius, data.spin, data.size, data.axes));
    if (obj instanceof THREE.LineSegments) {
      const along = obj.geometry.getAttribute("_along");
      const seed = obj.geometry.getAttribute("_seed");
      if (along) obj.geometry.setAttribute("along", along);
      if (seed) obj.geometry.setAttribute("seed", seed);
      (obj.material as THREE.Material).dispose();
      obj.material = new THREE.ShaderMaterial({
        uniforms: { ...shared, uBase: { value: data.base ?? 0.13 } },
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
  const mouth = gltf.scene.getObjectByName("core");
  if (!mouth || movers.length === 0) throw new Error("orb.glb is missing the orb parts");

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

    // Each part: its own drifting turn, much faster while talking, with a random shake on top and a twitching size.
    // Thinking only flutters a little and slowly: the twitch is smoothed harder for it.
    const pace = (1 + boost * 2.5 + talk * 7) * whirl * motion * dt;
    const shake = talk * 0.045 * motion * dt * 60;
    const flutter = Math.max(talk, boost * 0.35) * motion;
    const snap = 1 - Math.exp(-dt * (boost > talk ? 12 : 45));
    let ticking = 0;
    for (const m of movers) if (m.ticking) ticking++;
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
      // Each part keeps turning smoothly in `want`; it is drawn from there, or stepped in clockwork fashion.
      for (let i = 0; i < 3; i++) {
        m.want[i] += pace * m.spin * m.axes[i] * (Math.sin(t * m.drift[i] + m.phase[i]) + m.bias[i]) + (Math.random() - 0.5) * shake * m.jitter * m.axes[i];
      }
      if (t >= m.until) {
        if (!m.ticking && ticking >= MAX_TICKING) {
          m.until = t + rand(1, 3); // enough parts are ticking already: wait
        } else {
          m.ticking = !m.ticking;
          ticking += m.ticking ? 1 : -1;
          m.until = t + (m.ticking ? rand(2, 5) : rand(4, 11));
        }
      }
      const clockwork = m.ticking && busy < 0.15 && motion === 1;
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
      m.obj.scale.setScalar((1 + flutter * m.size * m.jitter * tick(m.twitch, t, snap)) * grown);
    }

    // The core is the mouth: while talking its size twitches between small and large in quick jumps, and it glows a
    // little brighter when large.
    const jump = tick(coreTwitch, t, snap);
    // The core is first to light and last to go out, and it flickers with the rest.
    const lit = smooth(power / 0.3);
    mouth.scale.setScalar((1 + (talk * 0.7 + boost * 0.12) * jump * motion) * (0.3 + 0.7 * lit));
    coreGlow.value = (1 + 0.25 * talk * (0.5 + 0.5 * jump)) * lit * flick;
  };

  return { root: gltf.scene, update, reboot: () => (power = 0), dispose: () => gltf.scene.traverse(disposeDraw) };
}
