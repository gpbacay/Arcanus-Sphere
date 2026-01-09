"use client";

import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface SphereSceneProps {
  analyser: AnalyserNode | null;
}

const SphereScene: React.FC<SphereSceneProps> = ({ analyser }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  // Track previous scale to determine expansion/shrinking
  const prevScaleRef = useRef(1.0);

  // Update the ref whenever the prop changes so the render loop has access to the latest analyser
  useEffect(() => {
    analyserRef.current = analyser;
  }, [analyser]);

  useEffect(() => {
    if (!mountRef.current) return;

    let scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer, innerParticleGroup: THREE.Group, middleParticleGroup: THREE.Group, composer: EffectComposer, controls: OrbitControls;
    let bloomPass: UnrealBloomPass;
    let innerSphere: THREE.Mesh;
    let animationId: number;
    let time = 0;
    const particleCount = 1000;
    const innerParticleCount = 5000;

    // Lightning effect variables
    const lightningBolts: THREE.Mesh[] = [];
    const maxLightningConnections = 80;
    const lightningThickness = 0.0008;
    const boltLife: number[] = new Array(maxLightningConnections).fill(0);
    const boltMaxLifes: number[] = new Array(maxLightningConnections).fill(1);
    const boltTrackData: { startIdx: number; endIdx: number; startLayer: 'core' | 'inner' | 'middle'; endLayer: 'inner' | 'middle' }[] = new Array(maxLightningConnections).fill(null);

    // Chain reaction state
    // Chain reaction state
    type ActiveTip = { idx: number; layer: 'core' | 'inner' | 'middle'; remainingBranches: number; chainDepth: number };
    let activeTips: ActiveTip[] = [];

    // To store geometries for access in render loop
    let middleGeometry: THREE.BufferGeometry;
    let innerGeometry: THREE.BufferGeometry;
    let wireframeSphere: THREE.LineSegments;

    // Store original positions for organic movement calculations
    let middleOriginalPositions: Float32Array;
    let innerOriginalPositions: Float32Array;
    let middleOriginalColors: Float32Array;
    let innerOriginalColors: Float32Array;

    // Random phases for each particle to desynchronize their movement
    let middlePhases: Float32Array;
    let innerPhases: Float32Array;

    // Reusable array for frequency data to avoid garbage collection
    const dataArray = new Uint8Array(256);

    const setupScene = () => {
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(window.innerWidth, window.innerHeight);
      mountRef.current?.appendChild(renderer.domElement);

      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.enableZoom = true;
      controls.enablePan = false;
      camera.position.z = 5;

      // Create inner glowing sphere (solid core) -> Smaller radius 0.15
      const innerSphereGeometry = new THREE.SphereGeometry(0.08, 64, 64);
      const innerSphereMaterial = new THREE.MeshBasicMaterial({
        color: 0x6e8efb,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending
      });
      innerSphere = new THREE.Mesh(innerSphereGeometry, innerSphereMaterial);
      scene.add(innerSphere);

      // Palette
      const palette = [
        new THREE.Color("#B9DFE0"),
        new THREE.Color("#F294C0"),
        new THREE.Color("#C785F2"),
        new THREE.Color("#835BD9"),
        new THREE.Color("#9DE4FA")
      ];

      // Hex Core Wireframe Cage
      const wireframeGeo = new THREE.IcosahedronGeometry(0.14, 1);
      const wireframeEdges = new THREE.WireframeGeometry(wireframeGeo);
      const wireframeMaterial = new THREE.LineBasicMaterial({
        color: 0x9DE4FA,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending
      });
      wireframeSphere = new THREE.LineSegments(wireframeEdges, wireframeMaterial);
      scene.add(wireframeSphere);


      // Create middle particle sphere layer (Volumetric)
      const middleParticleCount = 3500;
      const middlePositionsArray = new Float32Array(middleParticleCount * 3);
      const middleColors = new Float32Array(middleParticleCount * 3);

      middleOriginalPositions = new Float32Array(middleParticleCount * 3);
      middlePhases = new Float32Array(middleParticleCount);

      for (let i = 0; i < middleParticleCount; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        // Volumetric distribution: Radius varies between 0.35 and 0.55
        const r = 0.35 + Math.random() * 0.2;

        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi);

        middlePositionsArray[i * 3] = x;
        middlePositionsArray[i * 3 + 1] = y;
        middlePositionsArray[i * 3 + 2] = z;

        // Store original
        middleOriginalPositions[i * 3] = x;
        middleOriginalPositions[i * 3 + 1] = y;
        middleOriginalPositions[i * 3 + 2] = z;

        middlePhases[i] = Math.random() * Math.PI * 2;

        const color = palette[Math.floor(Math.random() * palette.length)];
        middleColors[i * 3] = color.r;
        middleColors[i * 3 + 1] = color.g;
        middleColors[i * 3] = color.r;
        middleColors[i * 3 + 1] = color.g;
        middleColors[i * 3 + 2] = color.b;
      }

      // Save original colors for restoration
      middleOriginalColors = new Float32Array(middleColors);

      middleGeometry = new THREE.BufferGeometry();
      middleGeometry.setAttribute('position', new THREE.BufferAttribute(middlePositionsArray, 3));
      middleGeometry.setAttribute('color', new THREE.BufferAttribute(middleColors, 3));

      const middleMaterial = new THREE.PointsMaterial({
        size: 0.005,
        vertexColors: true,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending
      });

      const middleParticles = new THREE.Points(middleGeometry, middleMaterial);
      middleParticleGroup = new THREE.Group();
      middleParticleGroup.add(middleParticles);
      scene.add(middleParticleGroup);

      // Inner particle cloud (Volumetric and overlapping)
      const innerPositionsArray = new Float32Array(innerParticleCount * 3);
      const innerColors = new Float32Array(innerParticleCount * 3);

      innerOriginalPositions = new Float32Array(innerParticleCount * 3);
      innerPhases = new Float32Array(innerParticleCount);

      for (let i = 0; i < innerParticleCount; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        // Volumetric distribution: Radius varies between 0.5 and 0.8
        // Note: In original code "inner" was actually larger radius (0.6) than "middle" (0.43).
        // We keep this hierarchy but make it volumetric.
        const r = 0.5 + Math.random() * 0.3;

        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi);

        innerPositionsArray[i * 3] = x;
        innerPositionsArray[i * 3 + 1] = y;
        innerPositionsArray[i * 3 + 2] = z;

        // Store original
        innerOriginalPositions[i * 3] = x;
        innerOriginalPositions[i * 3 + 1] = y;
        innerOriginalPositions[i * 3 + 2] = z;

        innerPhases[i] = Math.random() * Math.PI * 2;

        const color = palette[Math.floor(Math.random() * palette.length)];
        innerColors[i * 3] = color.r;
        innerColors[i * 3 + 1] = color.g;
        innerColors[i * 3] = color.r;
        innerColors[i * 3 + 1] = color.g;
        innerColors[i * 3 + 2] = color.b;
      }

      // Save original colors for restoration
      innerOriginalColors = new Float32Array(innerColors);

      innerGeometry = new THREE.BufferGeometry();
      innerGeometry.setAttribute('position', new THREE.BufferAttribute(innerPositionsArray, 3));
      innerGeometry.setAttribute('color', new THREE.BufferAttribute(innerColors, 3));

      const innerMaterial = new THREE.PointsMaterial({
        size: 0.007,
        vertexColors: true,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending
      });

      const innerParticles = new THREE.Points(innerGeometry, innerMaterial);
      innerParticleGroup = new THREE.Group();
      innerParticleGroup.add(innerParticles);
      scene.add(innerParticleGroup);

      const ambientLight = new THREE.AmbientLight(0x101010, 0.1);
      scene.add(ambientLight);

      composer = new EffectComposer(renderer);
      const renderPass = new RenderPass(scene, camera);
      composer.addPass(renderPass);
      bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        1.2,
        0.6,
        0.3
      );
      composer.addPass(bloomPass);

      // Setup Lightning Bolts
      const boltHeight = 1;
      const boltGeometry = new THREE.CylinderGeometry(lightningThickness, lightningThickness, boltHeight, 6);

      for (let i = 0; i < maxLightningConnections; i++) {
        const boltMaterial = new THREE.MeshBasicMaterial({
          color: 0xaecbe8,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending
        });

        const bolt = new THREE.Mesh(boltGeometry, boltMaterial);
        bolt.visible = false;
        scene.add(bolt);
        lightningBolts.push(bolt);
      }

    };

    const resizeShape = (forceRender = true) => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      if (composer) {
        composer.setSize(window.innerWidth, window.innerHeight);
      }
      if (forceRender) render();
    };

    const onResize = () => resizeShape();

    const getAverage = (data: Uint8Array, start: number, end: number) => {
      let sum = 0;
      for (let i = start; i < end; i++) {
        sum += data[i];
      }
      return sum / (end - start);
    };

    // Dynamic Rotation Vectors (Random direction and speed)
    const innerRotVel = new THREE.Vector3(
      (Math.random() - 0.5) * 0.02,
      (Math.random() - 0.5) * 0.02,
      (Math.random() - 0.5) * 0.02
    );
    const middleRotVel = new THREE.Vector3(
      (Math.random() - 0.5) * 0.015,
      (Math.random() - 0.5) * 0.015,
      (Math.random() - 0.5) * 0.015
    );

    const render = () => {
      time += 0.01; // Slower time for smoother organic movement
      animationId = requestAnimationFrame(render);

      controls.update();

      let bass = 0;
      let mid = 0;
      let treble = 0;

      if (analyserRef.current) {
        analyserRef.current.getByteFrequencyData(dataArray);
        bass = getAverage(dataArray, 0, 10) / 255;
        mid = getAverage(dataArray, 10, 80) / 255;
        treble = getAverage(dataArray, 80, 200) / 255;
      }

      // Dynamic scaling based on frequency bands
      const bassScale = 1 + bass * 0.8;
      const vocalScale = 1 + (mid * 0.8 + treble * 0.5);

      // Calculate expansion state
      const currentScale = vocalScale;
      const scaleDelta = currentScale - prevScaleRef.current;
      const isExpanding = scaleDelta > 0.001;
      prevScaleRef.current = currentScale;

      // Animate inner solid sphere
      if (innerSphere) {
        innerSphere.scale.setScalar(vocalScale * 0.9);
        (innerSphere.material as THREE.MeshBasicMaterial).opacity = 0.6 + bass * 0.3;
        const r = 110 + bass * 100;
        const g = 142 + mid * 80;
        const b = 251 - treble * 100;
        (innerSphere.material as THREE.MeshBasicMaterial).color.setRGB(r / 255, g / 255, b / 255);

        innerSphere.rotation.x += innerRotVel.x + (bass * 0.01 * Math.sign(innerRotVel.x));
        innerSphere.rotation.y += innerRotVel.y + (bass * 0.01 * Math.sign(innerRotVel.y));
        innerSphere.rotation.z += innerRotVel.z + (bass * 0.01 * Math.sign(innerRotVel.z));
      }

      // Animate Wireframe
      if (wireframeSphere) {
        wireframeSphere.scale.setScalar(vocalScale * 0.95);
        wireframeSphere.rotation.x -= 0.005;
        wireframeSphere.rotation.y += 0.005;
        wireframeSphere.rotation.z += 0.002;
        (wireframeSphere.material as THREE.LineBasicMaterial).opacity = 0.3 + mid * 0.4;
      }

      // --- Biologically Inspired Fluctuation (CPU) ---
      // We update particle positions directly here so lightning can track them.

      const updateParticles = (
        geometry: THREE.BufferGeometry,
        originalPos: Float32Array,
        phases: Float32Array,
        intensity: number,
        speedMod: number,
        jitterAmount: number
      ) => {
        const positions = geometry.attributes.position.array as Float32Array;
        const count = positions.length / 3;

        // Movement parameters
        const moveScale = 0.05 + intensity * 0.1;
        const timeS = time * speedMod;

        for (let i = 0; i < count; i++) {
          const ix = i * 3;
          const ox = originalPos[ix];
          const oy = originalPos[ix + 1];
          const oz = originalPos[ix + 2];
          const phase = phases[i];

          // Organic noise-like movement using sine superposition
          // "Fluctuation"
          let dx = Math.sin(timeS + oy * 2.0 + phase) * moveScale;
          let dy = Math.cos(timeS * 0.8 + oz * 2.0 + phase) * moveScale;
          let dz = Math.sin(timeS * 1.2 + ox * 2.0 + phase) * moveScale;

          // Twitch/Jitter
          if (jitterAmount > 0.1) {
            dx += (Math.random() - 0.5) * jitterAmount * 0.05;
            dy += (Math.random() - 0.5) * jitterAmount * 0.05;
            dz += (Math.random() - 0.5) * jitterAmount * 0.05;
          }

          // Apply new position
          positions[ix] = ox + dx;
          positions[ix + 1] = oy + dy;
          positions[ix + 2] = oz + dz;
        }
        geometry.attributes.position.needsUpdate = true;
      }

      if (middleParticleGroup && middleGeometry) {
        // Rotate the group slowly for global swirl
        middleParticleGroup.rotation.y += 0.002;
        middleParticleGroup.rotation.z += 0.001;
        // Apply individual fluctuations
        updateParticles(middleGeometry, middleOriginalPositions, middlePhases, bass, 1.0, treble);
      }

      if (innerParticleGroup && innerGeometry) {
        innerParticleGroup.rotation.y -= 0.003; // Counter rotation
        innerParticleGroup.rotation.x += 0.001;
        updateParticles(innerGeometry, innerOriginalPositions, innerPhases, mid + treble, 1.5, treble);
      }


      // Update Lightning Effect
      if (middleParticleGroup && innerParticleGroup && middleGeometry && innerGeometry) {
        const middlePositions = middleGeometry.attributes.position.array as Float32Array;
        const innerPositions = innerGeometry.attributes.position.array as Float32Array;

        middleParticleGroup.updateMatrixWorld();
        innerParticleGroup.updateMatrixWorld();

        // Focus on vocal range (Mid/Treble) for "speaking"
        // Bass is usually environmental/beat, not the "voice"
        // Reset colors to original before applying highlights
        if (middleOriginalColors) {
          (middleGeometry.attributes.color.array as Float32Array).set(middleOriginalColors);
          middleGeometry.attributes.color.needsUpdate = true;
        }
        if (innerOriginalColors) {
          (innerGeometry.attributes.color.array as Float32Array).set(innerOriginalColors);
          innerGeometry.attributes.color.needsUpdate = true;
        }

        // Focus on vocal range (Mid/Treble) for "speaking"
        // Bass is usually environmental/beat, not the "voice"
        const vocalIntensity = mid + treble * 0.7;
        const isSpeaking = vocalIntensity > 0.2; // Higher threshold to strictly catch "speaking"

        // Active count based on vocal intensity
        const activeConnections = isSpeaking ? Math.floor(Math.min(maxLightningConnections, vocalIntensity * 120)) : 0;

        for (let i = 0; i < maxLightningConnections; i++) {
          const bolt = lightningBolts[i];
          if (!bolt) continue;

          // Update active bolts
          if (boltLife[i] > 0 && boltTrackData[i]) {
            if (!isSpeaking) {
              boltLife[i] -= 5; // Rapid decay if speech stops
            } else {
              boltLife[i]--;
            }

            if (boltLife[i] <= 0) {
              bolt.visible = false;
            } else {
              // Fade
              const lifeRatio = boltLife[i] / (boltMaxLifes[i] || 1);
              const opacity = Math.pow(lifeRatio, 1.5) * 0.8;
              (bolt.material as THREE.MeshBasicMaterial).opacity = opacity;

              // Highlight connected particle
              const data = boltTrackData[i];
              if (data) {
                const targetGeometry = data.endLayer === 'inner' ? innerGeometry : middleGeometry;
                const colors = targetGeometry.attributes.color.array as Float32Array;
                const idx = data.endIdx * 3;
                // Set to bright white/cyan mix for electricity
                colors[idx] = 1.0;     // R
                colors[idx + 1] = 1.0; // G
                colors[idx + 2] = 1.0; // B
                targetGeometry.attributes.color.needsUpdate = true;
              }

              // Position Update

              const v1 = new THREE.Vector3();
              const v2 = new THREE.Vector3();

              // End Position (Target Particle)
              const endArr = data.endLayer === 'inner' ? innerPositions : middlePositions;
              const endGroup = data.endLayer === 'inner' ? innerParticleGroup : middleParticleGroup;
              v2.set(endArr[data.endIdx * 3], endArr[data.endIdx * 3 + 1], endArr[data.endIdx * 3 + 2]);
              v2.applyMatrix4(endGroup.matrixWorld);

              // Start Position
              if (data.startLayer === 'core') {
                // Core Surface
                let coreRadius = 0.08;
                if (innerSphere) {
                  coreRadius = 0.08 * innerSphere.scale.x;
                }
                v1.copy(v2).normalize().multiplyScalar(coreRadius);
              } else {
                // Particle -> Particle
                const startArr = data.startLayer === 'inner' ? innerPositions : middlePositions;
                const startGroup = data.startLayer === 'inner' ? innerParticleGroup : middleParticleGroup;
                v1.set(startArr[data.startIdx * 3], startArr[data.startIdx * 3 + 1], startArr[data.startIdx * 3 + 2]);
                v1.applyMatrix4(startGroup.matrixWorld);
              }

              const distance = v1.distanceTo(v2);
              const midpoint = new THREE.Vector3().addVectors(v1, v2).multiplyScalar(0.5);
              bolt.position.copy(midpoint);
              bolt.lookAt(v2);
              bolt.rotateX(Math.PI / 2);
              bolt.scale.set(1, distance, 1);
              bolt.visible = true;

              continue;
            }
          }

          // Spawn Block
          if (i < activeConnections && boltLife[i] <= 0 && isSpeaking) {
            // Seed defaults
            if (activeTips.length === 0 && Math.random() < 0.1) {
              activeTips.push({ idx: -1, layer: 'core', remainingBranches: Math.floor(Math.random() * 2) + 2, chainDepth: 0 });
            }

            if (activeTips.length > 0) {
              // Pick a tip
              const tipIdx = Math.floor(Math.random() * activeTips.length);
              const tip = activeTips[tipIdx];

              const startLayer = tip.layer;
              const startIdx = tip.idx;

              // Determine target
              const endLayer = Math.random() > 0.6 ? 'inner' : 'middle'; // Bias slightly to inner
              const endArr = endLayer === 'inner' ? innerPositions : middlePositions;
              const endCount = endArr.length / 3;
              const endIdx = Math.floor(Math.random() * endCount);

              boltTrackData[i] = { startIdx, endIdx, startLayer, endLayer };

              const newLife = Math.floor(Math.random() * 15) + 10;
              boltLife[i] = newLife;
              boltMaxLifes[i] = newLife;

              // Propagate Chain
              const maxDepth = 6;
              if (tip.chainDepth < maxDepth) {
                const branchChance = 0.3 + (bass * 0.4); // More branching with bass
                const branches = Math.random() < branchChance ? 2 : 1;
                activeTips.push({
                  idx: endIdx,
                  layer: endLayer,
                  remainingBranches: branches,
                  chainDepth: tip.chainDepth + 1
                });
              }

              // Update Tip
              tip.remainingBranches--;
              if (tip.remainingBranches <= 0) {
                activeTips.splice(tipIdx, 1);
              }

              // Update Visuals Immediate
              const v2 = new THREE.Vector3();
              const endGroup = endLayer === 'inner' ? innerParticleGroup : middleParticleGroup;

              v2.set(endArr[endIdx * 3], endArr[endIdx * 3 + 1], endArr[endIdx * 3 + 2]);
              v2.applyMatrix4(endGroup.matrixWorld);

              const v1 = new THREE.Vector3();
              if (startLayer === 'core') {
                let coreRadius = 0.08 * (innerSphere ? innerSphere.scale.x : 1);
                v1.copy(v2).normalize().multiplyScalar(coreRadius);
              } else {
                const startArr = startLayer === 'inner' ? innerPositions : middlePositions;
                const startGroup = startLayer === 'inner' ? innerParticleGroup : middleParticleGroup;
                v1.set(startArr[startIdx * 3], startArr[startIdx * 3 + 1], startArr[startIdx * 3 + 2]);
                v1.applyMatrix4(startGroup.matrixWorld);
              }

              const distance = v1.distanceTo(v2);
              const midpoint = new THREE.Vector3().addVectors(v1, v2).multiplyScalar(0.5);
              bolt.position.copy(midpoint);
              bolt.lookAt(v2);
              bolt.rotateX(Math.PI / 2);
              bolt.scale.set(1, distance, 1);
              bolt.visible = true;
              (bolt.material as THREE.MeshBasicMaterial).opacity = 1.0;
            }
          } else if (!isSpeaking) {
            if (boltLife[i] <= 0) bolt.visible = false;
          }
        }
      }

      // Pulse bloom intensity
      if (bloomPass) {
        bloomPass.strength = 1.2 + bass * 1.5;
        bloomPass.radius = 0.6 + mid * 0.2;
      }

      composer.render();
    };

    const init = () => {
      setupScene();
      resizeShape(false);
      render();
      window.addEventListener("resize", onResize);
    };

    init();

    return () => {
      cancelAnimationFrame(animationId);
      controls.dispose();
      renderer.domElement.remove();
      window.removeEventListener("resize", onResize);
    };
  }, []); // Run once on mount

  return <div ref={mountRef} style={{ width: '100vw', height: '100vh', overflow: 'hidden' }} />;
};

export default SphereScene;
