// A clean, stylized LOW-POLY humanoid for a Krunker-style FPS. Self-contained:
// no external assets, no texture loads, no GLTF. Built from box/primitive meshes
// and animated procedurally. The whole model is assembled in "natural" units and
// then uniformly scaled so its standing bounding-box height equals PLAYER_HEIGHT,
// with the feet sitting at local y = 0. The character faces +Z (forward).
//
// Animation is fully DETERMINISTIC: the walk-cycle phase is derived from an
// accumulated dt stored on the instance (no Date, no performance.now, no random).

import * as THREE from "three";
import { PLAYER_HEIGHT } from "../../../shared/phys";

// Proportions (in arbitrary "build" units; the group is scaled to PLAYER_HEIGHT
// afterwards). Keeping segment counts tiny keeps the silhouette crisp at range.
const HEAD_SIZE = 0.52;
const NECK_H = 0.06;
const TORSO_W = 0.62;
const TORSO_H = 0.78;
const TORSO_D = 0.34;
const HIP_H = 0.18;
const UPPER_ARM_LEN = 0.42;
const LOWER_ARM_LEN = 0.4;
const ARM_W = 0.18;
const UPPER_LEG_LEN = 0.5;
const LOWER_LEG_LEN = 0.48;
const LEG_W = 0.22;
const FOOT_LEN = 0.34;
const FOOT_H = 0.12;

// Skin tone for the head; team/accent come from the constructor.
const SKIN_COLOR = 0xe0a479;

export class Character {
  public readonly root: THREE.Group;

  // Limb pivot groups (rotated to swing the limbs). Each pivot sits at the
  // shoulder/hip joint, and the limb meshes hang DOWN from it, so rotating the
  // pivot about X swings the limb naturally around the joint.
  private readonly leftArm: THREE.Group;
  private readonly rightArm: THREE.Group;
  private readonly leftLeg: THREE.Group;
  private readonly rightLeg: THREE.Group;

  // Sub-pivots for the elbows/knees so limbs can bend, not just swing rigidly.
  private readonly leftElbow: THREE.Group;
  private readonly rightElbow: THREE.Group;
  private readonly leftKnee: THREE.Group;
  private readonly rightKnee: THREE.Group;

  private leanPivotY = 0;

  // Upper-body group used for the breathing bob / crouch tuck.
  private readonly upper: THREE.Group;
  private readonly headPivot: THREE.Group;

  // Accumulated, deterministic animation time (seconds of "phase progress").
  private phase = 0;
  // Smoothed inputs so transitions between idle/run/air read cleanly.
  private speedSmooth = 0;
  private airSmooth = 0; // 0 = grounded, 1 = airborne

  // Shared materials (reused across many meshes for efficiency).
  private readonly teamMat: THREE.MeshStandardMaterial;
  private readonly accentMat: THREE.MeshStandardMaterial;
  private readonly skinMat: THREE.MeshStandardMaterial;

