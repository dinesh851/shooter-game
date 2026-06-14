// Player classes (authored by the content workflow). Each maps to one of our
// weapons and scales health + move speed for a distinct playstyle.

import { WeaponId } from "./weapons";

export interface ClassDef {
  id: string;
  name: string;
  weapon: WeaponId;
  healthScale: number; // x base 100 HP
  speedScale: number; // x base move speed
  desc: string;
}

export const CLASSES: ClassDef[] = [
  {
    id: "vanguard",
    name: "Vanguard",
    weapon: "rifle",
    healthScale: 1.0,
    speedScale: 1.0,
    desc: "Balanced all-rounder who holds the line and wins fights at any range.",
  },
  {
    id: "static-burst",
    name: "Static Burst",
    weapon: "smg",
    healthScale: 0.85,
    speedScale: 1.15,
    desc: "Fragile close-range rusher who blitzes objectives and shreds on contact.",
  },
  {
    id: "longwatch",
    name: "Longwatch",
    weapon: "sniper",
    healthScale: 1.2,
    speedScale: 0.95,
    desc: "Patient, tanky marksman who anchors sightlines and one-shots targets.",
  },
  {
    id: "quickdraw-ghost",
    name: "Quickdraw Ghost",
    weapon: "pistol",
    healthScale: 0.8,
    speedScale: 1.25,
    desc: "Hyper-mobile skirmisher who darts around picking off stragglers.",
  },
];

export const DEFAULT_CLASS = "vanguard";

export function getClass(id: string): ClassDef {
  return CLASSES.find((c) => c.id === id) ?? CLASSES[0];
}
