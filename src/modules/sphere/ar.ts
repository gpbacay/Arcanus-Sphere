import * as THREE from "three";
import { loadOrb } from "./orb";

/**
 * Arcanus's orb in the real world, using the 8th Wall XR engine (XR8) for world tracking. The engine files are
 * copied to public/external/xr by `npm install` (scripts/copy-8thwall-engine.mjs).
 *
 * This product includes the XR Engine software developed by Niantic Spatial, Inc.
 * Copyright © 2026 Niantic Spatial, Inc. All rights reserved. License: https://github.com/8thwall/engine/blob/main/LICENSE
 *
 * Touch: drag the orb to move it along surfaces, tap a surface to put it there, pinch to resize, twist to turn.
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

export type ArEvents = { onReady: () => void; onError: (message: string) => void };

/** Starts the camera and the orb inside `container`. Resolves to a function that stops everything. */
export async function startAr(container: HTMLElement, { onReady, onError }: ArEvents): Promise<() => void> {
  const [xr8, orb] = await Promise.all([loadEngine(), loadOrb()]);

  const canvas = document.createElement("canvas");
  container.appendChild(canvas);

  // Looking at the orb through a camera feed: a faint dark dome behind its additive gold keeps it readable in daylight.
  // It is also the target for touches, as thousands of thin lines are no good to aim at.
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(REST, 32, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }),
  );
  dome.renderOrder = -1;
  const rig = new THREE.Group();
  rig.add(dome, orb.root);
  rig.scale.setScalar(SCALE_START);

  const clock = new THREE.Clock();
  let camera: THREE.PerspectiveCamera | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  let placed = false;
  let stopped = false;

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
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(nx * 2 - 1, 1 - ny * 2), camera);
    return ray.ray.intersectPlane(GROUND, new THREE.Vector3());
  };

  /** The orb rests on a point: its centre one radius above it. */
  const putOn = (point: THREE.Vector3) => rig.position.set(point.x, point.y + REST * rig.scale.x, point.z);

  const aimsAtOrb = (clientX: number, clientY: number) => {
    if (!camera) return false;
    const box = container.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((clientX - box.left) / box.width) * 2 - 1, 1 - ((clientY - box.top) / box.height) * 2), camera);
    return ray.intersectObject(dome).length > 0;
  };

  // The engine sizes the canvas to the camera feed; keep it filling the screen instead (also when the phone turns).
  const layout = () => {
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none";
    renderer?.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer?.setSize(container.clientWidth, container.clientHeight, false);
  };
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
    if (touches.size === 1 && grabbed) {
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
    const tap = touches.size === 1 && !grabbed && !moved && performance.now() - start.at < 350;
    touches.delete(event.pointerId);
    if (touches.size < 2) pinch = null;
    if (tap) {
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
    dome.geometry.dispose();
    dome.material.dispose();
    renderer = null;
    canvas.remove();
  };

  xr8.XrController.configure({ disableWorldTracking: false });
  xr8.addCameraPipelineModules([
    xr8.GlTextureRenderer.pipelineModule(),
    xr8.Threejs.pipelineModule(),
    xr8.XrController.pipelineModule(),
    {
      name,
      onStart: () => {
        const xr = xr8.Threejs.xrScene();
        camera = xr.camera;
        renderer = xr.renderer;
        xr.scene.add(rig);
        renderer.setClearColor(0x000000, 0);
        layout();
        camera.position.set(0, CAMERA_HEIGHT, 0);
        xr8.XrController.updateCameraProjectionMatrix({ origin: camera.position, facing: camera.quaternion });
        onReady();
      },
      onUpdate: () => {
        const dt = Math.min(clock.getDelta(), 0.05);
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
  xr8.run({ canvas, allowedDevices: xr8.XrConfig.device().ANY });
  return stop;
}
