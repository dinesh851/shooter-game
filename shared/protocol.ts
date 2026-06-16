// Wire protocol: message names (client -> server) and event names (server ->
// client broadcasts). Payloads are plain JSON objects.

export const Msg = {
  Input: "i",
  Shoot: "s",
  Reload: "r",
  Switch: "w", // switch weapon: { weapon: WeaponId }
  Grenade: "g", // throw grenade: GrenadeCmd (origin + direction + cook time)
  SelectTeam: "t", // lobby: { team: 0 | 1 }
  Ready: "rd", // lobby: { ready: boolean }
  Start: "st", // lobby: host starts the match
  AddBot: "ab", // lobby: host adds a practice bot
  Ping: "pg", // spot/ping for teammates: { x, y, z }
  Lat: "lt", // latency probe: { t } echoed straight back by the server
  Weather: "wx", // host only: { w: "sunny" | "mist" | "heavy" | "rain" }
  Admin: "adm", // claim admin with a password: { password } (also takes host)
  EndMatch: "endm", // admin: force the match back to the lobby for everyone
  SetName: "nm", // change your callsign (lobby only): { name }
} as const;

export const WEATHER_KINDS = ["sunny", "mist", "heavy", "rain"] as const;

export interface SwitchCmd {
  weapon: string;
}

export interface ShootCmd {
  ox: number; // ray origin (eye position)
  oy: number;
  oz: number;
  dx: number; // normalized direction
  dy: number;
  dz: number;
  clientTime: number;
}

export interface GrenadeCmd extends ShootCmd {
  heldMs?: number; // how long the grenade was cooked before the throw
}

export const Ev = {
  Tracer: "tracer", // render a shot tracer
  Hit: "hit", // a player took damage (blood / hitmarker)
  Kill: "kill", // killfeed entry
  GrenadeThrow: "gt", // a grenade was thrown (spawn the flying visual)
  Rocket: "rk", // a rocket was launched (spawn the flying missile + trail)
  Explosion: "ex", // a grenade/rocket exploded (FX)
  Ping: "ping", // a teammate pinged a location
} as const;

export interface PingEv {
  x: number;
  y: number;
  z: number;
  by: string; // player name
}

export interface GrenadeThrowEv {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  fuseMs: number;
}

export interface RocketEv {
  id: number;
  ox: number; // launch origin
  oy: number;
  oz: number;
  ex: number; // impact point (where it will detonate)
  ey: number;
  ez: number;
  travelMs: number; // flight time from origin to impact
}

export interface ExplosionEv {
  x: number;
  y: number;
  z: number;
}

export interface TracerEv {
  ox: number;
  oy: number;
  oz: number;
  ex: number;
  ey: number;
  ez: number;
  shooter: string;
}

export interface HitEv {
  x: number;
  y: number;
  z: number;
  victim: string;
  shooter: string;
}

export interface KillEv {
  killer: string;
  killerName: string;
  victim: string;
  victimName: string;
  head: boolean;
}
