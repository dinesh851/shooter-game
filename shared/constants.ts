// Tunables shared by client prediction and server authority. Keeping these in
// one place is what makes client-side prediction match the server exactly.

export const TICK_RATE = 30; // server simulation ticks per second
export const TICK_MS = 1000 / TICK_RATE;
export const PATCH_RATE_MS = 50; // how often the server broadcasts state (20 Hz)

// NOTE: movement tunables and player dimensions live in shared/phys.ts (the
// single source of truth used by both client prediction and server authority).
// Do not re-add speed/gravity/size here — it would silently diverge.

export const MAX_HEALTH = 100;
export const RESPAWN_MS = 3000;

// spawn protection: brief invulnerability after (re)spawning so you can't be
// spawn-killed. Ends early the moment the protected player fires.
export const SPAWN_PROTECT_MS = 3000;

// passive health regeneration: untouched for delayMs, then recover
export const REGEN = {
  delayMs: 4000,
  perSecond: 14,
};

export const WEAPON = {
  damage: 24,
  headshotMultiplier: 2.0,
  range: 120,
  fireIntervalMs: 120, // ~8 rounds / second
  magazine: 30,
  reloadMs: 1500,
};

// Match flow (Team Deathmatch)
export const MATCH = {
  warmupMs: 6000,
  liveMs: 5 * 60 * 1000, // 5 minute rounds
  endMs: 8000,
  scoreLimit: 50, // first team to this many frags ends the round early
};

export const GRENADE = {
  throwSpeed: 19,
  up: 4.5, // upward boost so it arcs
  fuseMs: 1600,
  radius: 7, // damage radius
  maxDamage: 110,
  cooldownMs: 1400,
  bounce: 0.35, // floor bounce energy kept
  friction: 0.6, // horizontal speed kept on bounce
  gravity: 24,
};

// Rocket launcher (M72 LAW): a fast straight-flying missile that detonates on
// impact (player, terrain or obstacle) with a big area blast.
export const ROCKET = {
  speed: 60, // m/s visual travel speed of the missile
  radius: 8.5, // blast radius (m)
  maxDamage: 140, // damage at the epicentre, falls off to 0 at the radius edge
  range: 260, // max travel before it detonates in the air
};

export const MAX_PLAYERS = 16;

// Client networking
export const INTERP_DELAY_MS = 100; // render remote players this far in the past
