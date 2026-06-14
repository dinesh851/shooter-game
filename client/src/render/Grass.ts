// The reference video's grass, ported faithfully from the EZ-Tree demo app
// (MIT): an instanced 3D grass-clump MODEL (curved textured blades, grass.glb)
// lit with Phong + real shadow maps, tinted per instance with random
// yellow-greens, swaying with a simplex wind, and placed ONLY where the ground
// texture shows grass (the same noise drives both, so dirt patches stay bare).
// Real 3D flower models are scattered through the clumps.
//
// Adapted to this game: clumps sit on the shared terrain heightfield and are
// chunked into several InstancedMeshes so frustum culling + fog skip most of
// the field each frame.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { WORLD_HALF, terrainHeight } from "../../../shared/terrain";
import { dirtAmountAt } from "./Terrain";

const EXTENT = WORLD_HALF + 14; // grass continues onto the boundary rim
const CHUNK = 56; // metres per culling cell
const GRID = 1.2; // clump spacing (jittered) — wide clumps overlap into a carpet

const CLUMP_HEIGHT = 0.52; // target clump height in metres (like the video)
const WIND = { strength: new THREE.Vector3(0, 0, 0), frequency: 1.0, scale: 150 };

export class Grass {
  readonly group = new THREE.Group();
  private uTime = { value: 0 };

  constructor() {
    this.load().catch((e) => console.error("[grass] failed to load", e));
  }

