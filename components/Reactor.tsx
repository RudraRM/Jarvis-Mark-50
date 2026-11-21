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
  // GLTFLoader may share decoded images between Strict Mode loads.
  // Dispose GPU textures, but do not close a bitmap still used by another load.
  textures.forEach(texture => texture.dispose());
}

export default function Reactor({
  active,
}: {
  active: boolean;
}) {
  const [failureReason, setFailureReason] = useState("");
  const [attempt, setAttempt] = useState(0);
  const mount = useRef<HTMLDivElement>(null);
  const energy = useRef(active);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  useEffect(() => {
    energy.current = active;
  }, [active]);
  useEffect(() => {
    const host = mount.current!;
    setStatus("loading");
    setFailureReason("");
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: "default" });
    } catch {
      setFailureReason("Safari could not start WebGL 2. Check Safari graphics support and reload this page.");
      setStatus("error");
      return;
    }
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    host.appendChild(renderer.domElement);
    let failed = false;
    let modelLoaded = false;
    let announcedReady = false;
    const lost = (event: Event) => {
      event.preventDefault();
      failed = true;
      setFailureReason("Safari lost its graphics context. Close other graphics-heavy tabs, then reload the model.");
      setStatus("error");
    };
    // Recovery is explicit: a restore event must not recreate contexts in a loop.
    const restored = () => {};
    renderer.domElement.addEventListener("webglcontextlost", lost);
    renderer.domElement.addEventListener("webglcontextrestored", restored);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    camera.position.set(0, 0, 10);
    const avatar = new THREE.Group();
    scene.add(avatar);
    scene.add(new THREE.HemisphereLight(0xe3f6ff, 0x241419, 2.5));
    const key = new THREE.DirectionalLight(0xffedda, 3);
    key.position.set(2, 4, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x60caff, 2);
    rim.position.set(-3, 2, -2);
    scene.add(rim);
    const eyeMaterials: THREE.MeshStandardMaterial[] = [];
    let disposed = false;
    const loader = new GLTFLoader();
    // Use the native HTML image decoder consistently, including Safari 17+.
    // ImageBitmap support alone does not guarantee embedded GLB decoding works.
    loader.register(parser => {
      parser.textureLoader = new THREE.TextureLoader(parser.options.manager)
        .setCrossOrigin(parser.options.crossOrigin)
        .setRequestHeader(parser.options.requestHeader);
      return {name: "JARVIS_native_texture_decoder"};
    });
    loader.load(
      "/models/mk3-helmet.glb",
      (gltf) => {
        if (disposed) {
          disposeObject(gltf.scene);
          return;
        }
        const model = gltf.scene;
        model.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(model);
        const center = bounds.getCenter(new THREE.Vector3());
        model.position.sub(center);
        model.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return;
          const material = object.material;
          if (material instanceof THREE.MeshStandardMaterial && material.name === "eyesemissive") {
            material.emissive.set(0x008aff);
            material.emissiveIntensity = 0;
            eyeMaterials.push(material);
          }
        });
        avatar.add(model);
        modelLoaded = true;
      },
      undefined,
      (error) => {
        if (!disposed) {
          failed = true;
          setFailureReason(error instanceof Error ? error.message : "The model could not be downloaded or decoded.");
          setStatus("error");
        }
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
      const aspect = width / height;
      const halfHeight = Math.max(1.36, .9 / aspect);
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
      camera.right = halfHeight * aspect;
      camera.left = -camera.right;
      renderer.setSize(width, height);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    function animate(time: number) {
      if (disposed || failed) return;
      frame = requestAnimationFrame(animate);
      if (!reduced) stars.rotation.z = time * 0.000006;
      for (const material of eyeMaterials) {
        material.emissiveIntensity = energy.current ? 1.5 : 0;
      }
      try {
        renderer.render(scene, camera);
        if (modelLoaded && !announcedReady && !renderer.getContext().isContextLost()) {
          announcedReady = true;
          setStatus("ready");
        }
      } catch (error) {
        failed = true;
        setFailureReason(error instanceof Error ? error.message : "Safari could not render the model.");
        setStatus("error");
      }
    }
    frame = requestAnimationFrame(animate);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      disposeObject(scene);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      renderer.domElement.removeEventListener("webglcontextrestored", restored);
      renderer.dispose();
      host.replaceChildren();
    };
  }, [attempt]);
  return (
    <>
      {status !== "ready" && <div className="helmet-preview" role="img" aria-label="MK3 helmet preview; live 3D is not yet available" />}
      <div
        className="reactor-canvas"
        ref={mount}
        role="img"
        aria-label="Front-facing Iron Man MK3 helmet"
        data-model-status={status}
      />
      {status !== "ready" && (
        <span className="model-status" role="status">
          {status === "loading"
            ? "Loading MK3 helmet…"
            : "Showing helmet preview. Live 3D is unavailable; try reloading the model."}
          {status === "error" && <small className="model-error-detail">{failureReason}</small>}
          {status === "error" && <button className="model-retry" onClick={() => setAttempt(value => value + 1)}>Reload helmet</button>}
        </span>
      )}
    </>
  );
}
