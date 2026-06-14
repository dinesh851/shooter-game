// Landmark visuals: load each survival-pack model once and place it at every
// prop location from shared/terrain.ts LANDMARKS, scaled to the prop's
// collision footprint. ("rock" props are rendered by the boulder path instead.)

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { LANDMARKS, terrainHeight } from "../../../shared/terrain";

export class Landmarks {
  readonly group = new THREE.Group();

  constructor() {
    const loader = new GLTFLoader();
    const byModel = new Map<string, { x: number; z: number; yaw: number; w: number; h: number; d: number }[]>();
    for (const lm of LANDMARKS) {
      for (const pr of lm.props) {
        if (pr.model === "rock") continue;
        let arr = byModel.get(pr.model);
        if (!arr) byModel.set(pr.model, (arr = []));
        arr.push(pr);
      }
    }

    byModel.forEach((placements, model) => {
      // "@name" loads from /models/ (downloaded one-offs); rest from the survival pack
      const url = model.startsWith("@") ? `/models/${model.slice(1)}.glb` : `/models/survival/${model}.glb`;
      loader.load(url, (g) => {
        g.scene.traverse((o: any) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        const box = new THREE.Box3().setFromObject(g.scene);
        const size = new THREE.Vector3();
        box.getSize(size);
        for (const pr of placements) {
          const m = g.scene.clone(true);
          // scale so the model fills its collision footprint
          const s = Math.min(pr.w / (size.x || 1), pr.h / (size.y || 1), pr.d / (size.z || 1));
          m.scale.setScalar(s);
          m.rotation.y = pr.yaw; // rotate first so the recentring box is final
          // recentre on the footprint: downloaded models can sit far off-origin
          const b2 = new THREE.Box3().setFromObject(m);
          const cx = (b2.min.x + b2.max.x) / 2;
          const cz = (b2.min.z + b2.max.z) / 2;
          m.position.set(pr.x - cx, terrainHeight(pr.x, pr.z) - b2.min.y, pr.z - cz);
          this.group.add(m);
        }
      });
    });
  }
}