  private async load() {
    const loader = new GLTFLoader();
    const glb = await loader.loadAsync("/models/ez-grass.glb");
    let src: THREE.Mesh | null = null;
    glb.scene.traverse((o: any) => {
      if (o.isMesh && !src) src = o;
    });
    if (!src) throw new Error("no mesh in ez-grass.glb");
    const srcMesh = src as THREE.Mesh;

    // material exactly like the reference: Phong + the model's blade texture,
    // dimmed base colour, slight green emission so shade isn't dead black
    const mat = new THREE.MeshPhongMaterial({
      map: (srcMesh.material as THREE.MeshStandardMaterial).map,
      emissive: new THREE.Color(0x308040),
      emissiveIntensity: 0.18,
      transparent: false,
      alphaTest: 0.5,
      depthTest: true,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    // (the reference dims to 0.6 under its brighter lighting rig; ours is
    // moodier, so keep full brightness)

    // normalize the model to a known size — the GLB's native units are
    // arbitrary, so derive the instance scale from its real bounding box
    srcMesh.geometry.computeBoundingBox();
    const bb = srcMesh.geometry.boundingBox!;
    const nativeH = Math.max(bb.max.y - bb.min.y, 1e-3);
    const baseScale = CLUMP_HEIGHT / nativeH;
    // wind sway is added in NATIVE units in the shader (position.y * strength),
    // so a tip should move ~8 cm: strength = 0.08 / nativeH
    WIND.strength.set(0.12 / nativeH, 0, 0.12 / nativeH);
    this.appendWindShader(mat);

    // jittered-grid placement, skipped where the ground shows dirt
    const chunks = new Map<string, { m: THREE.Matrix4; c: THREE.Color }[]>();
    const dummy = new THREE.Object3D();
    const n = Math.floor(EXTENT / GRID);
    for (let gx = -n; gx <= n; gx++) {
      for (let gz = -n; gz <= n; gz++) {
        const x = gx * GRID + (Math.random() - 0.5) * GRID;
        const z = gz * GRID + (Math.random() - 0.5) * GRID;
        // clumps only on grassy ground (same noise as the ground texture)
        if (Math.random() < dirtAmountAt(x, z)) continue;

        dummy.position.set(x, terrainHeight(x, z) - 0.03, z);
        dummy.rotation.set(0, 2 * Math.PI * Math.random(), 0);
        // wide overlapping clumps (the video reads as a continuous carpet)
        dummy.scale.set(
          baseScale * (2.7 + 0.9 * Math.random()),
          baseScale * (0.9 + 0.55 * Math.random()),
          baseScale * (2.7 + 0.9 * Math.random())
        );
        dummy.updateMatrix();

        // the reference's random yellow-green tint per clump, lifted for our
        // dimmer lighting rig
        const c = new THREE.Color(0.3 + Math.random() * 0.15, 0.42 + Math.random() * 0.35, 0.13);

        const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
        let arr = chunks.get(key);
        if (!arr) chunks.set(key, (arr = []));
        arr.push({ m: dummy.matrix.clone(), c });
      }
    }

    chunks.forEach((list) => {
      const mesh = new THREE.InstancedMesh(srcMesh.geometry, mat, list.length);
      list.forEach((it, i) => {
        mesh.setMatrixAt(i, it.m);
        mesh.setColorAt(i, it.c);
      });
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    });

    await this.loadFlowers(loader, "/models/ez-flower-white.glb", 90);
    await this.loadFlowers(loader, "/models/ez-flower-yellow.glb", 50);
  }

  // 3D flower models, instanced per sub-mesh so the whole batch is a few draws
  private async loadFlowers(loader: GLTFLoader, url: string, count: number) {
    const glb = await loader.loadAsync(url);
    glb.scene.updateMatrixWorld(true);

    // measure the flower model so it lands at ~0.3 m tall regardless of units
    const fbb = new THREE.Box3().setFromObject(glb.scene);
    const fh = Math.max(fbb.max.y - fbb.min.y, 1e-3);
    const fScale = 0.3 / fh;

    // flower placements in grassy spots
    const placements: THREE.Matrix4[] = [];
    const dummy = new THREE.Object3D();
    for (let tries = 0; tries < count * 4 && placements.length < count; tries++) {
      const x = (Math.random() - 0.5) * 2 * (WORLD_HALF - 4);
      const z = (Math.random() - 0.5) * 2 * (WORLD_HALF - 4);
      if (Math.random() < dirtAmountAt(x, z) + 0.3) continue;
      dummy.position.set(x, terrainHeight(x, z), z);
      dummy.rotation.set(0, 2 * Math.PI * Math.random(), 0);
      dummy.scale.setScalar(fScale * (0.7 + 0.6 * Math.random()));
      dummy.updateMatrix();
      placements.push(dummy.matrix.clone());
    }

    const tmp = new THREE.Matrix4();
    glb.scene.traverse((o: any) => {
      if (!o.isMesh) return;
      const fmat = o.material?.map
        ? new THREE.MeshPhongMaterial({ map: o.material.map, side: THREE.DoubleSide, alphaTest: 0.5 })
        : new THREE.MeshPhongMaterial({ color: o.material?.color ?? 0xffffff });
      const inst = new THREE.InstancedMesh(o.geometry, fmat, placements.length);
      placements.forEach((p, i) => {
        tmp.multiplyMatrices(p, o.matrixWorld); // bake the sub-mesh offset
        inst.setMatrixAt(i, tmp);
      });
      inst.computeBoundingSphere();
      this.group.add(inst);
    });
  }

  // the reference's simplex wind, instancing-aware
  private appendWindShader(material: THREE.Material) {
    const uTime = this.uTime;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uTime;
      shader.uniforms.uWindStrength = { value: WIND.strength };
      shader.uniforms.uWindFrequency = { value: WIND.frequency };
      shader.uniforms.uWindScale = { value: WIND.scale };

      shader.vertexShader =
        `
        uniform float uTime;
        uniform vec3 uWindStrength;
        uniform float uWindFrequency;
        uniform float uWindScale;
        ` + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        `void main() {`,
        `
        vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

        float simplex2d(vec2 v) {
          const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
          vec2 i = floor(v + dot(v, C.yy));
          vec2 x0 = v - i + dot(i, C.xx);
          vec2 i1;
          i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
          vec4 x12 = x0.xyxy + C.xxzz;
          x12.xy -= i1;

          i = mod289(i);
          vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));

          vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
          m = m * m;
          m = m * m;

          vec3 x = 2.0 * fract(p * C.www) - 1.0;
          vec3 h = abs(x) - 0.5;
          vec3 ox = floor(x + 0.5);
          vec3 a0 = x - ox;

          m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);

          vec3 g;
          g.x = a0.x * x0.x + h.x * x0.y;
          g.yz = a0.yz * x12.xz + h.yz * x12.yw;
          return 130.0 * dot(m, g);
        }

        void main() {`
      );

      shader.vertexShader = shader.vertexShader.replace(
        `#include <project_vertex>`,
        `
        vec4 mvPosition = instanceMatrix * vec4(transformed, 1.0);
        float windOffset = 2.0 * 3.14 * simplex2d((modelMatrix * mvPosition).xz / uWindScale);
        vec3 windSway = position.y * uWindStrength *
          sin(uTime * uWindFrequency + windOffset) *
          cos(uTime * 1.4 * uWindFrequency + windOffset);

        mvPosition.xyz += windSway;
        mvPosition = modelViewMatrix * mvPosition;

        gl_Position = projectionMatrix * mvPosition;
        `
      );

      material.userData.shader = shader;
    };
  }

  update(time: number) {
    this.uTime.value = time;
  }
}