  constructor(teamColor: number, accentColor: number) {
    this.teamMat = new THREE.MeshStandardMaterial({
      color: teamColor,
      roughness: 0.62,
      metalness: 0.08,
      emissive: new THREE.Color(teamColor),
      emissiveIntensity: 0.06,
      flatShading: true,
    });
    this.accentMat = new THREE.MeshStandardMaterial({
      color: accentColor,
      roughness: 0.35,
      metalness: 0.25,
      emissive: new THREE.Color(accentColor),
      emissiveIntensity: 0.5,
      flatShading: true,
    });
    this.skinMat = new THREE.MeshStandardMaterial({
      color: SKIN_COLOR,
      roughness: 0.78,
      metalness: 0.0,
      flatShading: true,
    });

    // Build everything in a temporary "build" group, then scale + recenter feet.
    const build = new THREE.Group();

    // The upper body (torso + head + arms) is held in a group so we can bob it
    // for breathing/crouch without affecting the planted feet.
    this.upper = new THREE.Group();
    build.add(this.upper);

    // ---- legs (built first so we know hip height) -------------------------
    // Feet rest at y = 0. Stack: foot -> lower leg -> upper leg -> hips.
    const legTopY = FOOT_H + LOWER_LEG_LEN + UPPER_LEG_LEN; // top of the legs
    const hipY = legTopY; // hip joints sit at the top of the upper legs

    const legSpread = TORSO_W * 0.27;

    this.leftLeg = this.buildLeg(-legSpread, hipY, +1);
    this.rightLeg = this.buildLeg(+legSpread, hipY, -1);
    // Legs attach to the planted "build" group (NOT the bobbing upper body) so
    // they stay grounded; only their pivots rotate.
    build.add(this.leftLeg);
    build.add(this.rightLeg);
    // Stash knee sub-pivots created inside buildLeg.
    this.leftKnee = this.leftLeg.userData.knee as THREE.Group;
    this.rightKnee = this.rightLeg.userData.knee as THREE.Group;

    // ---- hips block -------------------------------------------------------
    const hips = new THREE.Mesh(
      new THREE.BoxGeometry(TORSO_W * 0.92, HIP_H, TORSO_D * 0.95),
      this.teamMat
    );
    hips.position.set(0, hipY + HIP_H * 0.5, 0);
    this.prep(hips);
    this.upper.add(hips);
    this.leanPivotY = hipY + HIP_H * 0.5; // peek bends here, not at the feet

    // ---- torso ------------------------------------------------------------
    const torsoY = hipY + HIP_H + TORSO_H * 0.5;
    const torso = new THREE.Mesh(
      new THREE.BoxGeometry(TORSO_W, TORSO_H, TORSO_D),
      this.teamMat
    );
    torso.position.set(0, torsoY, 0);
    this.prep(torso);
    this.upper.add(torso);

    // Chest accent stripe (reads team/role from a distance, faces forward +Z).
    const chestStripe = new THREE.Mesh(
      new THREE.BoxGeometry(TORSO_W * 0.5, TORSO_H * 0.18, 0.03),
      this.accentMat
    );
    chestStripe.position.set(0, torsoY + TORSO_H * 0.12, TORSO_D * 0.5 + 0.015);
    this.prep(chestStripe);
    this.upper.add(chestStripe);

    // Small backpack-ish block so the back reads differently from the front.
    const pack = new THREE.Mesh(
      new THREE.BoxGeometry(TORSO_W * 0.7, TORSO_H * 0.6, 0.14),
      this.teamMat
    );
    pack.position.set(0, torsoY + TORSO_H * 0.05, -TORSO_D * 0.5 - 0.06);
    this.prep(pack);
    this.upper.add(pack);

    // ---- head + helmet ----------------------------------------------------
    const neckTopY = torsoY + TORSO_H * 0.5 + NECK_H;
    // headPivot lets the head nod subtly during the idle/air poses.
    this.headPivot = new THREE.Group();
    this.headPivot.position.set(0, neckTopY, 0);
    this.upper.add(this.headPivot);

    const neck = new THREE.Mesh(
      new THREE.BoxGeometry(TORSO_W * 0.34, NECK_H * 2, TORSO_D * 0.5),
      this.skinMat
    );
    neck.position.set(0, -NECK_H, 0);
    this.prep(neck);
    this.headPivot.add(neck);

    const head = new THREE.Mesh(
      // A lightly rounded box: bevelled corners via a low-detail RoundedBox feel
      // are avoided to keep it dependency-free; a plain box reads cleanly.
      new THREE.BoxGeometry(HEAD_SIZE, HEAD_SIZE, HEAD_SIZE * 0.92),
      this.skinMat
    );
    head.position.set(0, HEAD_SIZE * 0.5, 0);
    this.prep(head);
    this.headPivot.add(head);

    // Helmet: a slightly larger team-colored shell over the top of the head.
    const helmet = new THREE.Mesh(
      new THREE.BoxGeometry(HEAD_SIZE * 1.08, HEAD_SIZE * 0.55, HEAD_SIZE * 1.0),
      this.teamMat
    );
    helmet.position.set(0, HEAD_SIZE * 0.78, -0.01);
    this.prep(helmet);
    this.headPivot.add(helmet);

    // Helmet accent stripe across the top (instant team ID from above).
    const helmetStripe = new THREE.Mesh(
      new THREE.BoxGeometry(HEAD_SIZE * 0.22, HEAD_SIZE * 0.6, HEAD_SIZE * 1.04),
      this.accentMat
    );
    helmetStripe.position.set(0, HEAD_SIZE * 0.8, 0);
    this.prep(helmetStripe);
    this.headPivot.add(helmetStripe);

    // Visor: an accent-colored band across the front of the face.
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(HEAD_SIZE * 0.86, HEAD_SIZE * 0.26, 0.04),
      this.accentMat
    );
    visor.position.set(0, HEAD_SIZE * 0.52, HEAD_SIZE * 0.47);
    this.prep(visor);
    this.headPivot.add(visor);

