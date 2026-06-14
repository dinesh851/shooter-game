// Collision for the forest map. Runs on client (prediction) and server
// (authority), so it stays deterministic. The player is a vertical AABB. The
// ground is the shared terrain heightfield; MAP.blocks holds the obstacles
// standing on it (tree trunks, rocks).
//
// Horizontal collisions are resolved by MINIMUM TRANSLATION: for each wall the
// player overlaps, push it out along whichever horizontal axis it penetrates the
// least. That makes a thin wall push you straight out (never sideways along its
// length) and lets you slide along walls. A block only counts as a "wall" if its
// top is more than STEP_HEIGHT above the feet; lower blocks are steps/floors that
// the vertical pass lifts you onto (so stairs just work).

import { MoveState, PLAYER_RADIUS, PLAYER_HEIGHT, CROUCH_HEIGHT, STEP_HEIGHT, playerHeightFor } from "./phys";
import { MAP } from "./mapdata";
import { terrainHeight } from "./terrain";
import { GRENADE } from "./constants";

const EPS = 0.001;

function footprintOverlaps(x: number, z: number, b: { x: number; z: number; sx: number; sz: number }): boolean {
  return Math.abs(x - b.x) < PLAYER_RADIUS + b.sx / 2 && Math.abs(z - b.z) < PLAYER_RADIUS + b.sz / 2;
}

function wallBlocks(s: MoveState, b: (typeof MAP.blocks)[number], feetY: number): boolean {
  const top = b.y + b.sy / 2;
  const bottom = b.y - b.sy / 2;
  const h = playerHeightFor(s.crouch);
  if (top <= feetY + STEP_HEIGHT + EPS) return false; // low enough to step onto
  if (bottom >= feetY + h - EPS) return false; // entirely above the head
  return true;
}

// Is there room to stand up (grow to full height) at the current spot? Used so a
// crouched player can't pop their head/camera through a low block when uncrouching.
export function canStand(s: MoveState): boolean {
  const feetY = s.y;
  if (feetY + PLAYER_HEIGHT > MAP.ceiling) return false;
  for (const b of MAP.blocks) {
    if (!footprintOverlaps(s.x, s.z, b)) continue;
    const bottom = b.y - b.sy / 2;
    const top = b.y + b.sy / 2;
    // the new "standing" body span [feet+CROUCH_HEIGHT, feet+PLAYER_HEIGHT]
    if (top > feetY + CROUCH_HEIGHT + EPS && bottom < feetY + PLAYER_HEIGHT - EPS) return false;
  }
  return true;
}

// One pass of minimum-translation wall resolution. Returns true if it moved.
function resolveWalls(s: MoveState, feet: number): boolean {
  let moved = false;
  for (const b of MAP.blocks) {
    if (!footprintOverlaps(s.x, s.z, b) || !wallBlocks(s, b, feet)) continue;
    const penX = PLAYER_RADIUS + b.sx / 2 - Math.abs(s.x - b.x);
    const penZ = PLAYER_RADIUS + b.sz / 2 - Math.abs(s.z - b.z);
    if (penX <= 0 || penZ <= 0) continue;
    if (penX < penZ) {
      s.x += s.x >= b.x ? penX : -penX;
      s.vx = 0;
    } else {
      s.z += s.z >= b.z ? penZ : -penZ;
      s.vz = 0;
    }
    moved = true;
  }
  return moved;
}

function highestSupport(s: MoveState, cap: number): number {
  // The terrain always supports you — you can never be under the ground. On
  // gentle slopes the existing step logic makes walking up/down hills work;
  // steeper ground just means bigger snap steps (the boundary rim).
  let best = terrainHeight(s.x, s.z);
  for (const b of MAP.blocks) {
    if (!footprintOverlaps(s.x, s.z, b)) continue;
    const top = b.y + b.sy / 2;
    if (top <= cap + EPS && top > best) best = top;
  }
  return best;
}

