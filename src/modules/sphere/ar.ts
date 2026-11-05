import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { loadOrb, ORB_BLOOM, type OrbInputs } from "./orb";

/**
 * Arcanus's orb in the real world, using the 8th Wall XR engine (XR8) for world tracking. The engine files are
 * copied to public/external/xr by `npm install` (scripts/copy-8thwall-engine.mjs).
 *
 * This product includes the XR Engine software developed by Niantic Spatial, Inc.
 * Copyright © 2026 Niantic Spatial, Inc. All rights reserved. License: https://github.com/8thwall/engine/blob/main/LICENSE
 *
 * Touch: drag the orb to move it along surfaces, tap a surface to put it there, pinch to resize, twist to turn.
 * Tap the orb to lock it where it is: no drag or surface tap moves it until you tap the orb (or anywhere) again.
 */

type Hit = { type: string; position: { x: number; y: number; z: number } };
type Xr8 = {
  XrController: {
    configure: (options: object) => void;
    pipelineModule: () => object;
    updateCameraProjectionMatrix: (options: object) => void;
    hitTest: (x: number, y: number, types: string[]) => Hit[];
  };
  GlTextureRenderer: { pipelineModule: () => object };
  Threejs: {
    pipelineModule: () => object;
    xrScene: () => { scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer };
  };
  XrConfig: { device: () => { ANY: unknown } };
  addCameraPipelineModules: (modules: object[]) => void;
  clearCameraPipelineModules: () => void;
  run: (options: object) => void;
  stop: () => void;
};

declare global {
  interface Window {
    XR8?: Xr8;
    THREE?: typeof THREE; // XR8.Threejs looks for this global
  }
}

const ENGINE = "/external/xr/xr.js";
const CAMERA_HEIGHT = 1.5; // metres: sets the world's scale, so the ground sits at y = 0
const START_DISTANCE = 1.5; // metres in front of the camera
const REST = 1.45; // the orb's radius in its own units
const SCALE_START = 0.2; // a ~30 cm radius orb
const SCALE_RANGE = [0.04, 1.2] as const;
const ORB_OPACITY = 1.6; // how much the orb covers the camera behind it, from its brightness: solid at the core, a veil at the halo
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

let loading: Promise<Xr8> | undefined;
function loadEngine(): Promise<Xr8> {
  loading ??= new Promise<Xr8>((resolve, reject) => {
    window.THREE = THREE;
    const done = () => (window.XR8 ? resolve(window.XR8) : reject(new Error("The AR engine loaded without XR8.")));
    if (window.XR8) return done();
    const script = document.createElement("script");
    script.src = ENGINE;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.preloadChunks = "slam"; // the world-tracking chunk
    script.onerror = () => reject(new Error("Could not load the AR engine."));
    window.addEventListener("xrloaded", done, { once: true });
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    loading = undefined; // let a retry try again
    throw error;
  });
  return loading;
}

export type ArEvents = { onReady: () => void; onError: (message: string) => void; onLock?: (locked: boolean) => void };

