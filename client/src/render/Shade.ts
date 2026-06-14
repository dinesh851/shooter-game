// Baked sun-visibility map. Trees never move, so at startup we ray-test every
// ground texel toward the sun against all trunk cylinders + canopy spheres and
// bake the result into a texture. The grass/flower shaders (which are unlit and
// can't receive real shadow maps) and the terrain multiply by it — that is what
// puts the big soft pools of light and shade on the forest floor.

import * as THREE from "three";
import { TREES, terrainHeight } from "../../../shared/terrain";
import { BASE_SCALE } from "./Forest";

export const SUN_DIR = new THREE.Vector3(70, 52, -38).normalize();
export const SHADE_EXTENT = 132; // covers playable area + grass wrap margin
const RES = 320;
const MAX_REACH = 48; // horizontal metres a canopy shadow can reach at this sun angle

export function buildShadeTexture(): THREE.DataTexture {
  // spatial grid over trees so each texel only tests nearby trunks/canopies
  const CELL = 8;
  const gw = Math.ceil((SHADE_EXTENT * 2) / CELL);
  const grid: number[][] = Array.from({ length: gw * gw }, () => []);
  const cellOf = (x: number, z: number) => {
    const cx = Math.min(gw - 1, Math.max(0, Math.floor((x + SHADE_EXTENT) / CELL)));
    const cz = Math.min(gw - 1, Math.max(0, Math.floor((z + SHADE_EXTENT) / CELL)));
    return cz * gw + cx;
  };
  TREES.forEach((t, i) => grid[cellOf(t.x, t.z)].push(i));

  const sx = SUN_DIR.x;
  const sy = SUN_DIR.y;
  const sz = SUN_DIR.z;
  const hl2 = sx * sx + sz * sz;

  const data = new Uint8Array(RES * RES);
  const steps = Math.ceil(MAX_REACH / CELL);

  for (let iz = 0; iz < RES; iz++) {
    for (let ix = 0; ix < RES; ix++) {
      const px = (ix / (RES - 1)) * 2 * SHADE_EXTENT - SHADE_EXTENT;
      const pz = (iz / (RES - 1)) * 2 * SHADE_EXTENT - SHADE_EXTENT;
      const py = terrainHeight(px, pz) + 0.3;

      let vis = 1;
      const seen = new Set<number>();
      for (let s = 0; s <= steps && vis > 0.15; s++) {
        const cell = grid[cellOf(px + sx * CELL * s, pz + sz * CELL * s)];
        for (const ti of cell) {
          if (seen.has(ti)) continue;
          seen.add(ti);
          const t = TREES[ti];
          const sc = t.scale * BASE_SCALE * 2.2; // visual scale of the generated trees

          // canopy: sphere in the upper half of the tree
          const cy = t.y + 11 * sc;
          const cr = 4.6 * sc;
          const tc = (cy - py) / sy;
          if (tc > 0 && tc * Math.sqrt(hl2) < MAX_REACH + cr) {
            const dx = px + sx * tc - t.x;
            const dz = pz + sz * tc - t.z;
            const lat = Math.hypot(dx, dz);
            if (lat < cr) {
              const occ = 1 - smooth(cr * 0.45, cr, lat);
              vis *= 1 - occ * 0.72;
            }
          }

          // trunk: vertical segment, tested as 2D closest approach
          const ddx = t.x - px;
          const ddz = t.z - pz;
          const t3 = (ddx * sx + ddz * sz) / hl2;
          if (t3 > 0.2) {
            const lat = Math.hypot(px + sx * t3 - t.x, pz + sz * t3 - t.z);
            const rr = t.trunkR * 1.5 + 0.18;
            const yHit = py + sy * t3;
            if (lat < rr && yHit > t.y && yHit < t.y + 16 * sc) {
              vis *= 0.3 + 0.7 * smooth(rr * 0.4, rr, lat);
            }
          }
        }
      }
      data[iz * RES + ix] = Math.round(Math.max(0.18, vis) * 255);
    }
  }

  const tex = new THREE.DataTexture(data, RES, RES, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
