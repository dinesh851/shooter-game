// Shared heightfield terrain for the forest map. Deterministic (integer-hash
// value noise, no Math.random/Date) so the EXACT same ground shape exists on
// the client (prediction + rendering) and the server (authority). The map is
// "open world but bounded": rolling forest floor that rises into a steep
// tree-covered rim near the edge, with a hard clamp at the bounds. Dense fog
// on the client hides the rim, so the world reads as endless forest.

export const WORLD_HALF = 100; // playable area is 200 x 200 m
export const RIM_START = 76; // distance at which the boundary hills begin
export const RIM_HEIGHT = 24; // how far the rim climbs above the local ground
const SEED = 1337;

// ---- deterministic noise ----------------------------------------------------

// integer lattice hash -> [0, 1). Math.imul keeps it exact 32-bit on every JS
// engine, which is what makes client and server agree bit-for-bit.
function hash2(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

// smooth bilinear value noise on the integer lattice -> [0, 1)
function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  let fx = x - ix;
  let fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); // smoothstep fade
  fz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

// fractal sum of octaves -> [0, 1)
export function fbm(x: number, z: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, z * freq, seed + i * 101);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// ---- the river ----------------------------------------------------------------
// A meandering river crosses the whole map roughly west-east, carving a channel
// into the hills. It is part of the heightfield itself, so collision, bullets,
// grenades and rendering all agree on it for free.

export const WATER_LEVEL = -1.05;
const RIVER_HALF = 5.0; // half-width of the channel floor
const RIVER_BANK = 5.0; // extra metres of bank falloff

// centreline of the river: z as a function of x
export function riverCenter(x: number): number {
  return 14 * Math.sin(x * 0.035) + 6 * Math.sin(x * 0.013 + 2);
}

// 1 in the channel, fading to 0 across the banks
export function riverMask(x: number, z: number): number {
  const d = Math.abs(z - riverCenter(x)) - RIVER_HALF;
  if (d <= 0) return 1;
  if (d >= RIVER_BANK) return 0;
  const t = 1 - d / RIVER_BANK;
  return t * t * (3 - 2 * t);
}

export function inWater(x: number, z: number): boolean {
  return riverMask(x, z) > 0.62;
}

// ---- the heightfield ----------------------------------------------------------

// raw ground before building pads: rolling hills + the river channel
function baseHeight(x: number, z: number): number {
  let h = (fbm(x * 0.016, z * 0.016, SEED, 4) - 0.5) * 2 * 6.5; // broad hills, ±6.5 m
  h += (fbm(x * 0.07, z * 0.07, SEED + 50, 2) - 0.5) * 1.2; // small bumps
  const rm = riverMask(x, z);
  if (rm > 0) h = h * (1 - rm) + -2.3 * rm;
  return h;
}

// levelled building pads (filled in below, after LANDMARKS is defined): the
// ground inside each landmark blends to one flat height so huts/tents/walls
// sit solidly on the terrain instead of floating over slopes
const PADS: { x: number; z: number; r: number; h: number }[] = [];

// Ground height (metres) at any world position. Gentle rolling hills with a
// little surface detail, levelled pads under the landmarks; past RIM_START
// the boundary hills ramp up steeply.
export function terrainHeight(x: number, z: number): number {
  let h = baseHeight(x, z);
  for (const p of PADS) {
    const dx = x - p.x;
    const dz = z - p.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < p.r * p.r) {
      const d = Math.sqrt(d2);
      // fully flat inner core, smooth blend back to the hills at the edge
      const t = Math.min(1, Math.max(0, (d - p.r * 0.55) / (p.r * 0.45)));
      const m = 1 - t * t * (3 - 2 * t);
      h = h * (1 - m) + p.h * m;
    }
  }
  const dd = Math.max(Math.abs(x), Math.abs(z));
  if (dd > RIM_START) {
    const t = Math.min(1, (dd - RIM_START) / (WORLD_HALF - RIM_START));
    h += t * t * RIM_HEIGHT;
  }
  return h;
}

// approximate ground slope (rise per metre) — used to keep trees off cliffs
export function terrainSlope(x: number, z: number): number {
  const e = 0.75;
  const dx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const dz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
}

// ---- deterministic forest layout -----------------------------------------------

export interface TreeInstance {
  x: number;
  z: number;
  y: number; // terrain height at the base
  type: number; // 0..2 pine variants, 3 = birch/aspen
  scale: number;
  rot: number; // yaw
  trunkR: number; // collision/occlusion radius of the trunk
  trunkH: number; // collision/occlusion height of the trunk
}

