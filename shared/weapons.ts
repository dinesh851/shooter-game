// Weapon definitions shared by client (feel: spread, recoil, ADS, fire mode) and
// server (authority: damage, fire interval, magazine, reload, range).

export type WeaponId = "rifle" | "smg" | "pistol" | "sniper" | "rocket";

export interface WeaponDef {
  id: WeaponId;
  name: string;
  slot: number; // 1..4 select key
  damage: number;
  headshotMult: number;
  fireIntervalMs: number;
  automatic: boolean;
  magazine: number;
  reloadMs: number;
  range: number;
  // client feel
  adsFov: number;
  spreadHip: number; // cone half-angle (radians) firing from the hip
  spreadAds: number; // cone half-angle when aiming down sights
  moveSpreadMult: number; // extra spread while moving
  recoilPitch: number; // upward kick per shot (radians)
  recoilYaw: number; // random horizontal kick per shot (radians)
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  rifle: {
    id: "rifle",
    name: "AR-15 Rifle",
    slot: 1,
    damage: 26,
    headshotMult: 1.8,
    fireIntervalMs: 110,
    automatic: true,
    magazine: 30,
    reloadMs: 2200,
    range: 120,
    adsFov: 55,
    spreadHip: 0.022,
    spreadAds: 0.006,
    moveSpreadMult: 2.2,
    recoilPitch: 0.012,
    recoilYaw: 0.005,
  },
  smg: {
    id: "smg",
    name: "MP5 SMG",
    slot: 2,
    damage: 18,
    headshotMult: 1.4,
    fireIntervalMs: 70,
    automatic: true,
    magazine: 30,
    reloadMs: 1900,
    range: 80,
    adsFov: 62,
    spreadHip: 0.03,
    spreadAds: 0.012,
    moveSpreadMult: 1.7,
    recoilPitch: 0.008,
    recoilYaw: 0.006,
  },
  pistol: {
    id: "pistol",
    name: "P226 Pistol",
    slot: 3,
    damage: 30,
    headshotMult: 2.0,
    fireIntervalMs: 160,
    automatic: false,
    magazine: 12,
    reloadMs: 1400,
    range: 90,
    adsFov: 60,
    spreadHip: 0.02,
    spreadAds: 0.005,
    moveSpreadMult: 1.6,
    recoilPitch: 0.014,
    recoilYaw: 0.004,
  },
  sniper: {
    id: "sniper",
    name: "AWP Sniper",
    slot: 4,
    damage: 100,
    headshotMult: 1.5,
    fireIntervalMs: 1100,
    automatic: false,
    magazine: 5,
    reloadMs: 3000,
    range: 220,
    adsFov: 15,
    spreadHip: 0.07, // brutal from the hip — you must scope
    spreadAds: 0.0009,
    moveSpreadMult: 3.0,
    recoilPitch: 0.04,
    recoilYaw: 0.01,
  },
  rocket: {
    id: "rocket",
    name: "M72 LAW Rocket",
    slot: 5,
    // direct damage is handled by the blast (see ROCKET in constants); this is a
    // nominal value. Single shot, slow reload — a heavy area weapon.
    damage: 130,
    headshotMult: 1.0,
    fireIntervalMs: 900,
    automatic: false,
    magazine: 1,
    reloadMs: 3400,
    range: 260,
    adsFov: 58,
    spreadHip: 0.0, // fires straight where you aim
    spreadAds: 0.0,
    moveSpreadMult: 1.0,
    recoilPitch: 0.06, // heavy kick
    recoilYaw: 0.01,
  },
};

export const WEAPON_LIST: WeaponDef[] = [WEAPONS.rifle, WEAPONS.smg, WEAPONS.pistol, WEAPONS.sniper, WEAPONS.rocket];
export const DEFAULT_WEAPON: WeaponId = "rifle";

export function isWeaponId(s: string): s is WeaponId {
  return s === "rifle" || s === "smg" || s === "pistol" || s === "sniper" || s === "rocket";
}
