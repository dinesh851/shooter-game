// Realistic remote-player character: the rigged, animated Soldier.glb (from the
// three.js examples; CC-licensed military character with Idle/Walk/Run clips).
// Drop-in replacement for the procedural Character: same public API (root,
// update, setLean, dispose). One template is loaded once; each player gets a
// SkeletonUtils clone with its own AnimationMixer and a team-tinted uniform.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";

let template: { scene: THREE.Group; clips: THREE.AnimationClip[] } | null = null;
const waiting: (() => void)[] = [];

export function preloadSoldier() {
  if (template) return;
  new GLTFLoader().load("/models/Soldier.glb", (gltf) => {
    gltf.scene.traverse((o: any) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false; // skinned bounds lag the animation; never cull
      }
    });
    template = { scene: gltf.scene as THREE.Group, clips: gltf.animations };
    waiting.forEach((f) => f());
    waiting.length = 0;
  });
}

export class Soldier {
  public readonly root = new THREE.Group();
  private mixer?: THREE.AnimationMixer;
  private idle?: THREE.AnimationAction;
  private walk?: THREE.AnimationAction;
  private run?: THREE.AnimationAction;
  private spine?: THREE.Object3D;
  private headBone?: THREE.Object3D;
  private headHidden = false;
  private legsHidden = false;
  private handBone?: THREE.Object3D;
  private armR?: THREE.Object3D;
  private foreR?: THREE.Object3D;
  private armL?: THREE.Object3D;
  private foreL?: THREE.Object3D;
  private handL?: THREE.Object3D;
  private pendingGun?: THREE.Object3D;
  private leanAmt = 0;
  private pitchAmt = 0;
  private crouchK = 0; // smoothed 0..1
  private crouchTarget = 0;
  private dead = false;
  private deadElapsed = 0;
  private model?: THREE.Group;
  private hips?: THREE.Object3D;
  private upLegL?: THREE.Object3D;
  private upLegR?: THREE.Object3D;
  private legL?: THREE.Object3D;
  private legR?: THREE.Object3D;
  private footL?: THREE.Object3D;
  private footR?: THREE.Object3D;
  private ownedMaterials: THREE.Material[] = [];
  private disposed = false;

  constructor(teamColor: number, accent: number) {
    // team ring under the feet so sides read instantly even in fog
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.46, 24),
      new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: 0.55, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    this.root.add(ring);
    this.ownedMaterials.push(ring.material as THREE.Material);

