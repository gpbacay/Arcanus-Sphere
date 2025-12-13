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
    const innerParticleCount = 2000;

    // Lightning effect variables
    const lightningBolts: THREE.Mesh[] = [];
    const maxLightningConnections = 60; // Increased slightly for branching
    const lightningThickness = 0.002;
    const boltLife: number[] = new Array(maxLightningConnections).fill(0);
    const boltMaxLifes: number[] = new Array(maxLightningConnections).fill(1);
    const boltTrackData: { startIdx: number; endIdx: number; startLayer: 'inner' | 'middle'; endLayer: 'inner' | 'middle' }[] = new Array(maxLightningConnections).fill(null);

    // Chain reaction state
    const lastTargetIdx = { current: -1 };
    const lastTargetLayer = { current: 'inner' as 'inner' | 'middle' };
    const branchCounter = { current: 0 }; // How many bolts can spawn from the current tip

    // To store geometries for access in render loop
    let middleGeometry: THREE.BufferGeometry;
    let innerGeometry: THREE.BufferGeometry;

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
      const innerSphereGeometry = new THREE.SphereGeometry(0.15, 64, 64);
      const innerSphereMaterial = new THREE.MeshBasicMaterial({
        color: 0x6e8efb,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending
      });
      innerSphere = new THREE.Mesh(innerSphereGeometry, innerSphereMaterial);
      scene.add(innerSphere);

      // Create middle particle sphere layer
      const middleParticleCount = 1500;
      const middlePositionsArray = new Float32Array(middleParticleCount * 3);
      const middleColors = new Float32Array(middleParticleCount * 3);

      for (let i = 0; i < middleParticleCount; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 0.43;

        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi);

        middlePositionsArray[i * 3] = x;
        middlePositionsArray[i * 3 + 1] = y;
        middlePositionsArray[i * 3 + 2] = z;

        middleColors[i * 3] = 0.0 + Math.random() * 0.1;
        middleColors[i * 3 + 1] = 0.7 + Math.random() * 0.2;
        middleColors[i * 3 + 2] = 0.0 + Math.random() * 0.1;
      }

      middleGeometry = new THREE.BufferGeometry();
      middleGeometry.setAttribute('position', new THREE.BufferAttribute(middlePositionsArray, 3));
      middleGeometry.setAttribute('color', new THREE.BufferAttribute(middleColors, 3));

      const middleMaterial = new THREE.PointsMaterial({
        size: 0.012,
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

      const innerPositionsArray = new Float32Array(innerParticleCount * 3);
      const innerColors = new Float32Array(innerParticleCount * 3);

      for (let i = 0; i < innerParticleCount; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 0.6;

        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi);

        innerPositionsArray[i * 3] = x;
        innerPositionsArray[i * 3 + 1] = y;
        innerPositionsArray[i * 3 + 2] = z;

        innerColors[i * 3] = 0.0 + Math.random() * 0.1;
        innerColors[i * 3 + 1] = 0.6 + Math.random() * 0.2;
        innerColors[i * 3 + 2] = 0.0 + Math.random() * 0.1;
      }

      innerGeometry = new THREE.BufferGeometry();
      innerGeometry.setAttribute('position', new THREE.BufferAttribute(innerPositionsArray, 3));
      innerGeometry.setAttribute('color', new THREE.BufferAttribute(innerColors, 3));

      const innerMaterial = new THREE.PointsMaterial({
        size: 0.015,
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
      time += 0.016;
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
      const midScale = 1 + mid * 0.5;
      const trebleScale = 1 + treble * 0.5;

      // Calculate expansion state
      // We use vocalScale as the primary driver for the "Orb perception"
      const vocalScale = 1 + (mid * 0.8 + treble * 0.5);
      const currentScale = vocalScale;
      // Delta
      const scaleDelta = currentScale - prevScaleRef.current;
      const isExpanding = scaleDelta > 0.001; // Positive threshold
      // const isShrinking = scaleDelta < -0.001; 
      prevScaleRef.current = currentScale;

      // Animate inner solid sphere
      if (innerSphere) {
        // Scale with vocal/treble
        innerSphere.scale.setScalar(vocalScale * 0.9);
        // Pulse opacity
        (innerSphere.material as THREE.MeshBasicMaterial).opacity = 0.6 + bass * 0.3;
        // Color
        const r = 110 + bass * 100;
        const g = 142 + mid * 80;
        const b = 251 - treble * 100;
        (innerSphere.material as THREE.MeshBasicMaterial).color.setRGB(r / 255, g / 255, b / 255);

        // Random Rotation
        innerSphere.rotation.x += innerRotVel.x + (bass * 0.01 * Math.sign(innerRotVel.x));
        innerSphere.rotation.y += innerRotVel.y + (bass * 0.01 * Math.sign(innerRotVel.y));
        innerSphere.rotation.z += innerRotVel.z + (bass * 0.01 * Math.sign(innerRotVel.z));
      }

      // Inner particles
      if (innerParticleGroup) {
        innerParticleGroup.scale.setScalar(bassScale);
        innerParticleGroup.rotation.x += innerRotVel.x + (bass * 0.01 * Math.sign(innerRotVel.x));
        innerParticleGroup.rotation.y += innerRotVel.y + (bass * 0.01 * Math.sign(innerRotVel.y));
        innerParticleGroup.rotation.z += innerRotVel.z + (bass * 0.01 * Math.sign(innerRotVel.z));
      }

      // Middle particles
      if (middleParticleGroup) {
        const middleScale = bassScale * 0.95 + midScale * 0.3;
        middleParticleGroup.scale.setScalar(middleScale);
        middleParticleGroup.rotation.x += middleRotVel.x + (mid * 0.01 * Math.sign(middleRotVel.x));
        middleParticleGroup.rotation.y += middleRotVel.y + (mid * 0.01 * Math.sign(middleRotVel.y));
        middleParticleGroup.rotation.z += middleRotVel.z + (mid * 0.01 * Math.sign(middleRotVel.z));
      }

      // Update Lightning Effect
      if (middleParticleGroup && innerParticleGroup && middleGeometry && innerGeometry) {
        const middlePositions = middleGeometry.attributes.position.array as Float32Array;
        const innerPositions = innerGeometry.attributes.position.array as Float32Array;

        middleParticleGroup.updateMatrixWorld();
        innerParticleGroup.updateMatrixWorld();

        const totalVolume = bass + mid + treble;
        const isSpeaking = totalVolume > 0.1;

        // Activation Logic: Speaking AND Expanding
        const shouldSpike = isSpeaking && isExpanding;

        // Active count based on volume
        const activeConnections = shouldSpike ? Math.floor(Math.min(maxLightningConnections, bass * 150)) : 0;

        for (let i = 0; i < maxLightningConnections; i++) {
          const bolt = lightningBolts[i];
          if (!bolt) continue;

          // Update active bolts
          if (boltLife[i] > 0 && boltTrackData[i]) {
            if (!shouldSpike) {
              // If we stopped speaking/expanding, kill bolts faster?
              boltLife[i] -= 2; // Decay faster
            } else {
              boltLife[i]--;
            }

            if (boltLife[i] <= 0) {
              bolt.visible = false;
              // Don't continue here, let the spawn block handle reuse if needed, or let it stay dead
            } else {
              // Fade
              const lifeRatio = boltLife[i] / (boltMaxLifes[i] || 1);
              const opacity = Math.pow(lifeRatio, 1.5) * 0.8;
              (bolt.material as THREE.MeshBasicMaterial).opacity = opacity;

              // Position Update
              const data = boltTrackData[i];
              const v1 = new THREE.Vector3();
              const v2 = new THREE.Vector3();

              const startArr = data.startLayer === 'inner' ? innerPositions : middlePositions;
              const startGroup = data.startLayer === 'inner' ? innerParticleGroup : middleParticleGroup;
              v1.set(startArr[data.startIdx * 3], startArr[data.startIdx * 3 + 1], startArr[data.startIdx * 3 + 2]);
              v1.applyMatrix4(startGroup.matrixWorld);

              const endArr = data.endLayer === 'inner' ? innerPositions : middlePositions;
              const endGroup = data.endLayer === 'inner' ? innerParticleGroup : middleParticleGroup;
              v2.set(endArr[data.endIdx * 3], endArr[data.endIdx * 3 + 1], endArr[data.endIdx * 3 + 2]);
              v2.applyMatrix4(endGroup.matrixWorld);

              const distance = v1.distanceTo(v2);
              const midpoint = new THREE.Vector3().addVectors(v1, v2).multiplyScalar(0.5);
              bolt.position.copy(midpoint);
              bolt.lookAt(v2);
              bolt.rotateX(Math.PI / 2);
              bolt.scale.set(1, distance, 1);
              bolt.visible = true;

              continue; // Done with this bolt for this frame
            }
          }

          // Spawn Block
          // Only spawn if valid condition and slot is available
          if (i < activeConnections && boltLife[i] <= 0 && shouldSpike) {

            // Chance to spawn
            // If we have high bass, higher chance
            if (Math.random() > 0.05) {

              // Branching Logic
              // If branchCounter > 0, we MUST use the previous target to start.
              // If NOT, we can decide to start a new chain or continue normally.

              let useChain = (branchCounter.current > 0) || (lastTargetIdx.current !== -1 && Math.random() < 0.8);
              let isBranchingEvent = false;

              // Start / End Setup
              let startIdx = 0;
              let endIdx = 0;
              let startLayer: 'inner' | 'middle' = 'inner';
              let endLayer: 'inner' | 'middle' = 'inner';

              if (useChain && lastTargetIdx.current !== -1) {
                // Continue from last
                startIdx = lastTargetIdx.current;
                startLayer = lastTargetLayer.current;
                endLayer = startLayer === 'inner' ? 'middle' : 'inner';

                // If we are consuming a branch count
                if (branchCounter.current > 0) {
                  branchCounter.current--;
                }

              } else {
                // New random start
                startIdx = Math.floor(Math.random() * (middlePositions.length / 3));
                startLayer = 'middle';
                endLayer = 'inner';

                // Reset branching for this new chain
                branchCounter.current = 0;
              }

              // Pick random end
              if (endLayer === 'inner') {
                endIdx = Math.floor(Math.random() * (innerPositions.length / 3));
              } else {
                endIdx = Math.floor(Math.random() * (middlePositions.length / 3));
              }

              // Check if this new link causes a branching burst for FUTURE links
              // High energy = high branching possibility
              // If bass is high, we set branchCounter
              if (bass > 0.3 && Math.random() < 0.3) {
                // Next 2-4 bolts will use THIS endIdx as start
                const extraBranches = Math.floor(Math.random() * 3) + 2;
                branchCounter.current = extraBranches;
              }

              // Update State
              boltTrackData[i] = { startIdx, endIdx, startLayer, endLayer };
              lastTargetIdx.current = endIdx;
              lastTargetLayer.current = endLayer;

              // Init Life
              const newLife = Math.floor(Math.random() * 30) + 10;
              boltLife[i] = newLife;
              boltMaxLifes[i] = newLife;

              // Instant Position Set (Prevent flicker)
              const v1 = new THREE.Vector3();
              const v2 = new THREE.Vector3();
              const startArr = startLayer === 'inner' ? innerPositions : middlePositions;
              const startGroup = startLayer === 'inner' ? innerParticleGroup : middleParticleGroup;
              v1.set(startArr[startIdx * 3], startArr[startIdx * 3 + 1], startArr[startIdx * 3 + 2]);
              v1.applyMatrix4(startGroup.matrixWorld);

              const endArr = endLayer === 'inner' ? innerPositions : middlePositions;
              const endGroup = endLayer === 'inner' ? innerParticleGroup : middleParticleGroup;
              v2.set(endArr[endIdx * 3], endArr[endIdx * 3 + 1], endArr[endIdx * 3 + 2]);
              v2.applyMatrix4(endGroup.matrixWorld);

              const distance = v1.distanceTo(v2);
              const midpoint = new THREE.Vector3().addVectors(v1, v2).multiplyScalar(0.5);
              bolt.position.copy(midpoint);
              bolt.lookAt(v2);
              bolt.rotateX(Math.PI / 2);
              bolt.scale.set(1, distance, 1);
              bolt.visible = true;
              (bolt.material as THREE.MeshBasicMaterial).opacity = 1.0;
            }
          } else if (!shouldSpike) {
            // Ensure force hide if shouldSpike is false and not already handled
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
