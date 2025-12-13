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

  // Update the ref whenever the prop changes so the render loop has access to the latest analyser
  useEffect(() => {
    analyserRef.current = analyser;
  }, [analyser]);

  useEffect(() => {
    if (!mountRef.current) return;

    let scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer, ringGroup1: THREE.Group, innerParticleGroup: THREE.Group, middleParticleGroup: THREE.Group, composer: EffectComposer, controls: OrbitControls;
    let bloomPass: UnrealBloomPass;
    let innerSphere: THREE.Mesh;
    let animationId: number;
    let time = 0;
    const particleCount = 1000;
    const innerParticleCount = 2000;

    // Lightning effect variables
    const lightningBolts: THREE.Mesh[] = [];
    const maxLightningConnections = 50;
    const lightningThickness = 0.002; // Thinner
    const boltLife: number[] = new Array(maxLightningConnections).fill(0);
    const boltMaxLifes: number[] = new Array(maxLightningConnections).fill(1);
    const boltTrackData: { startIdx: number; endIdx: number; startLayer: 'inner' | 'middle'; endLayer: 'inner' | 'middle' }[] = new Array(maxLightningConnections).fill(null);

    // Chain reaction state
    const lastChainPos = { current: null as THREE.Vector3 | null };
    const lastTargetLayer = { current: 'inner' as 'inner' | 'middle' }; // The layer the LAST bolt ended on
    const lastTargetIdx = { current: -1 }; // Track index for chain continuity

    const ringRadius = 0.5;
    const ringTube = 0.01;
    const ringArc = Math.PI * 2;

    let ringGroup2: THREE.Group, ringGroup3: THREE.Group;
    let middleRingGroup1: THREE.Group, middleRingGroup2: THREE.Group;

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

      // Create inner glowing sphere (solid core)
      const innerSphereGeometry = new THREE.SphereGeometry(0.25, 64, 64);
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

      const outerRingPositions = new Float32Array(particleCount * 3);
      const outerRingColors = new Float32Array(particleCount * 3);

      for (let i = 0; i < particleCount; i++) {
        const u = (i / particleCount) * ringArc;

        const x = ringRadius * Math.cos(u);
        const y = ringRadius * Math.sin(u);
        const z = (Math.random() - 0.5) * ringTube;

        const position = new THREE.Vector3(x, y, z);

        outerRingPositions[i * 3] = position.x;
        outerRingPositions[i * 3 + 1] = position.y;
        outerRingPositions[i * 3 + 2] = position.z;

        outerRingColors[i * 3] = 0.0 + Math.random() * 0.1;
        outerRingColors[i * 3 + 1] = 0.7 + Math.random() * 0.2;
        outerRingColors[i * 3 + 2] = 0.0 + Math.random() * 0.1;
      }

      const outerRingGeometry = new THREE.BufferGeometry();
      outerRingGeometry.setAttribute('position', new THREE.BufferAttribute(outerRingPositions, 3));
      outerRingGeometry.setAttribute('color', new THREE.BufferAttribute(outerRingColors, 3));

      const outerRingMaterial = new THREE.PointsMaterial({
        size: 0.02,
        vertexColors: true,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending
      });

      const outerRingParticles = new THREE.Points(outerRingGeometry, outerRingMaterial);
      ringGroup1 = new THREE.Group();
      ringGroup1.add(outerRingParticles);
      scene.add(ringGroup1);

      const outerRingPositions2 = new Float32Array(particleCount * 3);
      const outerRingColors2 = new Float32Array(particleCount * 3);

      for (let i = 0; i < particleCount; i++) {
        const u = (i / particleCount) * ringArc;
        const x = ringRadius * Math.cos(u);
        const y = ringRadius * Math.sin(u);
        const z = (Math.random() - 0.5) * ringTube;
        const position = new THREE.Vector3(x, y, z);
        outerRingPositions2[i * 3] = position.x;
        outerRingPositions2[i * 3 + 1] = position.y;
        outerRingPositions2[i * 3 + 2] = position.z;
        outerRingColors2[i * 3] = 0.0 + Math.random() * 0.1;
        outerRingColors2[i * 3 + 1] = 0.7 + Math.random() * 0.2;
        outerRingColors2[i * 3 + 2] = 0.0 + Math.random() * 0.1;
      }

      const outerRingGeometry2 = new THREE.BufferGeometry();
      outerRingGeometry2.setAttribute('position', new THREE.BufferAttribute(outerRingPositions2, 3));
      outerRingGeometry2.setAttribute('color', new THREE.BufferAttribute(outerRingColors2, 3));

      const outerRingMaterial2 = new THREE.PointsMaterial({
        size: 0.02,
        vertexColors: true,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending
      });

      const outerRingParticles2 = new THREE.Points(outerRingGeometry2, outerRingMaterial2);
      ringGroup2 = new THREE.Group();
      ringGroup2.add(outerRingParticles2);
      scene.add(ringGroup2);

      const outerRingPositions3 = new Float32Array(particleCount * 3);
      const outerRingColors3 = new Float32Array(particleCount * 3);

      for (let i = 0; i < particleCount; i++) {
        const u = (i / particleCount) * ringArc;
        const x = ringRadius * Math.cos(u);
        const y = ringRadius * Math.sin(u);
        const z = (Math.random() - 0.5) * ringTube;
        const position = new THREE.Vector3(x, y, z);
        outerRingPositions3[i * 3] = position.x;
        outerRingPositions3[i * 3 + 1] = position.y;
        outerRingPositions3[i * 3 + 2] = position.z;
        outerRingColors3[i * 3] = 0.0 + Math.random() * 0.1;
        outerRingColors3[i * 3 + 1] = 0.7 + Math.random() * 0.2;
        outerRingColors3[i * 3 + 2] = 0.0 + Math.random() * 0.1;
      }

      const outerRingGeometry3 = new THREE.BufferGeometry();
      outerRingGeometry3.setAttribute('position', new THREE.BufferAttribute(outerRingPositions3, 3));
      outerRingGeometry3.setAttribute('color', new THREE.BufferAttribute(outerRingColors3, 3));

      const outerRingMaterial3 = new THREE.PointsMaterial({
        size: 0.02,
        vertexColors: true,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending
      });

      const outerRingParticles3 = new THREE.Points(outerRingGeometry3, outerRingMaterial3);
      ringGroup3 = new THREE.Group();
      ringGroup3.add(outerRingParticles3);
      scene.add(ringGroup3);

      // Create rings for the middle particle sphere (secondary sphere)
      const middleRingRadius = 0.25; // Smaller radius for middle sphere rings
      const middleRingTube = 0.008; // Slightly smaller tube

      // First middle sphere ring
      const middleRingPositions1 = new Float32Array(particleCount * 3);
      const middleRingColors1 = new Float32Array(particleCount * 3);

      for (let i = 0; i < particleCount; i++) {
        const u = (i / particleCount) * ringArc;
        const x = middleRingRadius * Math.cos(u);
        const y = middleRingRadius * Math.sin(u);
        const z = (Math.random() - 0.5) * middleRingTube;
        const position = new THREE.Vector3(x, y, z);

        middleRingPositions1[i * 3] = position.x;
        middleRingPositions1[i * 3 + 1] = position.y;
        middleRingPositions1[i * 3 + 2] = position.z;

        middleRingColors1[i * 3] = 0.1 + Math.random() * 0.2; // Slightly different color range
        middleRingColors1[i * 3 + 1] = 0.8 + Math.random() * 0.2;
        middleRingColors1[i * 3 + 2] = 0.1 + Math.random() * 0.2;
      }

      const middleRingGeometry1 = new THREE.BufferGeometry();
      middleRingGeometry1.setAttribute('position', new THREE.BufferAttribute(middleRingPositions1, 3));
      middleRingGeometry1.setAttribute('color', new THREE.BufferAttribute(middleRingColors1, 3));

      const middleRingMaterial1 = new THREE.PointsMaterial({
        size: 0.015, // Smaller particles for middle rings
        vertexColors: true,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending
      });

      const middleRingParticles1 = new THREE.Points(middleRingGeometry1, middleRingMaterial1);
      middleRingGroup1 = new THREE.Group();
      middleRingGroup1.add(middleRingParticles1);
      scene.add(middleRingGroup1);

      // Second middle sphere ring
      const middleRingPositions2 = new Float32Array(particleCount * 3);
      const middleRingColors2 = new Float32Array(particleCount * 3);

      for (let i = 0; i < particleCount; i++) {
        const u = (i / particleCount) * ringArc;
        const x = middleRingRadius * Math.cos(u);
        const y = middleRingRadius * Math.sin(u);
        const z = (Math.random() - 0.5) * middleRingTube;
        const position = new THREE.Vector3(x, y, z);

        middleRingPositions2[i * 3] = position.x;
        middleRingPositions2[i * 3 + 1] = position.y;
        middleRingPositions2[i * 3 + 2] = position.z;

        middleRingColors2[i * 3] = 0.1 + Math.random() * 0.2;
        middleRingColors2[i * 3 + 1] = 0.8 + Math.random() * 0.2;
        middleRingColors2[i * 3 + 2] = 0.1 + Math.random() * 0.2;
      }

      const middleRingGeometry2 = new THREE.BufferGeometry();
      middleRingGeometry2.setAttribute('position', new THREE.BufferAttribute(middleRingPositions2, 3));
      middleRingGeometry2.setAttribute('color', new THREE.BufferAttribute(middleRingColors2, 3));

      const middleRingMaterial2 = new THREE.PointsMaterial({
        size: 0.015,
        vertexColors: true,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending
      });

      const middleRingParticles2 = new THREE.Points(middleRingGeometry2, middleRingMaterial2);
      middleRingGroup2 = new THREE.Group();
      middleRingGroup2.add(middleRingParticles2);
      scene.add(middleRingGroup2);

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

      // Setup Lightning Bolts (using Cylinders for thickness)
      const boltHeight = 1;
      const boltGeometry = new THREE.CylinderGeometry(lightningThickness, lightningThickness, boltHeight, 6);

      for (let i = 0; i < maxLightningConnections; i++) {
        // Individual material for each bolt to allow independent fading
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

    // Random speed multipliers for each ring (persistent across frames)
    const ring1SpeedMultiplier = 0.7 + Math.random() * 0.6; // 0.7-1.3
    const ring2SpeedMultiplier = 0.8 + Math.random() * 0.8; // 0.8-1.6
    const ring3SpeedMultiplier = 0.6 + Math.random() * 0.7; // 0.6-1.3
    const ring1RotationSpeed = 0.003 + Math.random() * 0.007; // 0.003-0.01
    const ring2RotationSpeed = 0.004 + Math.random() * 0.006; // 0.004-0.01
    const ring3RotationSpeed = 0.005 + Math.random() * 0.008; // 0.005-0.013

    // Random speed multipliers for middle sphere rings
    const middleRing1SpeedMultiplier = 1.2 + Math.random() * 0.8; // 1.2-2.0 (faster)
    const middleRing2SpeedMultiplier = 1.0 + Math.random() * 0.7; // 1.0-1.7
    const middleRing1RotationSpeed = 0.008 + Math.random() * 0.012; // 0.008-0.02
    const middleRing2RotationSpeed = 0.006 + Math.random() * 0.01; // 0.006-0.016

    const render = () => {
      time += 0.016;
      animationId = requestAnimationFrame(render);

      controls.update();

      let bass = 0;
      let mid = 0;
      let treble = 0;

      if (analyserRef.current) {
        analyserRef.current.getByteFrequencyData(dataArray);
        // Bass: 0-10 (approx 0-800Hz)
        bass = getAverage(dataArray, 0, 10) / 255;
        // Mid: 10-80 (approx 800Hz-6kHz)
        mid = getAverage(dataArray, 10, 80) / 255;
        // Treble: 80-200 (approx 6kHz-16kHz)
        treble = getAverage(dataArray, 80, 200) / 255;
      }

      // Dynamic scaling based on frequency bands
      const bassScale = 1 + bass * 0.8;
      const midScale = 1 + mid * 0.5;
      const trebleScale = 1 + treble * 0.5;

      // Animate inner solid sphere
      if (innerSphere) {
        // Scale with bass
        innerSphere.scale.setScalar(bassScale * 0.9);
        // Pulse opacity with bass
        (innerSphere.material as THREE.MeshBasicMaterial).opacity = 0.6 + bass * 0.3;
        // Change color based on frequencies
        const r = 110 + bass * 100;
        const g = 142 + mid * 80;
        const b = 251 - treble * 100;
        (innerSphere.material as THREE.MeshBasicMaterial).color.setRGB(r / 255, g / 255, b / 255);
        // Slow rotation
        innerSphere.rotation.y += 0.002;
        innerSphere.rotation.x += 0.001;
      }

      // Apply scaling to inner particle sphere and rings
      if (innerParticleGroup) {
        innerParticleGroup.scale.setScalar(bassScale);
        // Add subtle rotation based on bass
        innerParticleGroup.rotation.y += 0.005 + bass * 0.05;
        innerParticleGroup.rotation.z += bass * 0.02;
      }

      // Animate middle particle sphere
      if (middleParticleGroup) {
        // Scale with a blend of bass and mid frequencies
        const middleScale = bassScale * 0.95 + midScale * 0.3;
        middleParticleGroup.scale.setScalar(middleScale);
        // Rotate opposite direction from outer sphere
        middleParticleGroup.rotation.y -= 0.004 + mid * 0.03;
        middleParticleGroup.rotation.x += 0.002 + treble * 0.02;
      }

      // Rings must always be at least as large as the orb (bassScale)
      if (ringGroup1) {
        // Ensure ring is at least as large as the orb, plus its own mid frequency response
        const ring1Scale = Math.max(bassScale, bassScale + midScale * 0.3);
        ringGroup1.scale.setScalar(ring1Scale);

        // Animate the outer curved ring around the inner sphere with random speed
        const orbitRadius = 0.6;
        ringGroup1.position.x = Math.cos(time * 0.5 * ring1SpeedMultiplier) * orbitRadius * 0.5;
        ringGroup1.position.z = Math.sin(time * 0.5 * ring1SpeedMultiplier) * orbitRadius * 0.5;
        ringGroup1.lookAt(new THREE.Vector3(0, 0, 0));
        ringGroup1.position.y = Math.sin(time * 1.5 * ring1SpeedMultiplier) * 0.1;
        // Add extra rotation from mid with random speed
        ringGroup1.rotation.z += ring1RotationSpeed + mid * 0.05;
      }

      if (ringGroup2) {
        // Ensure ring is at least as large as the orb, plus its own treble frequency response
        const ring2Scale = Math.max(bassScale, bassScale + trebleScale * 0.3);
        ringGroup2.scale.setScalar(ring2Scale);

        // Animate second ring with random speed
        ringGroup2.rotation.x += ring2RotationSpeed + treble * 0.05;
        ringGroup2.position.x = Math.cos(time * 0.7 * ring2SpeedMultiplier) * 0.6 * 0.6;
        ringGroup2.position.y = Math.sin(time * 0.7 * ring2SpeedMultiplier) * 0.6 * 0.6;
        ringGroup2.lookAt(new THREE.Vector3(0, 0, 0));
      }

      if (ringGroup3) {
        // Ensure ring is at least as large as the orb, plus combined bass+treble response
        const ring3Scale = Math.max(bassScale, bassScale + (bass + treble) * 0.3);
        ringGroup3.scale.setScalar(ring3Scale);

        // Animate third ring with random speed
        ringGroup3.rotation.z += ring3RotationSpeed + mid * 0.02;
        ringGroup3.position.y = Math.cos(time * 0.9 * ring3SpeedMultiplier) * 0.6 * 0.7;
        ringGroup3.position.z = Math.sin(time * 0.9 * ring3SpeedMultiplier) * 0.6 * 0.7;
        ringGroup3.lookAt(new THREE.Vector3(0, 0, 0));
      }

      // Animate middle sphere rings (orbit around middle particle sphere)
      if (middleRingGroup1 && middleParticleGroup) {
        // Scale with mid frequencies
        const middleScale = bassScale * 0.95 + midScale * 0.3;
        const middleRing1Scale = (1 + mid * 0.4) * middleScale;
        middleRingGroup1.scale.setScalar(middleRing1Scale);

        // Orbit around the middle particle sphere
        const middleSpherePos = middleParticleGroup.position;
        const orbitRadius = 0.35; // Distance from middle sphere center

        middleRingGroup1.position.x = middleSpherePos.x + Math.cos(time * 0.8 * middleRing1SpeedMultiplier) * orbitRadius;
        middleRingGroup1.position.y = middleSpherePos.y + Math.sin(time * 0.8 * middleRing1SpeedMultiplier) * orbitRadius * 0.3;
        middleRingGroup1.position.z = middleSpherePos.z + Math.cos(time * 1.2 * middleRing1SpeedMultiplier) * orbitRadius * 0.2;

        // Face toward the middle sphere center
        middleRingGroup1.lookAt(middleSpherePos);
        // Add rotation
        middleRingGroup1.rotation.z += middleRing1RotationSpeed + treble * 0.03;
      }

      if (middleRingGroup2 && middleParticleGroup) {
        // Scale with treble frequencies
        const middleScale = bassScale * 0.95 + midScale * 0.3;
        const middleRing2Scale = (1 + treble * 0.5) * middleScale;
        middleRingGroup2.scale.setScalar(middleRing2Scale);

        // Orbit around the middle particle sphere in opposite direction
        const middleSpherePos = middleParticleGroup.position;
        const orbitRadius = 0.28; // Slightly smaller orbit

        middleRingGroup2.position.x = middleSpherePos.x + Math.cos(-time * 0.6 * middleRing2SpeedMultiplier) * orbitRadius;
        middleRingGroup2.position.y = middleSpherePos.y + Math.sin(-time * 0.6 * middleRing2SpeedMultiplier) * orbitRadius * 0.4;
        middleRingGroup2.position.z = middleSpherePos.z + Math.sin(time * 0.9 * middleRing2SpeedMultiplier) * orbitRadius * 0.3;

        // Face toward the middle sphere center
        middleRingGroup2.lookAt(middleSpherePos);
        // Add rotation
        middleRingGroup2.rotation.x += middleRing2RotationSpeed + bass * 0.02;
      }

      // Update Lightning Effect
      if (middleParticleGroup && innerParticleGroup && middleGeometry && innerGeometry) {
        const middlePositions = middleGeometry.attributes.position.array as Float32Array;
        const innerPositions = innerGeometry.attributes.position.array as Float32Array;

        middleParticleGroup.updateMatrixWorld();
        innerParticleGroup.updateMatrixWorld();

        const activeConnections = Math.floor(Math.min(maxLightningConnections, 10 + bass * 100));

        for (let i = 0; i < maxLightningConnections; i++) {
          const bolt = lightningBolts[i];
          if (!bolt) continue;

          // Update active bolts (Dynamic Length)
          if (boltLife[i] > 0 && boltTrackData[i]) {
            boltLife[i]--;
            // Faster fade: use squared falloff or faster life decay
            const lifeRatio = boltLife[i] / (boltMaxLifes[i] || 1);
            const opacity = Math.pow(lifeRatio, 1.5) * 0.8; // Quicker fade
            (bolt.material as THREE.MeshBasicMaterial).opacity = opacity;

            // Recalculate positions!
            const data = boltTrackData[i];
            const v1 = new THREE.Vector3();
            const v2 = new THREE.Vector3();

            // Get Start Pos
            const startArr = data.startLayer === 'inner' ? innerPositions : middlePositions;
            const startGroup = data.startLayer === 'inner' ? innerParticleGroup : middleParticleGroup;
            v1.set(startArr[data.startIdx * 3], startArr[data.startIdx * 3 + 1], startArr[data.startIdx * 3 + 2]);
            v1.applyMatrix4(startGroup.matrixWorld);

            // Get End Pos
            const endArr = data.endLayer === 'inner' ? innerPositions : middlePositions;
            const endGroup = data.endLayer === 'inner' ? innerParticleGroup : middleParticleGroup;
            v2.set(endArr[data.endIdx * 3], endArr[data.endIdx * 3 + 1], endArr[data.endIdx * 3 + 2]);
            v2.applyMatrix4(endGroup.matrixWorld);

            // Update Mesh
            const distance = v1.distanceTo(v2);
            const midpoint = new THREE.Vector3().addVectors(v1, v2).multiplyScalar(0.5);
            bolt.position.copy(midpoint);
            bolt.lookAt(v2);
            bolt.rotateX(Math.PI / 2);
            bolt.scale.set(1, distance, 1);
            bolt.visible = true;
          }

          // Spawn new bolt if dead
          if (i < activeConnections && boltLife[i] <= 0) {

            // Sustain chance
            if (Math.random() > 0.1) {

              // Chain Logic
              let useChain = lastTargetIdx.current !== -1 && Math.random() < 0.8;

              let startIdx = 0;
              let endIdx = 0;
              let startLayer: 'inner' | 'middle' = 'inner';
              let endLayer: 'inner' | 'middle' = 'inner';

              if (useChain) {
                // Start from previous end
                startIdx = lastTargetIdx.current;
                startLayer = lastTargetLayer.current; // The layer we ended on is now start layer
                // Target opposite
                endLayer = startLayer === 'inner' ? 'middle' : 'inner';
              } else {
                // Random Start on Middle
                startIdx = Math.floor(Math.random() * (middlePositions.length / 3));
                startLayer = 'middle';
                endLayer = 'inner';
              }

              // Pick random end index on target layer
              if (endLayer === 'inner') {
                endIdx = Math.floor(Math.random() * (innerPositions.length / 3));
              } else {
                endIdx = Math.floor(Math.random() * (middlePositions.length / 3));
              }

              // Save Track Data
              boltTrackData[i] = { startIdx, endIdx, startLayer, endLayer };

              // Update Chain State
              lastTargetIdx.current = endIdx;
              lastTargetLayer.current = endLayer;

              // Faster life: 10-40 frames (0.16s - 0.6s)
              const newLife = Math.floor(Math.random() * 30) + 10;
              boltLife[i] = newLife;
              boltMaxLifes[i] = newLife;

              // Initial update will happen next frame (or we can duplicate update logic here to prevent 1-frame flickering, but simple is ok)
              // Actually, let's force an update now to ensure it appears in correct spot immediately
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

            } else {
              // Stay invisible
              bolt.visible = false;
              boltLife[i] = Math.floor(Math.random() * 10) + 5;
            }
          } else if (i >= activeConnections) {
            bolt.visible = false;
            boltLife[i] = 0;
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