    const build = () => {
      if (this.disposed || !template) return;
      const model = skeletonClone(template.scene) as THREE.Group;
      // tint the uniform hard toward the team colour so sides read at a glance
      // (vivid blue / red). Only a touch of white keeps some texture luminance.
      const tint = new THREE.Color(teamColor).lerp(new THREE.Color(0xffffff), 0.05);
      model.traverse((o: any) => {
        if (o.isMesh && o.material) {
          o.material = o.material.clone();
          (o.material as THREE.MeshStandardMaterial).color.multiply(tint);
          this.ownedMaterials.push(o.material);
        }
        if (!this.spine && o.isBone && /Spine1$/.test(o.name)) this.spine = o;
        if (o.isBone) {
          if (!this.headBone && /Head$/.test(o.name)) this.headBone = o;
          if (!this.handBone && /RightHand$/.test(o.name)) this.handBone = o;
          if (!this.armR && /RightArm$/.test(o.name)) this.armR = o;
          if (!this.foreR && /RightForeArm$/.test(o.name)) this.foreR = o;
          if (!this.handL && /LeftHand$/.test(o.name)) this.handL = o;
          if (!this.armL && /LeftArm$/.test(o.name)) this.armL = o;
          if (!this.foreL && /LeftForeArm$/.test(o.name)) this.foreL = o;
          if (!this.hips && /Hips$/.test(o.name)) this.hips = o;
          if (!this.upLegL && /LeftUpLeg$/.test(o.name)) this.upLegL = o;
          if (!this.upLegR && /RightUpLeg$/.test(o.name)) this.upLegR = o;
          if (!this.legL && /LeftLeg$/.test(o.name)) this.legL = o;
          if (!this.legR && /RightLeg$/.test(o.name)) this.legR = o;
          if (!this.footL && /LeftFoot$/.test(o.name)) this.footL = o;
          if (!this.footR && /RightFoot$/.test(o.name)) this.footR = o;
        }
      });
      // the soldier natively faces -Z; flip it to match the Scene's "+Z model,
      // yaw + PI" convention so players look where they aim
      model.rotation.y = Math.PI;
      this.root.add(model);
      this.model = model;

      this.mixer = new THREE.AnimationMixer(model);
      for (const clip of template.clips) {
        const a = this.mixer.clipAction(clip);
        a.play();
        a.setEffectiveWeight(0);
        if (/idle/i.test(clip.name)) this.idle = a;
        else if (/walk/i.test(clip.name)) this.walk = a;
        else if (/run/i.test(clip.name)) this.run = a;
      }
      this.idle?.setEffectiveWeight(1);
      this.mountGun(); // a gun may have been attached before the model arrived
    };
    if (template) build();
    else {
      waiting.push(build);
      preloadSoldier();
    }
    void accent; // accent colour not needed on the textured model
  }

  // Put the gun IN the right hand: parented to the hand bone so it follows the
  // animation. Pass a holder whose +Z is the gun's muzzle direction; after the
  // first animated frame the holder is aligned to the character's facing
  // mathematically (no per-rig axis guessing).
  private gunHolder?: THREE.Object3D;
  private gunAligned = false;

  attachGun(holder: THREE.Object3D): void {
    this.pendingGun = holder;
    this.mountGun();
  }

  private mountGun(): void {
    if (!this.pendingGun || !this.handBone) return;
    const holder = this.pendingGun;
    this.pendingGun = undefined;
    // bones can carry inherited scale — cancel it so the gun keeps world size
    this.handBone.updateWorldMatrix(true, false);
    const ws = new THREE.Vector3();
    this.handBone.getWorldScale(ws);
    holder.scale.setScalar(1 / (ws.x || 1));
    this.handBone.add(holder);
    this.gunHolder = holder;
    this.gunAligned = false;
  }

  // PUBG-style two-handed hold: every frame (after the mixer) the arm chains
  // are bent so the right hand sits at the grip and the left hand reaches the
  // handguard. Pure world-space aiming — no rig-specific axis assumptions.
  private poseArms(): void {
    this.root.updateWorldMatrix(true, false);
    const m = this.root.matrixWorld;
    // the whole aim frame tilts with the player's pitch around a chest pivot,
    // so the gun and both hands track where they're looking (up/down)
    _qPitch.setFromAxisAngle(_xAxis, -this.pitchAmt);
    // anchor the grip to the ANIMATED chest (spine) instead of a fixed body
    // point, so the weapon stays glued to the torso through the walk/run bob
    // rather than the arms stretching toward a static target (which flailed).
    let cx = 0.04, cy = 1.30, cz = 0.0; // fallback chest, in root-local space
    if (this.spine) {
      const sp = this.spine.getWorldPosition(_v3);
      this.root.worldToLocal(sp);
      cx = sp.x; cy = sp.y; cz = sp.z;
    }
    const gripR = aimTarget(_t1.set(cx + 0.06, cy - 0.12, cz + 0.34), m);
    const gripL = aimTarget(_t2.set(cx - 0.04, cy - 0.04, cz + 0.52), m);
    if (this.armR && this.foreR && this.handBone) {
      aimBone(this.armR, this.foreR, gripR);
      aimBone(this.foreR, this.handBone, gripR);
    }
    if (this.armL && this.foreL && this.handL) {
      aimBone(this.armL, this.foreL, gripL);
      aimBone(this.foreL, this.handL, gripL);
    }
  }

  private alignGun(): void {
    if (!this.gunHolder || !this.handBone) return;
    this.handBone.updateWorldMatrix(true, false);
    // orientation: character facing tilted by the look pitch, so the muzzle
    // follows the player's aim up/down
    const bq = this.handBone.getWorldQuaternion(_q1).invert();
    const rq = this.root.getWorldQuaternion(_q2).multiply(_qPitch);
    this.gunHolder.quaternion.copy(_q3.copy(bq).multiply(rq));
    // position: gun centre slightly up/forward of the grip hand (aim space),
    // converted into hand-bone space
    const desired = this.handBone.getWorldPosition(_v1);
    _v2.set(0, 0.05, 0.17).applyQuaternion(rq);
    desired.add(_v2);
    this.gunHolder.position.copy(this.handBone.worldToLocal(desired));
    this.gunAligned = true;
  }

  update(dt: number, speedNorm: number, _grounded: boolean): void {
    if (!this.mixer) return;

    // death: freeze the clip pose and fall backwards over half a second
    if (this.dead) {
      this.deadElapsed += dt;
      if (this.model) {
        const k = Math.min(1, this.deadElapsed / 0.5);
        const e = 1 - (1 - k) * (1 - k); // ease-out
        this.model.rotation.x = (-Math.PI / 2) * e;
        this.model.position.y = 0.15 * e; // pivot is at the feet; lift slightly so the body lies flat
      }
      return;
    }

    // blend idle -> walk -> run by horizontal speed
    const s = Math.min(1, speedNorm);
    const runW = THREE.MathUtils.smoothstep(s, 0.45, 0.9);
    const walkW = Math.min(THREE.MathUtils.smoothstep(s, 0.03, 0.3), 1 - runW);
    const idleW = Math.max(0, 1 - walkW - runW);
    this.idle?.setEffectiveWeight(idleW);
    this.walk?.setEffectiveWeight(walkW);
    this.run?.setEffectiveWeight(runW);
    this.mixer.update(dt);

    // first-person: collapse the head bone so the camera (at the eyes) isn't
    // looking at the inside of the skull. Re-applied each frame in case a clip
    // animates head scale.
    if (this.headBone) this.headBone.scale.setScalar(this.headHidden ? 1e-3 : 1);

    // crouch: sink the hips and IK the legs so the feet stay planted
    this.crouchK += (this.crouchTarget - this.crouchK) * Math.min(1, dt * 10);
    if (this.crouchK > 0.01) this.poseCrouch();

    // look up/down: bend the spine BEFORE the arms aim, so shoulders move too
    if (this.spine && Math.abs(this.pitchAmt) > 0.01) {
      this.spine.rotation.x -= this.pitchAmt * 0.45;
    }
    if (this.gunHolder) {
      this.poseArms(); // two-handed weapon hold over the clip
      this.alignGun(); // rigid hold: gun re-stabilized at the hands every frame
    }
    // peek: bend the spine after the mixer has posed the skeleton
    if (this.spine && Math.abs(this.leanAmt) > 0.01) {
      this.spine.rotation.z += this.leanAmt * 0.45;
    }

    // first-person: collapse the legs so only the arms + gun (a clean viewmodel)
    // show, instead of the whole body filling the screen when looking down.
    if (this.legsHidden) {
      this.upLegL?.scale.setScalar(1e-3);
      this.upLegR?.scale.setScalar(1e-3);
    }
  }

  // crouch IK: capture where the feet are, drop the hips, then re-aim each leg
  // chain (thigh toward a forward knee point, shin back to the planted foot)
  private poseCrouch(): void {
    if (!this.hips) return;
    const k = this.crouchK;
    const footPosL = this.footL ? this.footL.getWorldPosition(_fL) : null;
    const footPosR = this.footR ? this.footR.getWorldPosition(_fR) : null;
    this.root.updateWorldMatrix(true, false);
    const fwd = _v3.set(0, 0, 1).transformDirection(this.root.matrixWorld);

    this.hips.position.y -= 0.34 * k; // bone-local ≈ metres on this rig
    if (this.spine) this.spine.rotation.x += 0.25 * k; // hunch forward a touch

    if (this.upLegL && this.legL && this.footL && footPosL) {
      _kt.copy(footPosL).lerp(this.upLegL.getWorldPosition(_v1), 0.5).addScaledVector(fwd, 0.28 * k);
      aimBone(this.upLegL, this.legL, _kt);
      aimBone(this.legL, this.footL, footPosL);
    }
    if (this.upLegR && this.legR && this.footR && footPosR) {
      _kt.copy(footPosR).lerp(this.upLegR.getWorldPosition(_v1), 0.5).addScaledVector(fwd, 0.28 * k);
      aimBone(this.upLegR, this.legR, _kt);
      aimBone(this.legR, this.footR, footPosR);
    }
  }

  setLean(amount: number): void {
    this.leanAmt = Math.max(-1, Math.min(1, amount));
  }

  setPitch(pitch: number): void {
    this.pitchAmt = Math.max(-1.2, Math.min(1.2, pitch));
  }

  setCrouch(crouch: boolean): void {
    this.crouchTarget = crouch ? 1 : 0;
  }

  // hide the head in first-person so the camera at the eyes sees only arms/gun
  setHeadHidden(hidden: boolean): void {
    this.headHidden = hidden;
  }

  // hide the legs in first-person so only the arms + gun fill the view
  setLegsHidden(hidden: boolean): void {
    if (this.legsHidden === hidden) return;
    this.legsHidden = hidden;
    if (!hidden) {
      this.upLegL?.scale.setScalar(1);
      this.upLegR?.scale.setScalar(1);
    }
  }

  // death/respawn: true plays a fall-over, false restores the standing pose
  setDead(dead: boolean): void {
    if (dead === this.dead) return;
    this.dead = dead;
    this.deadElapsed = 0;
    if (!dead && this.model) {
      this.model.rotation.x = 0;
      this.model.position.y = 0;
    }
  }

  get deathTime(): number {
    return this.dead ? this.deadElapsed : 0;
  }

  dispose(): void {
    this.disposed = true;
    this.mixer?.stopAllAction();
    // geometry is shared with the template — dispose only our cloned materials
    for (const m of this.ownedMaterials) m.dispose();
    this.ownedMaterials.length = 0;
  }
}