    // ---- arms -------------------------------------------------------------
    // Shoulder joints sit near the top of the torso, just outside its width.
    const shoulderY = torsoY + TORSO_H * 0.4;
    const shoulderX = TORSO_W * 0.5 + ARM_W * 0.4;

    this.leftArm = this.buildArm(-shoulderX, shoulderY);
    this.rightArm = this.buildArm(+shoulderX, shoulderY);
    this.upper.add(this.leftArm);
    this.upper.add(this.rightArm);
    this.leftElbow = this.leftArm.userData.elbow as THREE.Group;
    this.rightElbow = this.rightArm.userData.elbow as THREE.Group;

    // ---- scale to PLAYER_HEIGHT, feet at y = 0 ----------------------------
    this.root = new THREE.Group();
    this.root.rotation.order = "YXZ"; // yaw (Y) then lean roll (Z) about the facing axis
    this.root.add(build);

    const box = new THREE.Box3().setFromObject(build);
    const h = box.max.y - box.min.y || 1;
    const scale = PLAYER_HEIGHT / h;
    build.scale.setScalar(scale);

    // Recenter so the lowest point (feet) sits exactly at local y = 0.
    const box2 = new THREE.Box3().setFromObject(build);
    build.position.y -= box2.min.y;

    this.root.frustumCulled = false;
  }

  // Build one arm: a pivot at the shoulder, an upper-arm mesh hanging down, then
  // an elbow sub-pivot with the forearm + a gloved hand.
  private buildArm(x: number, y: number): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);

    const upper = new THREE.Mesh(
      new THREE.BoxGeometry(ARM_W, UPPER_ARM_LEN, ARM_W),
      this.teamMat
    );
    upper.position.set(0, -UPPER_ARM_LEN * 0.5, 0);
    this.prep(upper);
    pivot.add(upper);

    // Shoulder pad accent so arms read clearly from a distance.
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(ARM_W * 1.25, ARM_W * 0.7, ARM_W * 1.25),
      this.accentMat
    );
    pad.position.set(0, -ARM_W * 0.15, 0);
    this.prep(pad);
    pivot.add(pad);

    const elbow = new THREE.Group();
    elbow.position.set(0, -UPPER_ARM_LEN, 0);
    pivot.add(elbow);

    const lower = new THREE.Mesh(
      new THREE.BoxGeometry(ARM_W * 0.9, LOWER_ARM_LEN, ARM_W * 0.9),
      this.skinMat
    );
    lower.position.set(0, -LOWER_ARM_LEN * 0.5, 0);
    this.prep(lower);
    elbow.add(lower);

    const hand = new THREE.Mesh(
      new THREE.BoxGeometry(ARM_W * 1.05, ARM_W * 0.8, ARM_W * 1.05),
      this.teamMat
    );
    hand.position.set(0, -LOWER_ARM_LEN - ARM_W * 0.3, 0);
    this.prep(hand);
    elbow.add(hand);

    pivot.userData.elbow = elbow;
    return pivot;
  }

  // Build one leg: pivot at the hip, upper-leg hanging down, knee sub-pivot with
  // the lower leg + a forward-pointing foot. `toeSign` aims the foot toward +Z.
  private buildLeg(x: number, y: number, _toeSign: number): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);

    const upper = new THREE.Mesh(
      new THREE.BoxGeometry(LEG_W, UPPER_LEG_LEN, LEG_W),
      this.teamMat
    );
    upper.position.set(0, -UPPER_LEG_LEN * 0.5, 0);
    this.prep(upper);
    pivot.add(upper);

    const knee = new THREE.Group();
    knee.position.set(0, -UPPER_LEG_LEN, 0);
    pivot.add(knee);

    const lower = new THREE.Mesh(
      new THREE.BoxGeometry(LEG_W * 0.86, LOWER_LEG_LEN, LEG_W * 0.86),
      this.teamMat
    );
    lower.position.set(0, -LOWER_LEG_LEN * 0.5, 0);
    this.prep(lower);
    knee.add(lower);

    // Foot points forward (+Z). It is parented to the knee so it follows the
    // shin; small offset forward gives the classic stylized "boot".
    const foot = new THREE.Mesh(
      new THREE.BoxGeometry(LEG_W * 0.95, FOOT_H, FOOT_LEN),
      this.accentMat
    );
    foot.position.set(0, -LOWER_LEG_LEN - FOOT_H * 0.5, FOOT_LEN * 0.22);
    this.prep(foot);
    knee.add(foot);

    pivot.userData.knee = knee;
    return pivot;
  }

  // Common mesh setup: shadows on, never culled (so it animates off-screen too).
  private prep(m: THREE.Mesh) {
    m.castShadow = true;
    m.frustumCulled = false;
  }

  /**
   * Advance the procedural animation.
   * @param dt        seconds since last update (real, but only ACCUMULATED — no clock read).
   * @param speedNorm 0 = idle, 1 = full run (horizontal speed normalized by max).
   * @param grounded  false = airborne (applies a small crouch/tuck).
   */
  // Peek/lean: tilt ONLY the upper body, pivoting at the hips — the legs stay
  // planted. (Rolling the whole root made the character rotate like a plank.)
  setLean(amount: number): void {
    const t = Math.max(-1, Math.min(1, amount)) * 0.42;
    this.upper.rotation.z = t;
    this.upper.position.x = Math.sin(t) * this.leanPivotY;
  }

  update(dt: number, speedNorm: number, grounded: boolean): void {
    const d = Math.max(0, dt);
    const sn = clamp01(speedNorm);

    // Smooth the inputs a touch so pose blends are not jarring on state flips.
    const k = 1 - Math.pow(0.0001, d); // ~frame-rate-independent smoothing
    this.speedSmooth += (sn - this.speedSmooth) * k;
    this.airSmooth += ((grounded ? 0 : 1) - this.airSmooth) * k;

    const s = this.speedSmooth;
    const air = this.airSmooth;

    // Walk-cycle frequency scales with speed: idle barely cycles, run cycles
    // fast. The phase is purely accumulated from dt (deterministic).
    const cadence = 2.2 + s * 7.0; // radians/sec of leg swing at full run
    this.phase += d * cadence;
    // Keep phase bounded to avoid float blow-up over long sessions.
    if (this.phase > Math.PI * 2e6) this.phase -= Math.PI * 2e6;

    const ph = this.phase;
    const swing = Math.sin(ph);
    const swingCos = Math.cos(ph);

    // Amplitude of limb swing grows with run speed.
    const legAmp = 0.95 * s;
    const armAmp = 0.8 * s;

    // ---- legs swing in opposition -----------------------------------------
    // Left/right legs are 180 deg out of phase. Forward swing = negative X rot
    // (so the knee/foot comes toward +Z, the forward direction).
    this.leftLeg.rotation.x = -swing * legAmp;
    this.rightLeg.rotation.x = swing * legAmp;

    // Knees bend most as the leg passes under the body (lift phase). Use a
    // rectified cosine so the bend is always a flex (>= 0), never hyperextend.
    const leftKneeBend = Math.max(0, swingCos) * 1.2 * s;
    const rightKneeBend = Math.max(0, -swingCos) * 1.2 * s;
    this.leftKnee.rotation.x = leftKneeBend;
    this.rightKnee.rotation.x = rightKneeBend;

    // ---- arms swing opposite their same-side leg --------------------------
    // Right arm matches left leg's forward swing (natural counter-rotation).
    this.rightArm.rotation.x = -swing * armAmp;
    this.leftArm.rotation.x = swing * armAmp;
    // A little outward flare and constant elbow flex so arms don't clip torso.
    this.leftArm.rotation.z = 0.08;
    this.rightArm.rotation.z = -0.08;
    this.leftElbow.rotation.x = 0.25 + Math.max(0, -swing) * 0.5 * s;
    this.rightElbow.rotation.x = 0.25 + Math.max(0, swing) * 0.5 * s;

    // ---- idle breathing bob (only meaningful when nearly stopped) ---------
    // Use a slow secondary sinusoid driven by the same accumulated phase.
    const idleWeight = 1 - s; // strongest at full idle
    const breathe = Math.sin(ph * 0.35) * 0.02 * idleWeight;
    // A run bob: the torso dips twice per stride (|sin| at 2x).
    const runBob = -Math.abs(Math.sin(ph)) * 0.06 * s;

    // ---- airborne crouch / tuck -------------------------------------------
    // When not grounded, tuck the legs up and lower the torso slightly.
    const tuck = air;
    this.leftLeg.rotation.x += tuck * 0.7;
    this.rightLeg.rotation.x += tuck * 0.7;
    this.leftKnee.rotation.x += tuck * 0.9;
    this.rightKnee.rotation.x += tuck * 0.9;
    // Arms come up a bit when airborne.
    this.leftArm.rotation.x -= tuck * 0.4;
    this.rightArm.rotation.x -= tuck * 0.4;

    // Apply vertical bob + crouch to the upper body. The tuck lowers the chest
    // toward the (still-planted) hips for a compact mid-air pose.
    this.upper.position.y = breathe + runBob - tuck * 0.08;
    // Lean very slightly forward at speed (reads as momentum), and forward in air.
    this.upper.rotation.x = -s * 0.12 - air * 0.18;

    // Subtle head counter-nod so the head stays level-ish while the torso leans.
    this.headPivot.rotation.x = s * 0.06 + air * 0.1 + breathe * 0.8;
  }

  // Free all GPU resources this character owns. MUST be called when the remote
  // leaves, otherwise the geometries/materials leak VRAM (scene.remove alone does
  // not free them) and the tab eventually crashes. Only disposes geometry/material
  // built by this instance — externally-attached props (e.g. a shared gun clone)
  // must be detached by the caller first.
  dispose(): void {
    this.root.traverse((o: any) => {
      if (o.isMesh && o.geometry) o.geometry.dispose();
    });
    this.teamMat.dispose();
    this.accentMat.dispose();
    this.skinMat.dispose();
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Approximate standing height of the "build-unit" character before it is scaled to
// PLAYER_HEIGHT (top of helmet with feet at 0). Used to size the first-person arms
// to the same real-world scale as the remote player characters.
const BUILD_HEIGHT =
  FOOT_H + LOWER_LEG_LEN + UPPER_LEG_LEN + HIP_H + TORSO_H + NECK_H + HEAD_SIZE * 1.28;

export interface FirstPersonArms {
  group: THREE.Group; // add this to the weapon view-model group
  setTeamColor: (hex: number) => void;
  dispose: () => void;
}

// Build the local player's first-person arms from the SAME geometry, proportions,
// and materials as the Character used for every remote player: a team-coloured
// upper arm + accent shoulder pad + skin forearm + team-coloured glove. Each arm is
// scaled to the character's real-world size and aimed so its hand sits on the gun.
export function makeFirstPersonArms(teamColor: number, accentColor: number): FirstPersonArms {
  const teamMat = new THREE.MeshStandardMaterial({
    color: teamColor, roughness: 0.62, metalness: 0.08,
    emissive: new THREE.Color(teamColor), emissiveIntensity: 0.06, flatShading: true,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: accentColor, roughness: 0.35, metalness: 0.25,
    emissive: new THREE.Color(accentColor), emissiveIntensity: 0.5, flatShading: true,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: SKIN_COLOR, roughness: 0.78, metalness: 0.0, flatShading: true,
  });

  const scale = PLAYER_HEIGHT / BUILD_HEIGHT; // same arm size as a remote character
  // full straight-arm reach (shoulder pivot to hand centre), in metres
  const reach = (UPPER_ARM_LEN + LOWER_ARM_LEN + ARM_W * 0.3) * scale;

  // one arm exactly like Character.buildArm, but as a standalone limb
  const buildArm = (): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.scale.setScalar(scale); // children are in build-units; pose is in metres
    const upper = new THREE.Mesh(new THREE.BoxGeometry(ARM_W, UPPER_ARM_LEN, ARM_W), teamMat);
    upper.position.set(0, -UPPER_ARM_LEN * 0.5, 0);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(ARM_W * 1.25, ARM_W * 0.7, ARM_W * 1.25), accentMat);
    pad.position.set(0, -ARM_W * 0.15, 0);
    const elbow = new THREE.Group();
    elbow.position.set(0, -UPPER_ARM_LEN, 0);
    const lower = new THREE.Mesh(new THREE.BoxGeometry(ARM_W * 0.9, LOWER_ARM_LEN, ARM_W * 0.9), skinMat);
    lower.position.set(0, -LOWER_ARM_LEN * 0.5, 0);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(ARM_W * 1.05, ARM_W * 0.8, ARM_W * 1.05), teamMat);
    hand.position.set(0, -LOWER_ARM_LEN - ARM_W * 0.3, 0);
    elbow.add(lower, hand);
    pivot.add(upper, pad, elbow);
    pivot.traverse((o: any) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
    return pivot;
  };

  // place a straight arm so its hand lands on `hand` (view-model space), with the
  // shoulder offset back toward the body along `bodyDir` (hand -> shoulder).
  const DOWN = new THREE.Vector3(0, -1, 0);
  const aim = (pivot: THREE.Group, hand: THREE.Vector3, bodyDir: THREE.Vector3) => {
    const dir = bodyDir.clone().normalize();
    const shoulder = hand.clone().addScaledVector(dir, reach);
    pivot.position.copy(shoulder);
    const toHand = hand.clone().sub(shoulder).normalize(); // = -dir
    pivot.quaternion.setFromUnitVectors(DOWN, toHand);
  };

  const group = new THREE.Group();
  const right = buildArm();
  const left = buildArm();
  // trigger hand at the grip; support hand forward on the foregrip. bodyDir points
  // down-and-back (+Z toward the camera) so the upper arms trail off the lower edge.
  aim(right, new THREE.Vector3(0.02, -0.05, -0.02), new THREE.Vector3(0.35, -1.0, 1.05));
  aim(left, new THREE.Vector3(-0.04, -0.06, -0.27), new THREE.Vector3(-0.15, -1.0, 0.95));
  group.add(right, left);

  return {
    group,
    setTeamColor: (hex: number) => {
      teamMat.color.setHex(hex);
      teamMat.emissive.setHex(hex);
    },
    dispose: () => {
      group.traverse((o: any) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
      teamMat.dispose(); accentMat.dispose(); skinMat.dispose();
    },
  };
}