export interface RockInstance {
  x: number;
  z: number;
  y: number;
  size: number; // footprint (m)
  rot: number;
}

export interface LogInstance {
  x: number;
  z: number;
  y: number;
  len: number;
  r: number; // log radius — kept under STEP_HEIGHT/2 so logs stay walk-over-able
  alongX: boolean; // axis-aligned so the collision AABB matches the mesh
}

// ---- landmarks ------------------------------------------------------------------
// A few unique, named places so callouts exist. Each gets a tree-free clearing;
// their props (tents, walls, log piles…) become collision blocks in mapdata and
// are rendered with the survival model pack on the client.
export interface LandmarkProp {
  model: string; // GLB name in /models/survival (or "rock" for a boulder)
  x: number;
  z: number;
  yaw: number;
  w: number; // collision footprint (m)
  h: number;
  d: number;
  walkover?: boolean; // low object: no collision block
}

export interface Landmark {
  name: string;
  x: number;
  z: number;
  r: number;
  props: LandmarkProp[];
}

export const LANDMARKS: Landmark[] = [
  {
    name: "Camp",
    x: -52, z: -32, r: 12,
    props: [
      { model: "tent", x: -55, z: -35, yaw: 0.6, w: 3.2, h: 2.0, d: 3.2 },
      { model: "tent", x: -48, z: -36, yaw: -0.9, w: 3.2, h: 2.0, d: 3.2 },
      { model: "campfire-pit", x: -51.5, z: -30, yaw: 0, w: 1.4, h: 0.4, d: 1.4, walkover: true },
      { model: "box-large", x: -47.5, z: -29.5, yaw: 0.4, w: 1.4, h: 1.2, d: 1.4 },
    ],
  },
  {
    name: "Ruin",
    x: 48, z: 35, r: 11,
    props: [
      { model: "structure-metal-wall", x: 45, z: 32, yaw: 0, w: 4.0, h: 2.6, d: 0.5 },
      { model: "structure-metal-wall", x: 51, z: 34, yaw: Math.PI / 2, w: 0.5, h: 2.6, d: 4.0 },
      { model: "structure-metal-wall", x: 47, z: 38.5, yaw: 0, w: 4.0, h: 2.6, d: 0.5 },
      { model: "box-large-open", x: 48.5, z: 35, yaw: 0.8, w: 1.4, h: 1.1, d: 1.4 },
    ],
  },
  {
    name: "Logging Site",
    x: -20, z: 48, r: 10,
    props: [
      { model: "tree-log", x: -23, z: 46, yaw: 0.3, w: 4.4, h: 1.1, d: 1.4 },
      { model: "tree-log", x: -18, z: 50.5, yaw: 1.8, w: 1.4, h: 1.1, d: 4.4 },
      { model: "workbench", x: -16.5, z: 45.5, yaw: -0.5, w: 1.8, h: 1.1, d: 1.0 },
      { model: "resource-wood", x: -21, z: 51.5, yaw: 0, w: 1.4, h: 0.8, d: 1.2 },
    ],
  },
  {
    name: "Outcrop",
    x: 30, z: -45, r: 10,
    props: [
      { model: "rock", x: 28, z: -47, yaw: 0.2, w: 3.4, h: 2.4, d: 3.0 },
      { model: "rock", x: 32.5, z: -44, yaw: 1.3, w: 2.6, h: 1.8, d: 2.4 },
      { model: "rock", x: 29, z: -42.5, yaw: 2.1, w: 2.0, h: 1.4, d: 1.8 },
    ],
  },
  // forest huts (the player-supplied forest_hut.glb at its native ~5 m size)
  {
    name: "Spawn Hut",
    x: 12, z: -50, r: 8,
    props: [{ model: "@forest_hut", x: 12, z: -50, yaw: 0.6, w: 5.1, h: 3.5, d: 5.4 }],
  },
  {
    name: "West Hut",
    x: -42, z: 28, r: 8,
    props: [{ model: "@forest_hut", x: -42, z: 28, yaw: -1.8, w: 5.1, h: 3.5, d: 5.4 }],
  },
  {
    name: "North Hut",
    x: 40, z: 50, r: 8,
    props: [{ model: "@forest_hut", x: 40, z: 50, yaw: 2.4, w: 5.1, h: 3.5, d: 5.4 }],
  },
];