// Rotate `bone` (minimal twist) so the direction toward its child points at
// `targetWorld`. The child's local position is the bone's outgoing direction,
// so this works on any rig regardless of how its local axes are oriented.
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _qPitch = new THREE.Quaternion();
const _xAxis = new THREE.Vector3(1, 0, 0);
const _fL = new THREE.Vector3();
const _fR = new THREE.Vector3();
const _kt = new THREE.Vector3();
const _pivot = new THREE.Vector3(0, 1.3, 0); // chest height — the aim frame tilts here

// character-space target -> world, tilted by the current pitch around the chest
function aimTarget(local: THREE.Vector3, rootMatrix: THREE.Matrix4): THREE.Vector3 {
  local.sub(_pivot).applyQuaternion(_qPitch).add(_pivot);
  return local.applyMatrix4(rootMatrix);
}

function aimBone(bone: THREE.Object3D, child: THREE.Object3D, targetWorld: THREE.Vector3): void {
  bone.updateWorldMatrix(true, false);
  const bonePos = bone.getWorldPosition(_v1);
  const bwq = bone.getWorldQuaternion(_q1);
  const childLocalDir = _v2.copy(child.position).normalize();
  const desiredLocal = _v3.copy(targetWorld).sub(bonePos).normalize().applyQuaternion(_q2.copy(bwq).invert());
  _q2.setFromUnitVectors(childLocalDir, desiredLocal);
  bone.quaternion.multiply(_q2);
}