/** Starts the camera and the orb inside `container`. Resolves to a function that stops everything. */
export async function startAr(container: HTMLElement, { onReady, onError, onLock }: ArEvents, inputs: OrbInputs = {}): Promise<() => void> {
  const [xr8, orb] = await Promise.all([loadEngine(), loadOrb(inputs)]);

  const canvas = document.createElement("canvas");
  container.appendChild(canvas);

  // An invisible dome: the target for touches, as thousands of thin lines are no good to aim at. Nothing is drawn behind
  // the orb, so the camera feed shows right through it.
  const dome = new THREE.Mesh(new THREE.SphereGeometry(REST, 32, 16), new THREE.MeshBasicMaterial({ visible: false }));
  const rig = new THREE.Group();
  rig.add(dome, orb.root);
  rig.scale.setScalar(SCALE_START);
  // The orb is drawn on black with the studio's bloom, then added onto the camera. Drawing it straight on the
  // feed (or as flat gold) loses the halo and the hot core.
  const bloomScene = new THREE.Scene();
  bloomScene.add(rig);
  const glowMat = new THREE.RawShaderMaterial({
    uniforms: { tDiffuse: { value: null }, uOpacity: { value: ORB_OPACITY } },
    vertexShader: /* glsl */ `
      attribute vec3 position;
      attribute vec2 uv;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D tDiffuse;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        // Linear to sRGB here, what the studio's OutputPass does: one full-screen pass fewer. No extra gain, so the orb
        // is exactly as bright as in the studio.
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        c = mix(pow(c, vec3(0.41666)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
        // The orb covers the camera behind it in proportion to how bright it is there, so it reads as a thing, not a tint.
        float a = clamp(max(c.r, max(c.g, c.b)) * uOpacity, 0.0, 1.0);
        gl_FragColor = vec4(c, a);
      }
    `,
    // Premultiplied over: the orb's light, plus what is left of the camera behind it.
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), glowMat);
  glow.frustumCulled = false;

  const clock = new THREE.Clock();
  const caster = new THREE.Raycaster(); // reused by every touch: pointer moves fire many times a second
  const ndc = new THREE.Vector2();
  let camera: THREE.PerspectiveCamera | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  let composer: EffectComposer | null = null;
  let placed = false;
  let stopped = false;
  let locked = false; // tapped in place: nothing moves it until it is tapped again (or anywhere else is)
  const lock = (next: boolean) => {
    locked = next;
    onLock?.(next);
  };

  /** Where the finger points in the world: a detected surface if SLAM has one, else the ground plane. */
  const pick = (clientX: number, clientY: number) => {
    if (!camera) return null;
    const box = container.getBoundingClientRect();
    const nx = (clientX - box.left) / box.width;
    const ny = (clientY - box.top) / box.height;
    try {
      const hits = xr8.XrController.hitTest(nx, ny, ["ESTIMATED_SURFACE", "FEATURE_POINT"]);
      const hit = hits.find((h) => h.type !== "FEATURE_POINT") ?? hits[0]; // a surface beats a lone feature point
      if (hit) return new THREE.Vector3(hit.position.x, hit.position.y, hit.position.z);
    } catch {
      // SLAM is still warming up: fall through to the ground plane.
    }
    caster.setFromCamera(ndc.set(nx * 2 - 1, 1 - ny * 2), camera);
    return caster.ray.intersectPlane(GROUND, new THREE.Vector3());
  };

  /** The orb rests on a point: its centre one radius above it. */
  const putOn = (point: THREE.Vector3) => rig.position.set(point.x, point.y + REST * rig.scale.x, point.z);

  const aimsAtOrb = (clientX: number, clientY: number) => {
    if (!camera) return false;
    const box = container.getBoundingClientRect();
    caster.setFromCamera(ndc.set(((clientX - box.left) / box.width) * 2 - 1, 1 - ((clientY - box.top) / box.height) * 2), camera);
    return caster.intersectObject(dome).length > 0;
  };

  // The engine sizes the canvas to the camera feed; keep it filling the screen instead (also when the phone turns).
  // Pixel ratio capped at 1.5, under the studio's 2: the bloom plate is the frame's main cost and this roughly halves it
  // on a 3x phone. Ratio 1 made every trace a full CSS pixel wide, so it is only the floor when frames run slow (onUpdate).
  let sharpness = 1.5;
  let plate = ""; // the size the bloom plate was last made at: resizing it reallocates a dozen render targets
  const layout = () => {
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none";
    if (!renderer) return;
    const ratio = Math.min(window.devicePixelRatio || 1, sharpness);
    const w = container.clientWidth;
    const h = container.clientHeight;
    // Mobile browsers fire resize all the time (the address bar sliding): only touch what actually changed.
    if (canvas.width !== Math.floor(w * ratio) || canvas.height !== Math.floor(h * ratio)) {
      renderer.setPixelRatio(ratio);
      renderer.setSize(w, h, false);
    }
    if (composer && plate !== `${w}x${h}@${ratio}`) {
      plate = `${w}x${h}@${ratio}`;
      composer.setPixelRatio(ratio);
      composer.setSize(w, h);
    }
  };
  let slow = 0; // seconds of slow frames, less the fast ones since
  layout();
  window.addEventListener("resize", layout);
  window.visualViewport?.addEventListener("resize", layout);

  // ---- gestures
  const touches = new Map<number, { x: number; y: number }>();
  let grabbed = false;
  let start = { x: 0, y: 0, at: 0 };
  let moved = false;
  let pinch: { distance: number; angle: number; scale: number; turn: number } | null = null;
  const pair = () => {
    const [a, b] = [...touches.values()];
    return { distance: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x) };
  };

  const down = (event: PointerEvent) => {
    canvas.setPointerCapture(event.pointerId);
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size === 1) {
      grabbed = aimsAtOrb(event.clientX, event.clientY);
      moved = false;
      start = { x: event.clientX, y: event.clientY, at: performance.now() };
    } else if (touches.size === 2) {
      grabbed = false;
      pinch = { ...pair(), scale: rig.scale.x, turn: rig.rotation.y };
    }
  };
  const move = (event: PointerEvent) => {
    const touch = touches.get(event.pointerId);
    if (!touch) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) moved = true;
    touch.x = event.clientX;
    touch.y = event.clientY;
    if (touches.size === 1 && grabbed && moved && !locked) {
      const point = pick(event.clientX, event.clientY);
      if (point) putOn(point);
    } else if (touches.size === 2 && pinch) {
      const now = pair();
      const scale = pinch.scale * (now.distance / pinch.distance);
      rig.scale.setScalar(Math.min(SCALE_RANGE[1], Math.max(SCALE_RANGE[0], scale)));
      rig.rotation.y = pinch.turn - (now.angle - pinch.angle); // a clockwise twist on screen turns the orb clockwise from above
    }
  };
  const up = (event: PointerEvent) => {
    const tap = touches.size === 1 && !moved && performance.now() - start.at < 350;
    touches.delete(event.pointerId);
    if (touches.size < 2) pinch = null;
    if (tap && grabbed) lock(!locked); // tapped the orb: lock it here, or let it go again
    else if (tap && locked) lock(false); // tapped elsewhere: unlock only, the next tap places it
    else if (tap) {
      const point = pick(event.clientX, event.clientY);
      if (point) putOn(point);
    }
    grabbed = false;
  };
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);

  const name = "arcanus-orb";
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.removeEventListener("resize", layout);
    window.visualViewport?.removeEventListener("resize", layout);
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", up);
    canvas.removeEventListener("pointercancel", up);
    try {
      xr8.stop();
      xr8.clearCameraPipelineModules();
    } catch {
      // already stopped
    }
    orb.dispose();
    composer?.dispose();
    glow.geometry.dispose();
    glowMat.dispose();
    dome.geometry.dispose();
    dome.material.dispose();
    renderer = null;
    canvas.remove();
  };

  xr8.XrController.configure({ disableWorldTracking: false });
  xr8.addCameraPipelineModules([
    {
      name: "arcanus-bloom",
      // Before the engine draws anything: bloom the orb on black, then the engine draws the camera and lays that plate
      // over it. The plate comes first so the canvas is drawn in one go: a phone's GPU pays to leave and come back to it.
      onRender: () => {
        glow.visible = orb.root.visible; // switched off: nothing to bloom, nothing to add onto the camera
        if (!composer || !renderer || !glow.visible) return;
        const clearColor = renderer.autoClearColor;
        const clearDepth = renderer.autoClearDepth;
        // The camera pass turns color clearing off. The bloom plate still has to start from black each frame.
        renderer.autoClearColor = true;
        renderer.autoClearDepth = true;
        composer.render();
        renderer.resetState();
        renderer.autoClearColor = clearColor;
        renderer.autoClearDepth = clearDepth;
        glowMat.uniforms.tDiffuse.value = composer.readBuffer.texture;
      },
    },
    xr8.GlTextureRenderer.pipelineModule(),
    xr8.Threejs.pipelineModule(),
    xr8.XrController.pipelineModule(),
    {
      name,
      onStart: () => {
        const xr = xr8.Threejs.xrScene();
        camera = xr.camera;
        renderer = xr.renderer;
        renderer.setClearColor(0x000000, 0);
        composer = new EffectComposer(renderer);
        composer.renderToScreen = false;
        composer.addPass(new RenderPass(bloomScene, camera, null, new THREE.Color(0x000000), 1));
        composer.addPass(new UnrealBloomPass(new THREE.Vector2(container.clientWidth, container.clientHeight), ORB_BLOOM.strength, ORB_BLOOM.radius, ORB_BLOOM.threshold));
        layout(); // sizes the renderer and the bloom plate alike: a plate at 1x on a 3x screen draws every trace fat and soft
        xr.scene.add(glow);
        camera.position.set(0, CAMERA_HEIGHT, 0);
        xr8.XrController.updateCameraProjectionMatrix({ origin: camera.position, facing: camera.quaternion });
        onReady();
      },
      onCanvasSizeChange: () => layout(),
      onUpdate: () => {
        const raw = clock.getDelta();
        const dt = Math.min(raw, 0.05);
        // Running under ~25 fps for two seconds straight: drop the resolution a step (1.5 -> 1.25 -> 1). It never goes
        // back up, so it can't flip back and forth.
        slow = raw > 1 / 25 ? slow + raw : Math.max(0, slow - raw);
        if (slow > 2 && sharpness > 1) {
          sharpness -= 0.25;
          slow = 0;
          layout();
        }
        if (camera && !placed) {
          // First frame with a real camera pose: float the orb at the middle of the screen.
          placed = true;
          const ahead = new THREE.Vector3(0, 0, -START_DISTANCE).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
          rig.position.copy(camera.getWorldPosition(new THREE.Vector3())).add(ahead);
        }
        orb.update(dt);
      },
      onCameraStatusChange: ({ status }: { status: string }) => {
        if (status === "failed") onError("Arcanus needs your camera to appear in your space. Allow camera access and try again.");
      },
      onException: (error: unknown) => {
        console.error(error);
        onError("Something went wrong with the camera tracking.");
      },
    },
  ]);
  // No multisampling: only two full-screen quads (the camera and the plate) are ever drawn on the canvas. The orb's lines are
  // drawn into the plate, which MSAA on the canvas does nothing for, so it would only cost a full-screen resolve a frame.
  xr8.run({ canvas, allowedDevices: xr8.XrConfig.device().ANY, glContextConfig: { antialias: false } });
  return stop;
}