// circular areas kept free of trees/rocks (team spawns + a central meadow +
// the landmark sites)
export const CLEARINGS: { x: number; z: number; r: number }[] = [
  { x: 0, z: -64, r: 11 }, // team 0 spawn
  { x: 0, z: 64, r: 11 }, // team 1 spawn
  { x: 0, z: 0, r: 9 }, // central meadow
  ...LANDMARKS.map((l) => ({ x: l.x, z: l.z, r: l.r })),
];

// level the ground under every landmark (pad height = the raw terrain at its
// centre). Must run before TREES/ROCKS/LOGS below sample terrainHeight.
for (const l of LANDMARKS) {
  PADS.push({ x: l.x, z: l.z, r: l.r * 0.95, h: baseHeight(l.x, l.z) });
}

function inClearing(x: number, z: number): boolean {
  for (const c of CLEARINGS) {
    const dx = x - c.x;
    const dz = z - c.z;
    if (dx * dx + dz * dz < c.r * c.r) return true;
  }
  return false;
}

// Jittered-grid scatter. Extends past the playable bounds so the boundary rim
// is forested too (those trees are scenery/occluders out beyond the hard clamp).
const TREE_GRID = 7.4;
const TREE_EXTENT = WORLD_HALF + 14;

function buildTrees(): TreeInstance[] {
  const out: TreeInstance[] = [];
  const n = Math.floor(TREE_EXTENT / TREE_GRID);
  for (let gx = -n; gx <= n; gx++) {
    for (let gz = -n; gz <= n; gz++) {
      const keep = hash2(gx, gz, 9001);
      if (keep < 0.24) continue; // ~76% of cells get a tree
      const x = gx * TREE_GRID + (hash2(gx, gz, 9101) - 0.5) * TREE_GRID * 0.92;
      const z = gz * TREE_GRID + (hash2(gx, gz, 9201) - 0.5) * TREE_GRID * 0.92;
      if (inClearing(x, z)) continue;
      if (riverMask(x, z) > 0.2) continue; // no trees in the river
      if (terrainSlope(x, z) > 1.1) continue; // no trees on near-cliffs
      const r = hash2(gx, gz, 9301);
      const type = r < 0.42 ? 0 : r < 0.68 ? 1 : r < 0.84 ? 2 : 3;
      const scale = 0.85 + hash2(gx, gz, 9401) * 0.45;
      out.push({
        x,
        z,
        y: terrainHeight(x, z),
        type,
        scale,
        rot: hash2(gx, gz, 9501) * Math.PI * 2,
        trunkR: (type === 3 ? 0.3 : 0.42) * scale,
        trunkH: 10 * scale,
      });
    }
  }
  return out;
}

function buildRocks(): RockInstance[] {
  const out: RockInstance[] = [];
  for (let i = 0; i < 40; i++) {
    const x = (hash2(i, 7, 7001) - 0.5) * 2 * (WORLD_HALF - 6);
    const z = (hash2(i, 13, 7101) - 0.5) * 2 * (WORLD_HALF - 6);
    if (inClearing(x, z) || riverMask(x, z) > 0.3) continue;
    out.push({
      x,
      z,
      y: terrainHeight(x, z),
      size: 0.9 + hash2(i, 17, 7201) * 1.8,
      rot: hash2(i, 23, 7301) * Math.PI * 2,
    });
  }
  return out;
}

function buildLogs(): LogInstance[] {
  const out: LogInstance[] = [];
  for (let i = 0; i < 26 && out.length < 14; i++) {
    const x = (hash2(i, 31, 8001) - 0.5) * 2 * (WORLD_HALF - 12);
    const z = (hash2(i, 37, 8101) - 0.5) * 2 * (WORLD_HALF - 12);
    if (inClearing(x, z) || riverMask(x, z) > 0.2) continue;
    if (terrainSlope(x, z) > 0.3) continue; // logs only on near-flat ground
    out.push({
      x,
      z,
      y: terrainHeight(x, z),
      len: 3.2 + hash2(i, 41, 8201) * 3.5,
      r: 0.17 + hash2(i, 43, 8301) * 0.06,
      alongX: hash2(i, 47, 8401) < 0.5,
    });
  }
  return out;
}

export const TREES: TreeInstance[] = buildTrees();
export const ROCKS: RockInstance[] = buildRocks();
export const LOGS: LogInstance[] = buildLogs();