export function moveWithCollision(s: MoveState, dt: number): void {
  const h = playerHeightFor(s.crouch);
  const wasGround = s.onGround;
  const feet = s.y; // feet height at the start of the step (stable wall/step tests)

  // ---- horizontal move (swept in substeps so fast moves can't tunnel thin
  // walls), resolving wall penetration after each substep ----
  const dx = s.vx * dt;
  const dz = s.vz * dt;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / PLAYER_RADIUS));
  for (let i = 0; i < n; i++) {
    s.x += dx / n;
    s.z += dz / n;
    // a few passes converge tight corners; stop early once nothing penetrates
    for (let pass = 0; pass < 4; pass++) {
      if (!resolveWalls(s, feet)) break;
    }
  }

  // ---- vertical ----
  s.y += s.vy * dt;
  s.onGround = false;

  if (s.y + h > MAP.ceiling) {
    s.y = MAP.ceiling - h;
    if (s.vy > 0) s.vy = 0;
  }
  // bonk head on a block underside while rising
  if (s.vy > 0) {
    for (const b of MAP.blocks) {
      if (!footprintOverlaps(s.x, s.z, b)) continue;
      const bottom = b.y - b.sy / 2;
      const top = b.y + b.sy / 2;
      if (bottom > s.y && bottom < s.y + h && top > s.y + h) {
        s.y = bottom - h;
        s.vy = 0;
        break;
      }
    }
  }

  // ground support: grounded -> may climb up to STEP_HEIGHT; airborne -> catch any
  // surface between where the feet started this tick and now (no tunnelling).
  const cap = wasGround ? feet + STEP_HEIGHT : feet;
  const support = highestSupport(s, cap);
  if (s.y <= support + EPS) {
    s.y = support;
    if (s.vy < 0) s.vy = 0;
    s.onGround = true;
  } else if (wasGround && s.vy <= 0.01 && s.y - support <= STEP_HEIGHT) {
    s.y = support; // snap down small ledges (walking downstairs stays grounded)
    s.vy = 0;
    s.onGround = true;
  }

  // ---- arena bounds (outer safety walls) ----
  const bx = MAP.bounds.halfX - PLAYER_RADIUS;
  const bz = MAP.bounds.halfZ - PLAYER_RADIUS;
  if (s.x < -bx) {
    s.x = -bx;
    s.vx = 0;
  } else if (s.x > bx) {
    s.x = bx;
    s.vx = 0;
  }
  if (s.z < -bz) {
    s.z = -bz;
    s.vz = 0;
  } else if (s.z > bz) {
    s.z = bz;
    s.vz = 0;
  }

  // ---- jump pads (only near the ground while grounded) ----
  if (s.onGround && s.y < terrainHeight(s.x, s.z) + 0.6) {
    for (const p of MAP.jumpPads) {
      const dx = s.x - p.x;
      const dz = s.z - p.z;
      if (dx * dx + dz * dz < (p.radius + PLAYER_RADIUS) * (p.radius + PLAYER_RADIUS)) {
        s.vy = p.boost;
        s.onGround = false;
        break;
      }
    }
  }
}

// ---- grenade physics --------------------------------------------------------
// One integration step for a grenade: gravity, terrain bounce, map bounds, and
// AABB bounces off solid blocks (tree trunks, rocks, logs). Runs identically on
// the server (authoritative explosion position) and the client (the thrown
// grenade you see), so what you watch is what detonates.
export interface GrenadeBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export function grenadeStep(g: GrenadeBody, dt: number): void {
  const G = GRENADE;
  g.vy -= G.gravity * dt;
  g.x += g.vx * dt;
  g.y += g.vy * dt;
  g.z += g.vz * dt;

  // ground bounce on the heightfield
  const floor = terrainHeight(g.x, g.z) + 0.12;
  if (g.y <= floor) {
    g.y = floor;
    if (g.vy < 0) {
      g.vy = -g.vy * G.bounce;
      if (g.vy < 0.6) g.vy = 0; // come to rest instead of micro-bouncing
      g.vx *= G.friction;
      g.vz *= G.friction;
    }
  }

