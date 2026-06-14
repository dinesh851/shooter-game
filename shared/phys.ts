// Physics contract shared by client prediction and server authority. The SAME
// arcade movement + collision runs on both sides, so everything here must stay
// deterministic (no Date/Math.random/perf). This is the Krunker-style model:
// velocity-based movement with friction, air-acceleration (air-strafe),
// bunny-hopping, and sliding, over a multi-level blocky map.

export interface MoveState {
  x: number;
  y: number; // feet position
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  crouch: boolean;
}

export interface InputCmd {
  seq: number;
  dtMs: number;
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  crouch: boolean;
  yaw: number;
  pitch: number;
  lean: number; // -1 (left) .. +1 (right) peek; cosmetic, replicated so others see it
}

// ---- player dimensions (metres) ----
export const PLAYER_RADIUS = 0.45;
export const PLAYER_HEIGHT = 1.8;
export const CROUCH_HEIGHT = 1.15;
export const EYE_HEIGHT = 1.62;
export const CROUCH_EYE = 1.0;
export const STEP_HEIGHT = 0.45; // auto-climb ledges up to this tall

// ---- dynamics (units = metres, seconds) ----
export const GRAVITY = 26;
export const JUMP_VEL = 8.4;
export const MAX_SPEED = 9.5; // ground target speed (fast / arcade)
export const CROUCH_SPEED = 4.5; // walking while crouched (not sliding)
export const SLIDE_SPEED = 14; // momentum a slide can carry
export const GROUND_ACCEL = 95; // how quickly we reach target speed on ground
export const AIR_ACCEL = 90; // air acceleration (paired with the cap below)
export const AIR_SPEED_CAP = 1.3; // small cap is what enables air-strafing
export const FRICTION = 9; // ground friction
export const SLIDE_FRICTION = 1.2; // low friction while sliding => carries speed
export const MAX_H_SPEED = 30; // hard horizontal speed clamp (anti-runaway)
export const DT_MAX = 0.05; // clamp a single integration step

// ---- map primitives ----
export interface Block {
  x: number; // centre
  y: number; // centre
  z: number;
  sx: number; // full size
  sy: number;
  sz: number;
  color: number; // hex
  model?: string; // optional GLB to render in place of a plain box (collision still uses the box)
  prop?: string; // optional procedural prop (client/src/render/props.ts) for this collision box
  yaw?: number; // model / prop rotation (0 or PI keep footprint; PI/2 swaps w<->d)
}

export interface JumpPad {
  x: number;
  z: number;
  radius: number;
  boost: number; // upward velocity applied
}

export interface Spawn {
  team: 0 | 1;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface BlockMap {
  bounds: { halfX: number; halfZ: number };
  ceiling: number;
  blocks: Block[];
  jumpPads: JumpPad[];
  spawns: Spawn[];
}

export const TEAM_COLORS = [0x3b82f6, 0xe23b3b]; // 0 = BLUE team, 1 = RED team
export const TEAM_NAMES = ["BLUE", "RED"];

export function eyeHeightFor(crouch: boolean): number {
  return crouch ? CROUCH_EYE : EYE_HEIGHT;
}

export function playerHeightFor(crouch: boolean): number {
  return crouch ? CROUCH_HEIGHT : PLAYER_HEIGHT;
}
