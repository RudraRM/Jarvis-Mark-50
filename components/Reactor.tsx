"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
export default function Reactor({
  active,
  level,
}: {
  active: boolean;
  level: number;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const energy = useRef({ active, level });
  useEffect(() => {
    energy.current = { active, level };
  }, [active, level]);
  useEffect(() => {
    const host = mount.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    const group = new THREE.Group();
    scene.add(group);
    group.rotation.x = 0.16;
    const cyan = new THREE.MeshStandardMaterial({
      color: 0x8df5ff,
      emissive: 0x28dfff,
      emissiveIntensity: 2,
      metalness: 0.7,
      roughness: 0.2,
    });
    const metal = new THREE.MeshStandardMaterial({
      color: 0x263944,
      metalness: 0.9,
      roughness: 0.3,
    });
    const ring = (r: number, t: number, z: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(r, t, 16, 120), mat);
      m.position.z = z;
      group.add(m);
      return m;
    };
    ring(1.7, 0.16, 0, metal);
    ring(1.48, 0.035, 0.16, cyan);
    ring(1.18, 0.12, 0.15, metal);
    ring(1.03, 0.035, 0.26, cyan);
    ring(0.76, 0.06, 0.2, metal);
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.35, 0.18), cyan);
      m.position.set(Math.sin(a) * 1.32, Math.cos(a) * 1.32, 0.12);
      m.rotation.z = -a;
      group.add(m);
    }
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.68, 0.68, 0.22, 64),
      cyan,
    );
    core.rotation.x = Math.PI / 2;
    group.add(core);
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.52);
    shape.lineTo(-0.46, -0.28);
    shape.lineTo(0.46, -0.28);
    shape.closePath();
    const triangle = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, {
        depth: 0.06,
        bevelEnabled: true,
        bevelSize: 0.035,
        bevelThickness: 0.02,
        bevelSegments: 2,
        steps: 1,
      }),
      new THREE.MeshBasicMaterial({ color: 0xe8ffff }),
    );
    triangle.position.z = 0.2;
    group.add(triangle);
    scene.add(new THREE.AmbientLight(0x8adfff, 3));
    const light = new THREE.PointLight(0xffffff, 80);
    light.position.set(2, 3, 5);
    scene.add(light);
    const positions = new Float32Array(1800);
    let seed = 42;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < positions.length; i++)
      positions[i] = (random() - 0.5) * 24;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const stars = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 0.018,
        color: 0x9cbec7,
        transparent: true,
        opacity: 0.65,
      }),
    );
    scene.add(stars);
    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    function animate(time: number) {
      frame = requestAnimationFrame(animate);
      const e = energy.current;
      if (!reduced) {
        group.rotation.z = Math.sin(time * 0.00025) * 0.08;
        group.rotation.y = Math.sin(time * 0.0003) * 0.18;
        stars.rotation.z = time * 0.000006;
      }
      const pulse = e.active
        ? 1 + Math.sin(time * 0.008) * 0.025 + e.level * 0.08
        : 1;
      group.scale.setScalar(pulse);
      cyan.emissiveIntensity = e.active
        ? 2.5 + Math.sin(time * 0.01) * 0.8
        : 1.5;
      renderer.render(scene, camera);
    }
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      host.replaceChildren();
    };
  }, []);
  return (
    <div
      className="reactor-canvas"
      ref={mount}
      role="img"
      aria-label="Glowing three-dimensional arc reactor in a star field"
    />
  );
}