  // outer bounds
  const hx = MAP.bounds.halfX - 0.3;
  const hz = MAP.bounds.halfZ - 0.3;
  if (g.x < -hx) {
    g.x = -hx;
    g.vx = -g.vx * G.friction;
  } else if (g.x > hx) {
    g.x = hx;
    g.vx = -g.vx * G.friction;
  }
  if (g.z < -hz) {
    g.z = -hz;
    g.vz = -g.vz * G.friction;
  } else if (g.z > hz) {
    g.z = hz;
    g.vz = -g.vz * G.friction;
  }

  // solid blocks: push out along the least-penetrated axis and reflect
  for (const b of MAP.blocks) {
    const ex = b.sx / 2 + 0.1;
    const ey = b.sy / 2 + 0.1;
    const ez = b.sz / 2 + 0.1;
    const dx = g.x - b.x;
    const dy = g.y - b.y;
    const dz = g.z - b.z;
    if (Math.abs(dx) >= ex || Math.abs(dy) >= ey || Math.abs(dz) >= ez) continue;
    const px = ex - Math.abs(dx);
    const py = ey - Math.abs(dy);
    const pz = ez - Math.abs(dz);
    if (px <= py && px <= pz) {
      g.x += dx >= 0 ? px : -px;
      g.vx = -g.vx * G.bounce;
      g.vz *= G.friction;
    } else if (py <= pz) {
      g.y += dy >= 0 ? py : -py;
      g.vy = -g.vy * G.bounce;
      g.vx *= G.friction;
      g.vz *= G.friction;
    } else {
      g.z += dz >= 0 ? pz : -pz;
      g.vz = -g.vz * G.bounce;
      g.vx *= G.friction;
    }
    break; // resolving one block per step is plenty at grenade speeds
  }
}

// ---- bullet occlusion -------------------------------------------------------
// Distance along a ray to the first thing that blocks a shot (terrain or a
// solid block — tree trunks/rocks), or Infinity if the path is clear up to
// maxT. Terrain is ray-marched (1.5 m steps, plenty for hill silhouettes);
// blocks use an exact AABB slab test.
export function rayObstructionT(
  o: { x: number; y: number; z: number },
  d: { x: number; y: number; z: number },
  maxT: number
): number {
  let best = Infinity;

  const STEP = 1.5;
  for (let t = STEP; t < maxT; t += STEP) {
    const y = o.y + d.y * t;
    if (y > 60) break; // high above any terrain and rising never comes back cheap — bail
    if (y < terrainHeight(o.x + d.x * t, o.z + d.z * t)) {
      // refine within the last step so impact FX sit near the surface
      let lo = t - STEP;
      let hi = t;
      for (let i = 0; i < 5; i++) {
        const m = (lo + hi) / 2;
        if (o.y + d.y * m < terrainHeight(o.x + d.x * m, o.z + d.z * m)) hi = m;
        else lo = m;
      }
      best = hi;
      break;
    }
  }

  for (const b of MAP.blocks) {
    const t = rayAabb(o, d, b);
    if (t !== null && t < best && t < maxT) best = t;
  }
  return best;
}

function rayAabb(
  o: { x: number; y: number; z: number },
  d: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number; sx: number; sy: number; sz: number }
): number | null {
  let tmin = 0;
  let tmax = Infinity;
  const mins = [b.x - b.sx / 2, b.y - b.sy / 2, b.z - b.sz / 2];
  const maxs = [b.x + b.sx / 2, b.y + b.sy / 2, b.z + b.sz / 2];
  const ov = [o.x, o.y, o.z];
  const dv = [d.x, d.y, d.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dv[i]) < 1e-9) {
      if (ov[i] < mins[i] || ov[i] > maxs[i]) return null;
      continue;
    }
    let t1 = (mins[i] - ov[i]) / dv[i];
    let t2 = (maxs[i] - ov[i]) / dv[i];
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return tmin > 0 ? tmin : null;
}
