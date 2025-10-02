"use client";

import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

const SphereScene: React.FC = () => {
  const mountRef = useRef<HTMLDivElement>(null);
  const outerPositionsRef = useRef<Float32Array>(new Float32Array());
  const outerGeometryRef = useRef<THREE.BufferGeometry>(new THREE.BufferGeometry());

  useEffect(() => {
    if (!mountRef.current) return;

    let scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer, particleGroup: THREE.Group, innerParticleGroup: THREE.Group, composer: typeof EffectComposer, controls: typeof OrbitControls;
    let animationId: number;
    let time = 0;
    const particleCount = 5000; // Number of particles for outer sphere
    const innerParticleCount = 2000; // Fewer for inner sphere

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

      // Outer particle system
      const outerPositionsArray = new Float32Array(particleCount * 3);
      const outerColors = new Float32Array(particleCount * 3);

      for (let i = 0; i < particleCount; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 1;

        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi);

        outerPositionsArray[i * 3] = x;
        outerPositionsArray[i * 3 + 1] = y;
        outerPositionsArray[i * 3 + 2] = z;

        outerColors[i * 3] = 0.0 + Math.random() * 0.1; // Low red
        outerColors[i * 3 + 1] = 0.8 + Math.random() * 0.2; // High green
        outerColors[i * 3 + 2] = 0.0 + Math.random() * 0.1; // Low blue
      }

      outerGeometryRef.current.setAttribute('position', new THREE.BufferAttribute(outerPositionsArray, 3));
      outerGeometryRef.current.setAttribute('color', new THREE.BufferAttribute(outerColors, 3));
      outerPositionsRef.current = outerPositionsArray;

      const outerMaterial = new THREE.PointsMaterial({
        size: 0.02,
        vertexColors: true,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending
      });

      const outerParticles = new THREE.Points(outerGeometryRef.current, outerMaterial);
      particleGroup = new THREE.Group();
      particleGroup.add(outerParticles);
      scene.add(particleGroup);

      // Inner particle system
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

        innerColors[i * 3] = 0.0 + Math.random() * 0.1; // Low red
        innerColors[i * 3 + 1] = 0.6 + Math.random() * 0.2; // Medium-high green
        innerColors[i * 3 + 2] = 0.0 + Math.random() * 0.1; // Low blue
      }

      const innerGeometry = new THREE.BufferGeometry();
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
      particleGroup.add(innerParticleGroup); // Nested inside outer group for shared rotation
      scene.add(particleGroup);

      const ambientLight = new THREE.AmbientLight(0x101010, 0.1);
      scene.add(ambientLight);

      composer = new EffectComposer(renderer);
      const renderPass = new RenderPass(scene, camera);
      composer.addPass(renderPass);
      const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        1.2,
        0.6,
        0.3
      );
      composer.addPass(bloomPass);
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

    const render = () => {
      time += 0.016;
      animationId = requestAnimationFrame(render);
      
      controls.update();
      
      if (outerPositionsRef.current && outerGeometryRef.current) {
        const outerPositions = outerPositionsRef.current;
        for (let i = 0; i < particleCount; i++) {
          const idx = i * 3;
          let x = outerPositions[idx];
          let y = outerPositions[idx + 1];
          let z = outerPositions[idx + 2];

          const noiseX = Math.sin(time * 2.5 + i * 0.01) * 0.08;
          const noiseY = Math.cos(time * 3.2 + i * 0.015) * 0.08;
          const noiseZ = Math.sin(time * 1.8 + i * 0.02) * 0.08;

          x += noiseX;
          y += noiseY;
          z += noiseZ;

          const len = Math.sqrt(x * x + y * y + z * z);
          if (len > 0) {
            x = (x / len) * 1.0;
            y = (y / len) * 1.0;
            z = (z / len) * 1.0;
          }

          outerPositions[idx] = x;
          outerPositions[idx + 1] = y;
          outerPositions[idx + 2] = z;
        }
        outerGeometryRef.current.attributes.position.needsUpdate = true;
      }
      
      particleGroup.scale.setScalar(1 + Math.sin(time * 1.5) * 0.05);
      
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
  }, []);

  return <div ref={mountRef} style={{ width: '100vw', height: '100vh', overflow: 'hidden' }} />;
};

export default SphereScene;
