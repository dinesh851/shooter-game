// Bounded open-world forest map. The ground itself is the shared heightfield
// in shared/terrain.ts; MAP.blocks carries only the solid obstacles standing on
// it (tree trunks + rocks), which both movement collision and server bullet
// occlusion use. Deterministic (shared client+server) — no randomness.

import { BlockMap, Block, Spawn } from "./phys";
import { WORLD_HALF, TREES, ROCKS, LOGS, LANDMARKS, CLEARINGS, terrainHeight } from "./terrain";

const blocks: Block[] = [];

// tree trunks: thin tall boxes (collision + bullet occlusion). The canopy is
// purely visual — you can shoot through leaves, not through trunks.
for (const t of TREES) {
  blocks.push({
    x: t.x,
    y: t.y + t.trunkH / 2,
    z: t.z,
    sx: t.trunkR * 2,
    sy: t.trunkH,
    sz: t.trunkR * 2,
    color: 0x6b5136,
    prop: "tree",
    yaw: t.rot,
  });
}

// scattered boulders — low cover
for (const r of ROCKS) {
  blocks.push({
    x: r.x,
    y: r.y + (r.size * 0.7) / 2,
    z: r.z,
    sx: r.size,
    sy: r.size * 0.7,
    sz: r.size * 0.9,
    color: 0x83878c,
    prop: "rock",
    yaw: r.rot,
  });
}

// fallen logs — low cover you can step over (axis-aligned so AABB collision
// matches the rendered cylinder)
for (const l of LOGS) {
  blocks.push({
    x: l.x,
    y: l.y + l.r,
    z: l.z,
    sx: l.alongX ? l.len : l.r * 2,
    sy: l.r * 2,
    sz: l.alongX ? l.r * 2 : l.len,
    color: 0x4a3826,
    prop: "log",
  });
}

// landmark props (tents, walls, log piles, boulders) — cover + bullet blockers.
// "rock" props render as boulders; the rest load survival-pack models.
for (const lm of LANDMARKS) {
  for (const pr of lm.props) {
    if (pr.walkover) continue; // low decoration, no collision
    blocks.push({
      x: pr.x,
      y: terrainHeight(pr.x, pr.z) + pr.h / 2,
      z: pr.z,
      sx: pr.w,
      sy: pr.h,
      sz: pr.d,
      color: 0x8a8273,
      prop: pr.model === "rock" ? "rock" : `lm:${pr.model}`,
      yaw: pr.yaw,
    });
  }
}

// team spawn lines inside the two spawn clearings, facing the map centre
const spawns: Spawn[] = [];
for (let i = 0; i < 6; i++) {
  const x = -10 + i * 4;
  const sc = CLEARINGS[0];
  const sz0 = sc.z + 4;
  spawns.push({ team: 0, x, y: terrainHeight(x, sz0), z: sz0, yaw: Math.PI });
  const sc1 = CLEARINGS[1];
  const sz1 = sc1.z - 4;
  spawns.push({ team: 1, x, y: terrainHeight(x, sz1), z: sz1, yaw: 0 });
}

export const MAP: BlockMap = {
  bounds: { halfX: WORLD_HALF, halfZ: WORLD_HALF },
  ceiling: 140, // open sky; just an anti-flyaway cap
  blocks,
  jumpPads: [],
  spawns,
};
