// Isolated physics test for the forest terrain: terrain following, hard map
// bounds, tree-trunk collision, landing from a fall, and bullet occlusion.
// Pure shared code — run with: npx tsx scripts/phystest.ts
import { step } from "../shared/arcade";
import { rayObstructionT } from "../shared/blockmap";
import { MoveState, InputCmd, PLAYER_RADIUS } from "../shared/phys";
import { MAP } from "../shared/mapdata";
import { WORLD_HALF, TREES, terrainHeight } from "../shared/terrain";

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`[phystest] ${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
  if (!ok) failures++;
}

function mk(x: number, z: number): MoveState {
  return { x, y: terrainHeight(x, z), z, vx: 0, vy: 0, vz: 0, onGround: true, crouch: false };
}
function cmd(over: Partial<InputCmd>): InputCmd {
  return {
    seq: 0,
    dtMs: 33,
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    crouch: false,
    yaw: 0,
    pitch: 0,
    lean: 0,
    ...over,
  };
}

// 1) terrain following: walk forward 2 s, feet should sit on the heightfield
{
  const s = mk(0, 20);
  for (let i = 0; i < 60; i++) step(s, cmd({ forward: true, yaw: 0 }));
  const ground = terrainHeight(s.x, s.z);
  check(
    "terrain following",
    s.onGround && Math.abs(s.y - ground) < 0.05,
    `y=${s.y.toFixed(3)} ground=${ground.toFixed(3)} z=${s.z.toFixed(1)}`
  );
}

// 2) hard bounds: start on the rim near the edge, sprint outward for 6 s —
//    must end pinned exactly at the clamp, never beyond
{
  const s = mk(96, 0);
  for (let i = 0; i < 180; i++) step(s, cmd({ right: true, yaw: 0 }));
  const limit = WORLD_HALF - PLAYER_RADIUS;
  check(
    "bounds clamp",
    Math.abs(s.x - limit) < 0.5 && s.x <= limit + 1e-6,
    `x=${s.x.toFixed(3)} limit=${limit.toFixed(3)}`
  );
}

// 3) tree trunk blocks movement: walk straight at the nearest playable trunk
{
  const tree = TREES.find((t) => Math.abs(t.x) < 60 && Math.abs(t.z) < 60 && Math.abs(t.x) > 5)!;
  const s = mk(tree.x, tree.z + 6); // approach from +z, walking -z (yaw 0)
  for (let i = 0; i < 90; i++) step(s, cmd({ forward: true, yaw: 0 }));
  const gap = s.z - tree.z;
  check(
    "trunk collision",
    gap >= tree.trunkR + PLAYER_RADIUS - 0.02,
    `stopped ${gap.toFixed(3)} m from trunk centre (trunkR=${tree.trunkR.toFixed(2)})`
  );
}

// 4) falling lands on the terrain
{
  const s = mk(-25, -25);
  s.y += 8;
  s.onGround = false;
  for (let i = 0; i < 120; i++) step(s, cmd({}));
  const ground = terrainHeight(s.x, s.z);
  check("landing", s.onGround && Math.abs(s.y - ground) < 0.05, `y=${s.y.toFixed(3)} ground=${ground.toFixed(3)}`);
}

// 5) occlusion: a flat shot across the whole map must hit terrain or a trunk;
//    a shot straight up must be clear
{
  const oy = terrainHeight(0, -60) + 1.6;
  const across = rayObstructionT({ x: 0, y: oy, z: -60 }, { x: 0, y: 0, z: 1 }, 120);
  const upward = rayObstructionT({ x: 0, y: oy, z: -60 }, { x: 0, y: 1, z: 0 }, 120);
  check("occlusion across map", isFinite(across), `blocked at t=${across.toFixed(1)} m`);
  check("occlusion skyward", !isFinite(upward), `t=${upward}`);
}

console.log(`[phystest] map has ${MAP.blocks.length} blocks (${TREES.length} trees)`);
if (failures > 0) {
  console.error(`[phystest] ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("[phystest] all passed");
