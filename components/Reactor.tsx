"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Dispose late loader results too: React Strict Mode can unmount during loading.
function disposeObject(root: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Points))
      return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    materials.forEach((material) => {
      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture) textures.add(value);
      });
      material.dispose();
    });
    if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
  });
  textures.forEach((texture) => {
    texture.dispose();
    if (
      typeof ImageBitmap !== "undefined" &&
      texture.image instanceof ImageBitmap
    )
      texture.image.close();
  });
}

// The supplied GLB has one atlas material. Mask only its chest aperture,
// preserving the native triangular shape and leaving eyes/armor unchanged.
function chestEmission(map: THREE.Texture) {
  const canvas = document.createElement("canvas");
  const image = map.image as HTMLImageElement | ImageBitmap;
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++)
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      const [r, g, b] = pixels.data.slice(i, i + 3);
      const inside =
        x / canvas.width > 0.55 &&
        x / canvas.width < 0.7 &&
        y / canvas.height > 0.14 &&
        y / canvas.height < 0.215;
      const strength =
        inside && g > 130 && b > 160 && (b > r * 1.15 || r > 210)
          ? Math.min(g, b) / 255
          : 0;
      pixels.data[i] = strength * 110;
      pixels.data[i + 1] = strength * 230;
      pixels.data[i + 2] = strength * 255;
    }
  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export default function Reactor({
  active,
  level,
}: {
  active: boolean;
  level: number;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const energy = useRef({ active, level });
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  useEffect(() => {
    energy.current = { active, level };
  }, [active, level]);
  useEffect(() => {
    const host = mount.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      setStatus("error");
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    const avatar = new THREE.Group();
    scene.add(avatar);
    avatar.scale.setScalar(1);
    avatar.position.y = 0.4;
    const reactor = new THREE.Group();
    avatar.add(reactor);
    // Measured against the normalized, five-unit-tall uploaded model.
    // This shallow insert follows the chest slope, inside the existing aperture.
    reactor.position.set(0, 1.29, 0.414);
    reactor.rotation.x = 0.397;
    reactor.scale.setScalar(0.041);
    reactor.visible = false;
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
      reactor.add(m);
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
      reactor.add(m);
    }
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.68, 0.68, 0.22, 64),
      cyan,
    );
    core.rotation.x = Math.PI / 2;
    reactor.add(core);
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
    reactor.add(triangle);

    const chestLight = new THREE.PointLight(0x66eaff, 0.04, 0.7, 2);
    chestLight.position.set(0, 1.29, 0.53);
    avatar.add(chestLight);
    scene.add(new THREE.HemisphereLight(0xe3f6ff, 0x241419, 2.5));
    const key = new THREE.DirectionalLight(0xffedda, 3);
    key.position.set(2, 4, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x60caff, 2);
    rim.position.set(-3, 2, -2);
    scene.add(rim);
    const chestMaterials: THREE.MeshStandardMaterial[] = [];
    let disposed = false;
    new GLTFLoader().load(
      "/models/iron-man-mark-50.glb",
      (gltf) => {
        if (disposed) {
          disposeObject(gltf.scene);
          return;
        }
        const model = gltf.scene;
        model.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(model);
        const center = bounds.getCenter(new THREE.Vector3());
        const scale = 5 / bounds.getSize(new THREE.Vector3()).y;
        model.scale.multiplyScalar(scale);
        model.position.sub(center.multiplyScalar(scale));
        model.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          materials.forEach((material) => {
            if (
              material instanceof THREE.MeshStandardMaterial &&
              material.map
            ) {
              material.emissiveMap = chestEmission(material.map);
              material.emissive.set(0xffffff);
              material.emissiveIntensity = 1;
              chestMaterials.push(material);
            }
          });
        });
        avatar.add(model);
        reactor.visible = true;
        setStatus("ready");
      },
      undefined,
      () => {
        if (!disposed) setStatus("error");
      },
    );
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
      if (!width || !height) return;
      avatar.position.y = 0;
      camera.position.z = Math.max(5 / (2 * Math.tan(THREE.MathUtils.degToRad(17.5))) / .91, 3.4 / (2 * Math.tan(THREE.MathUtils.degToRad(17.5)) * (width / height)));
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
        avatar.rotation.y = Math.sin(time * 0.0003) * 0.035;
        stars.rotation.z = time * 0.000006;
      }
      // Silence is dim; only measured voice energy lights the chest.
      const amplitude = Math.max(0, e.level - .025);
      const flicker = reduced ? 1 : .65 + .35 * Math.sin(time * .045) * Math.sin(time * .019);
      const power = e.active && amplitude > 0 ? .025 + amplitude * 10 * flicker : .025;
      cyan.emissiveIntensity = power * 1.5;
      chestMaterials.forEach((material) => {
        material.emissiveIntensity = power;
      });
      chestLight.intensity = 0.04 * power;
      renderer.render(scene, camera);
    }
    frame = requestAnimationFrame(animate);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      disposeObject(scene);
      renderer.dispose();
      host.replaceChildren();
    };
  }, []);
  return (
    <>
      <div
        className="reactor-canvas"
        ref={mount}
        role="img"
        aria-label="Iron Man Mark 50 with a voice-reactive arc reactor fitted inside his chest"
        data-model-status={status}
      />
      {status !== "ready" && (
        <span className="model-status" role="status">
          {status === "loading"
            ? "Loading Mark 50…"
            : "3D model unavailable. Voice and chat are still available."}
        </span>
      )}
    </>
  );
}
