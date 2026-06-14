// Arcade movement (Quake/Source lineage): velocity-based with ground friction,
// capped air-acceleration (which is what makes air-strafing gain speed),
// bunny-hopping (skip friction on the jump tick), and sliding. Deterministic and
// pure — identical on client (prediction) and server (authority).

import {
  MoveState,
  InputCmd,
  GRAVITY,
  JUMP_VEL,
  MAX_SPEED,
  CROUCH_SPEED,
  SLIDE_SPEED,
  GROUND_ACCEL,
  AIR_ACCEL,
  AIR_SPEED_CAP,
  FRICTION,
  SLIDE_FRICTION,
  MAX_H_SPEED,
  DT_MAX,
} from "./phys";
import { moveWithCollision, canStand } from "./blockmap";
import { inWater, WATER_LEVEL } from "./terrain";

function applyFriction(s: MoveState, friction: number, dt: number): void {
  const speed = Math.hypot(s.vx, s.vz);
  if (speed < 0.05) {
    s.vx = 0;
    s.vz = 0;
    return;
  }
  const drop = speed * friction * dt;
  const ns = Math.max(0, speed - drop);
  const scale = ns / speed;
  s.vx *= scale;
  s.vz *= scale;
}

function accelerate(s: MoveState, wx: number, wz: number, wishSpeed: number, accel: number, dt: number): void {
  const current = s.vx * wx + s.vz * wz; // speed already in the wish direction
  const add = wishSpeed - current;
  if (add <= 0) return;
  let a = accel * dt * wishSpeed;
  if (a > add) a = add;
  s.vx += wx * a;
  s.vz += wz * a;
}

function airAccelerate(s: MoveState, wx: number, wz: number, accel: number, dt: number): void {
  // The classic trick: cap the wish speed used for the "add" to a small value,
  // so turning the aim while strafing keeps adding speed perpendicular to motion.
  const current = s.vx * wx + s.vz * wz;
  const add = AIR_SPEED_CAP - current;
  if (add <= 0) return;
  let a = accel * dt * MAX_SPEED;
  if (a > add) a = add;
  s.vx += wx * a;
  s.vz += wz * a;
}

export function step(s: MoveState, cmd: InputCmd): void {
  const dt = Math.min(Math.max(cmd.dtMs, 0), DT_MAX * 1000) / 1000;

  // wish direction from inputs, rotated into world space by yaw.
  // forward = (-sin, -cos), right = (cos, -sin)
  const mf = (cmd.forward ? 1 : 0) - (cmd.back ? 1 : 0);
  const mr = (cmd.right ? 1 : 0) - (cmd.left ? 1 : 0);
  const sy = Math.sin(cmd.yaw);
  const cy = Math.cos(cmd.yaw);
  let wx = -sy * mf + cy * mr;
  let wz = -cy * mf - sy * mr;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) {
    wx /= wl;
    wz /= wl;
  }

  // crouch toggle — but you can only stand up if there's headroom (so you can't
  // pop your camera through a low block by uncrouching under it).
  if (cmd.crouch) s.crouch = true;
  else if (s.crouch) s.crouch = !canStand(s);
  const horiz = Math.hypot(s.vx, s.vz);
  const sliding = cmd.crouch && s.onGround && horiz > MAX_SPEED * 0.9;

  // wading through the river is slow and you can't bunny-hop out of it
  const wading = s.y < WATER_LEVEL + 0.15 && inWater(s.x, s.z);

  if (s.onGround) {
    // bunny hop: skip friction on the tick you jump, so chained jumps keep speed
    if (!cmd.jump) applyFriction(s, sliding ? SLIDE_FRICTION : FRICTION, dt);

    let wishSpeed = sliding ? SLIDE_SPEED : cmd.crouch ? CROUCH_SPEED : MAX_SPEED;
    if (wading) wishSpeed *= 0.55;
    if (wl > 0) accelerate(s, wx, wz, wishSpeed, GROUND_ACCEL, dt);

    if (cmd.jump) {
      s.vy = wading ? JUMP_VEL * 0.75 : JUMP_VEL;
      s.onGround = false;
    }
  } else if (wl > 0) {
    airAccelerate(s, wx, wz, AIR_ACCEL, dt);
  }

  // gravity
  s.vy -= GRAVITY * dt;

  // clamp horizontal speed (anti-runaway)
  const sp = Math.hypot(s.vx, s.vz);
  if (sp > MAX_H_SPEED) {
    const k = MAX_H_SPEED / sp;
    s.vx *= k;
    s.vz *= k;
  }

  moveWithCollision(s, dt);
}

export function horizontalSpeed(s: MoveState): number {
  return Math.hypot(s.vx, s.vz);
}
