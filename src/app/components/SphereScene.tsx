"use client";

import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

interface SphereSceneProps {
  frequencyData: Uint8Array | null;
}

const SphereScene: React.FC<SphereSceneProps> = ({ frequencyData }) => {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mountRef.current) return;

    let scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer, ringGroup1: THREE.Group, innerParticleGroup: THREE.Group, composer: typeof EffectComposer, controls: typeof OrbitControls;
    let animationId: number;
    let time = 0;
    const particleCount = 1000;
    const innerParticleCount = 2000;

    const ringRadius = 0.5;
    const ringTube = 0.01;
    const ringArc = Math.PI * 2;

    let ringGroup2: THREE.Group, ringGroup3: THREE.Group;

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

        outerRingColors[i * 3] = 0.6 + Math.random() * 0.2;
        outerRingColors[i * 3 + 1] = 0.0 + Math.random() * 0.1;
        outerRingColors[i * 3 + 2] = 0.9 + Math.random() * 0.1;
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
        outerRingColors2[i * 3] = 0.6 + Math.random() * 0.2;
        outerRingColors2[i * 3 + 1] = 0.0 + Math.random() * 0.1;
        outerRingColors2[i * 3 + 2] = 0.9 + Math.random() * 0.1;
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
        outerRingColors3[i * 3] = 0.6 + Math.random() * 0.2;
        outerRingColors3[i * 3 + 1] = 0.0 + Math.random() * 0.1;
        outerRingColors3[i * 3 + 2] = 0.9 + Math.random() * 0.1;
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

      // Calculate average amplitude from frequencyData
      let averageAmplitude = 0;
      if (frequencyData) {
        for (let i = 0; i < frequencyData.length; i++) {
          averageAmplitude += frequencyData[i];
        }
        averageAmplitude /= frequencyData.length;
      }

      // Normalize amplitude to a smaller range for scaling (e.g., 0 to 1)
      const normalizedAmplitude = averageAmplitude / 255; // Max value for Uint8Array is 255
      const scaleFactor = 1 + normalizedAmplitude * 0.5; // Adjust 0.5 for desired visual effect

      // Apply scaling to inner sphere and rings
      if (innerParticleGroup) {
        innerParticleGroup.scale.setScalar(scaleFactor);
      }
      if (ringGroup1) {
        ringGroup1.scale.setScalar(scaleFactor);
      }
      if (ringGroup2) {
        ringGroup2.scale.setScalar(scaleFactor);
      }
      if (ringGroup3) {
        ringGroup3.scale.setScalar(scaleFactor);
      }

      // Animate the outer curved ring around the inner sphere
      const orbitRadius = 0.6;
      ringGroup1.position.x = Math.cos(time * 0.5) * orbitRadius * 0.5;
      ringGroup1.position.z = Math.sin(time * 0.5) * orbitRadius * 0.5;

      ringGroup1.lookAt(new THREE.Vector3(0, 0, 0));

      ringGroup1.position.y = Math.sin(time * 1.5) * 0.1;

      // Animate second ring
      ringGroup2.rotation.x += 0.005;
      ringGroup2.position.x = Math.cos(time * 0.7) * orbitRadius * 0.6;
      ringGroup2.position.y = Math.sin(time * 0.7) * orbitRadius * 0.6;
      ringGroup2.lookAt(new THREE.Vector3(0, 0, 0));

      // Animate third ring
      ringGroup3.rotation.z += 0.008;
      ringGroup3.position.y = Math.cos(time * 0.9) * orbitRadius * 0.7;
      ringGroup3.position.z = Math.sin(time * 0.9) * orbitRadius * 0.7;
      ringGroup3.lookAt(new THREE.Vector3(0, 0, 0));

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
  }, [frequencyData]);

  return <div ref={mountRef} style={{ width: '100vw', height: '100vh', overflow: 'hidden' }} />;
};

export default SphereScene;
