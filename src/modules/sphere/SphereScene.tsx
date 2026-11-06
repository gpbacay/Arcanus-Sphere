"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { loadOrb, ORB_BLOOM, type Orb } from "./orb";

/**
 * The studio: Arcanus's orb standing in a 3D space grid. Drag to orbit the camera, scroll or pinch to zoom, and pick a
 * tool (`tool`) to move, rotate or resize the orb itself with a gizmo. How the orb looks and moves is orb.ts.
 */
export type Tool = "view" | "move" | "rotate" | "scale";

type Props = {
  analyser: AnalyserNode | null;
  /** 0..1: how busy Arcanus is while there is no audio yet (thinking). */
  activityBoost?: number;
  tool?: Tool;
  /** Arcanus's power switch: flipping it plays the boot-up or shutdown animation. */
  on?: boolean;
  /** Bump to put the orb and the camera back where they started. */
  resetKey?: number;
};

const GRID_Y = -1.75; // just under the outermost ring (out to ~1.69 at its largest)
const SCALE_RANGE = [0.3, 3] as const;
const NARROW = 720;
// Phone: the canvas is only the free band under the chrome, so the orb can sit in the middle of it.
const homeFor = (width: number) => (width <= NARROW ? new THREE.Vector3(0, 0.15, 5.8) : new THREE.Vector3(0, 2.4, 4.2));

const MODES = { move: "translate", rotate: "rotate", scale: "scale" } as const;

// The grid is one big quad that follows the camera, with the lines drawn in its shader: 1 m cells, a stronger line
// every 5 m, fading out with distance. Unlike a mesh of long line segments it can't be clipped away at the camera.
const GRID_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const GRID_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying vec3 vWorld;
  float lines(vec2 p) {
    vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
    return 1.0 - min(min(g.x, g.y), 1.0);
  }
  void main() {
    float fade = 1.0 - smoothstep(6.0, 30.0, distance(vWorld.xz, cameraPosition.xz));
    float a = (lines(vWorld.xz) * 0.22 + lines(vWorld.xz / 5.0) * 0.35) * fade;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

function makeGrid() {
  const grid = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color("#6fe0ff") } },
      vertexShader: GRID_VERTEX,
      fragmentShader: GRID_FRAGMENT,
      transparent: true,
      depthWrite: false,
    }),
  );
  grid.position.y = GRID_Y;
  grid.frustumCulled = false;
  return grid;
}

export default function SphereScene({ analyser, activityBoost = 0, tool = "view", on = true, resetKey = 0 }: Props) {
  const [broken, setBroken] = useState(false);
  const mountRef = useRef<HTMLDivElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const boostRef = useRef(0);
  const onRef = useRef(on);
  const api = useRef<{ tool: (tool: Tool) => void; reset: () => void } | null>(null);

  useEffect(() => {
    analyserRef.current = analyser;
  }, [analyser]);

  useEffect(() => {
    onRef.current = on;
  }, [on]);

  useEffect(() => {
    boostRef.current = Math.max(0, Math.min(1, activityBoost));
  }, [activityBoost]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(1, 1, false);
    renderer.setClearColor(0x000000, 1);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.copy(homeFor(mount.clientWidth || window.innerWidth));
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enablePan = false;
    controls.minDistance = 2.2;
    controls.maxDistance = 9;
    controls.maxPolarAngle = 1.7; // never dip under the grid

    const grid = makeGrid();
    scene.add(grid);

    // The orb moves inside its own parts; this rig is what the gizmo moves, turns and resizes as a whole.
    const rig = new THREE.Group();
    scene.add(rig);
    const gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.setSize(0.8);
    gizmo.attach(rig);
    const helper = gizmo.getHelper();
    scene.add(helper);

    let dragStartScale = 1;
    gizmo.addEventListener("dragging-changed", (event) => {
      controls.enabled = !event.value;
      dragStartScale = rig.scale.x;
    });
    // Resizing is uniform: the orb never stretches. Of the three axes, take the one the drag actually moved.
    gizmo.addEventListener("objectChange", () => {
      if (gizmo.mode !== "scale") return;
      const { x, y, z } = rig.scale;
      const moved = [x, y, z].reduce((a, b) => (Math.abs(Math.log(b / dragStartScale)) > Math.abs(Math.log(a / dragStartScale)) ? b : a));
      rig.scale.setScalar(Math.min(SCALE_RANGE[1], Math.max(SCALE_RANGE[0], moved)));
    });

    api.current = {
      tool: (next) => {
        gizmo.enabled = next !== "view";
        helper.visible = next !== "view";
        if (next !== "view") gizmo.setMode(MODES[next]);
      },
      reset: () => {
        rig.position.set(0, 0, 0);
        rig.rotation.set(0, 0, 0);
        rig.scale.setScalar(1);
        camera.position.copy(homeFor(mount.clientWidth || window.innerWidth));
        controls.target.set(0, 0, 0);
      },
    };
    api.current.tool("view");

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), ORB_BLOOM.strength, ORB_BLOOM.radius, ORB_BLOOM.threshold));
    composer.addPass(new OutputPass());

    const fit = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w < 2 || h < 2) return;
      camera.aspect = w / h;
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
    };
    fit();
    const onResize = new ResizeObserver(fit);
    onResize.observe(mount);

    const clock = new THREE.Clock();
    let frame = 0;
    let dead = false;
    let orb: Orb | null = null;

    loadOrb({ analyser: () => analyserRef.current, boost: () => boostRef.current, on: () => onRef.current })
      .then((loaded) => {
        if (dead) return loaded.dispose();
        orb = loaded;
        rig.add(loaded.root);
        const render = () => {
          frame = requestAnimationFrame(render);
          controls.update();
          grid.position.x = camera.position.x;
          grid.position.z = camera.position.z;
          loaded.update(Math.min(clock.getDelta(), 0.05));
          composer.render();
        };
        clock.getDelta();
        render();
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!dead) setBroken(true);
      });

    return () => {
      dead = true;
      api.current = null;
      cancelAnimationFrame(frame);
      onResize.disconnect();
      orb?.dispose();
      gizmo.dispose();
      controls.dispose();
      grid.geometry.dispose();
      grid.material.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => api.current?.tool(tool), [tool]);
  useEffect(() => {
    if (resetKey) api.current?.reset();
  }, [resetKey]);

  if (broken) throw new Error("orb.glb failed to load");

  return <div ref={mountRef} className="stage-view" />;
}
