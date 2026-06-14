// Server-authoritative hitscan. A player is approximated as a vertical capsule
// (a segment from foot+radius to head-radius). We compute the closest distance
// between the shot ray and that segment; if it's within the radius, it's a hit.
//
// NOTE (slice limitation): no lag compensation and no world occlusion yet —
// we test against current authoritative positions and ignore walls. Both are
// listed as upgrades in the plan (lag-comp rewind + obstacle ray tests).

import { PLAYER_RADIUS, PLAYER_HEIGHT } from "../shared/phys";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface HitResult {
  t: number; // distance along the ray to closest approach
  head: boolean; // hit the upper portion of the capsule
}

export function rayCapsule(
  o: Vec3,
  d: Vec3,
  px: number,
  py: number,
  pz: number,
  height: number = PLAYER_HEIGHT
): HitResult | null {
  const r = PLAYER_RADIUS;
  // capsule core segment A -> B (vertical)
  const ax = px;
  const ay = py + r;
  const az = pz;
  const segLen = height - 2 * r; // segment is purely along +Y
  // u = B - A = (0, segLen, 0)
  const uy = segLen;

  // Closest points between segment P(s)=A+s*u (s in [0,1]) and ray Q(t)=o+t*d (t>=0)
  const w0x = ax - o.x;
  const w0y = ay - o.y;
  const w0z = az - o.z;

  const a = uy * uy; // u·u
  const b = uy * d.y; // u·d
  const c = d.x * d.x + d.y * d.y + d.z * d.z; // d·d (≈1, kept general)
  const dd = uy * w0y; // u·w0
  const e = d.x * w0x + d.y * w0y + d.z * w0z; // d·w0

  const denom = a * c - b * b;
  let s: number;
  if (denom < 1e-9) {
    s = 0; // ray parallel to segment
  } else {
    s = (b * e - c * dd) / denom;
  }
  s = Math.max(0, Math.min(1, s));

  // t for the clamped s, from: e + s*b - t*c = 0
  const t = (e + s * b) / c;
  if (t < 0) return null; // behind the shooter

  const p1x = ax;
  const p1y = ay + s * uy;
  const p1z = az;
  const qx = o.x + t * d.x;
  const qy = o.y + t * d.y;
  const qz = o.z + t * d.z;

  const dist = Math.hypot(p1x - qx, p1y - qy, p1z - qz);
  if (dist > r) return null;

  return { t, head: s > 0.85 };
}

// Ray vs sphere — used for a generous head hitbox so head shots reliably register.
export function raySphere(o: Vec3, d: Vec3, cx: number, cy: number, cz: number, r: number): number | null {
  const ox = o.x - cx;
  const oy = o.y - cy;
  const oz = o.z - cz;
  const a = d.x * d.x + d.y * d.y + d.z * d.z;
  const b = 2 * (ox * d.x + oy * d.y + oz * d.z);
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = (-b - sq) / (2 * a);
  if (t < 0) t = (-b + sq) / (2 * a);
  return t < 0 ? null : t;
}

export const HEAD_RADIUS = 0.34; // generous so aiming at the head connects

