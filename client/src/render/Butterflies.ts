// Animated butterflies fluttering through the forest. One skinned GLB (CC0
// swallowtail) is loaded once; each butterfly is a SkeletonUtils clone with its
// own AnimationMixer (wing-flap) and a wandering flight path. They wrap in a
// field around the camera (like the dust motes) so they're always around you for
// a fixed cost, reading as "butterflies all over the map".

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { terrainHeight, WATER_LEVEL } from "../../../shared/terrain";

let template: { scene: THREE.Group; clips: THREE.AnimationClip[] } | null = null;
const waiting: (() => void)[] = [];

export function preloadButterflies() {
  if (template) return;
  new GLTFLoader().load("/models/butterfly.glb", (gltf) => {
    gltf.scene.traverse((o: any) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.frustumCulled = false; // skinned bounds lag the flap; never cull
      }
    });
    template = { scene: gltf.scene as THREE.Group, clips: gltf.animations };
    waiting.forEach((f) => f());
    waiting.length = 0;
  });
}

interface Flutter {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  // toroidal home cell (wraps around the camera) + local wander state
  hx: number;
  hz: number;
  phase: number;
  speed: number;
  turn: number;
  yaw: number;
  baseY: number;
  bob: number;
}

const FIELD = 46; // wrap cell size around the camera (m)
const COUNT = 16;

export class Butterflies {
  readonly group = new THREE.Group();
  private flutters: Flutter[] = [];
  private disposed = false;
  private owned: THREE.Material[] = [];

  constructor() {
    const build = () => {
      if (this.disposed || !template) return;
      for (let i = 0; i < COUNT; i++) this.spawn(i);
    };
    if (template) build();
    else {
      waiting.push(build);
      preloadButterflies();
    }
  }

  private spawn(i: number) {
    if (!template) return;
    const model = skeletonClone(template.scene) as THREE.Group;
    // normalise the (large) source model down to a real butterfly (~16 cm span)
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const holder = new THREE.Group();
    model.scale.setScalar(0.4 / maxDim); // ~40 cm span: visible but still dainty
    // re-tint each wing a subtly different hue so the swarm isn't uniform
    model.traverse((o: any) => {
      if (o.isMesh && o.material) {
        o.material = o.material.clone();
        this.owned.push(o.material);
      }
    });
    holder.add(model);
    this.group.add(holder);

    const mixer = new THREE.AnimationMixer(model);
    if (template.clips[0]) {
      const a = mixer.clipAction(template.clips[0]);
      a.play();
      a.time = (i / COUNT) * (template.clips[0].duration || 1); // desync the flaps
      a.timeScale = 0.8 + (i % 5) * 0.12;
    }

    // pseudo-random spread without Math.random (varies by index)
    const r1 = fract(i * 12.9898 * 1.7);
    const r2 = fract(i * 78.233 * 1.3);
    const r3 = fract(i * 37.719 * 2.1);
    this.flutters.push({
      root: holder,
      mixer,
      hx: (r1 - 0.5) * FIELD,
      hz: (r2 - 0.5) * FIELD,
      phase: r3 * Math.PI * 2,
      speed: 0.7 + r1 * 0.8,
      turn: 0.5 + r2 * 0.7,
      yaw: r3 * Math.PI * 2,
      baseY: 0.7 + r2 * 2.0, // hover height above the ground
      bob: 0.25 + r1 * 0.4,
    });
  }

  // camPos: keep the swarm wrapped around the camera so they're always present
  update(time: number, dt: number, camPos: THREE.Vector3) {
    for (const f of this.flutters) {
      f.mixer.update(dt);
      // gentle wandering yaw so each butterfly weaves around
      f.yaw += Math.sin(time * f.turn + f.phase) * dt * 1.6;
      // home cell wraps toroidally around the camera
      const wx = f.hx + FIELD * Math.floor((camPos.x - f.hx) / FIELD + 0.5);
      const wz = f.hz + FIELD * Math.floor((camPos.z - f.hz) / FIELD + 0.5);
      // local fluttering offset around the home cell
      const ox = Math.sin(time * f.speed + f.phase) * 3.0 + Math.cos(time * 0.6 + f.phase) * 1.2;
      const oz = Math.cos(time * f.speed * 0.9 + f.phase) * 3.0 + Math.sin(time * 0.5 + f.phase) * 1.2;
      const x = wx + ox;
      const z = wz + oz;
      const ground = Math.max(terrainHeight(x, z), WATER_LEVEL);
      const y = ground + f.baseY + Math.sin(time * 2.2 + f.phase) * f.bob;
      const r = f.root;
      r.position.set(x, y, z);
      r.rotation.y = f.yaw;
      // bank/pitch a touch with the bob for a livelier flutter
      r.rotation.z = Math.sin(time * 3.1 + f.phase) * 0.25;
    }
  }

  dispose() {
    this.disposed = true;
    for (const f of this.flutters) f.mixer.stopAllAction();
    for (const m of this.owned) m.dispose();
    this.owned.length = 0;
  }
}

function fract(n: number): number {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
}
