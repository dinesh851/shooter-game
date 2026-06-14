// The forest: EZ-Tree (free asset from threejsroadmap.com/assets) generates a
// few procedural tree variants; every tree on the map is an instance of one of
// them. Instances are grouped into spatial chunks so frustum culling + fog can
// skip most of the forest each frame. Placement comes from shared/terrain.ts,
// so trunks match the server's collision/occlusion blocks exactly.

import * as THREE from "three";
import { Tree } from "@dgreenheck/ez-tree";
import { TREES, TreeInstance } from "../../../shared/terrain";

// Presets are gorgeous but FAR too heavy for hundreds of instances on office
// Macs (Pine Medium alone is ~20k tris). Decimate: fewer child branches, fewer
// radial segments, fewer-but-larger leaves. BASE_SCALE shrinks the 50 m preset
// giants to believable forest height.
export const BASE_SCALE = 0.45;

interface VariantCfg {
  preset: string;
  seed: number;
  bark?: string; // override bark texture (e.g. white birch trunks)
  leafTint?: number;
}

const VARIANTS: VariantCfg[] = [
  { preset: "Pine Medium", seed: 101 },
  { preset: "Pine Medium", seed: 2702, leafTint: 0xd8e8c8 }, // slightly paler pine
  { preset: "Pine Large", seed: 707 },
  { preset: "Aspen Medium", seed: 404, bark: "birch" }, // white-barked deciduous
];

const CHUNK = 56; // metres per culling cell

export class Forest {
  readonly group = new THREE.Group();
  private timeUniform = { value: 0 };

  constructor() {
    const variantTrees: TreeInstance[][] = VARIANTS.map(() => []);
    for (const t of TREES) variantTrees[Math.min(t.type, VARIANTS.length - 1)].push(t);

    VARIANTS.forEach((cfg, vi) => {
      const placements = variantTrees[vi];
      if (!placements.length) return;
      const tree = this.generateVariant(cfg);
      this.addInstancedChunks(tree, placements);
    });
  }

  private generateVariant(cfg: VariantCfg): Tree {
    const tree = new Tree();
    tree.loadPreset(cfg.preset);
    const o: any = tree.options;
    o.seed = cfg.seed;
    if (cfg.bark) o.bark.type = cfg.bark;

    // decimation for instancing at scale
    for (const k of Object.keys(o.branch.children)) {
      o.branch.children[k] = Math.min(o.branch.children[k], k === "0" ? 20 : 4);
    }
    for (const k of Object.keys(o.branch.sections)) {
      o.branch.sections[k] = Math.min(o.branch.sections[k], k === "0" ? 6 : 4);
    }
    for (const k of Object.keys(o.branch.segments)) {
      o.branch.segments[k] = Math.min(o.branch.segments[k], k === "0" ? 5 : 3);
    }
    o.leaves.count = Math.min(o.leaves.count, 18);
    o.leaves.size *= 2.6; // fewer leaves, bigger cards — similar canopy coverage
    if (cfg.leafTint !== undefined) o.leaves.tint = cfg.leafTint;

    tree.generate();
    return tree;
  }

  private addInstancedChunks(tree: Tree, placements: TreeInstance[]) {
    const branchGeo = (tree.branchesMesh as THREE.Mesh).geometry;
    const branchMat = (tree.branchesMesh as THREE.Mesh).material as THREE.MeshPhongMaterial;
    branchMat.color.setScalar(1.25); // lift the bark's unlit side out of pure black
    const leafGeo = (tree.leavesMesh as THREE.Mesh).geometry;
    const srcLeafMat = (tree.leavesMesh as THREE.Mesh).material as THREE.MeshPhongMaterial;

    // The library's leaf material injects wind code that bypasses the
    // instancing transform — build our own instancing-safe leaf material that
    // sways in object space (before instanceMatrix is applied).
    const leafMat = new THREE.MeshPhongMaterial({
      map: srcLeafMat.map,
      color: srcLeafMat.color.clone(),
      side: THREE.DoubleSide,
      alphaTest: 0.4,
      shininess: 0,
    });
    const timeUniform = this.timeUniform;
    leafMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = timeUniform;
      shader.vertexShader =
        "uniform float uTime;\n" +
        shader.vertexShader.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          {
            #ifdef USE_INSTANCING
              vec2 wPh = vec2(instanceMatrix[3][0], instanceMatrix[3][2]) * 0.35;
            #else
              vec2 wPh = vec2(0.0);
            #endif
            float sway = sin(uTime * 1.3 + wPh.x + transformed.y * 0.12)
                       + 0.5 * sin(uTime * 2.3 + wPh.y + transformed.x * 0.2);
            transformed.xz += uv.y * sway * 0.10;
          }`
        );
    };

    // alpha-tested shadows for the leaf cards (dappled light on the ground)
    const leafDepth = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: srcLeafMat.map,
      alphaTest: 0.4,
    });

    // bucket placements into culling chunks
    const chunks = new Map<string, TreeInstance[]>();
    for (const p of placements) {
      const key = `${Math.floor(p.x / CHUNK)},${Math.floor(p.z / CHUNK)}`;
      let arr = chunks.get(key);
      if (!arr) chunks.set(key, (arr = []));
      arr.push(p);
    }

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const tint = new THREE.Color();

    chunks.forEach((list) => {
      const branches = new THREE.InstancedMesh(branchGeo, branchMat, list.length);
      const leaves = new THREE.InstancedMesh(leafGeo, leafMat, list.length);
      leaves.customDepthMaterial = leafDepth;
      list.forEach((p, i) => {
        const s = p.scale * BASE_SCALE;
        q.setFromAxisAngle(up, p.rot);
        pos.set(p.x, p.y - 0.2, p.z); // sink slightly so trunks meet sloped ground
        scl.setScalar(s);
        m.compose(pos, q, scl);
        branches.setMatrixAt(i, m);
        leaves.setMatrixAt(i, m);
        // subtle per-tree canopy tone variation
        const v = 0.82 + ((i * 2654435761) % 100) / 100 * 0.18;
        leaves.setColorAt(i, tint.setScalar(v));
      });
      branches.castShadow = true;
      branches.receiveShadow = true;
      leaves.castShadow = true;
      branches.computeBoundingSphere();
      leaves.computeBoundingSphere();
      this.group.add(branches, leaves);
    });
  }

  update(time: number) {
    this.timeUniform.value = time;
  }
}
