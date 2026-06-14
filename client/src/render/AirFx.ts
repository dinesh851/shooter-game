// Ambient air effects: falling leaves under the canopy, fireflies/butterflies
// drifting near the ground, and big mist patches that roll through the forest.
// Leaves and fireflies wrap toroidally around the camera (same trick as the
// dust motes), so they're always around you for a fixed tiny cost.

import * as THREE from "three";
import { WORLD_HALF, terrainHeight } from "../../../shared/terrain";

const LEAF_COUNT = 220;
const LEAF_FIELD = 30;
const FLY_COUNT = 70;
const FLY_FIELD = 28;
const MIST_COUNT = 12;

const LEAF_VERT = /* glsl */ `
  attribute float aRand;
  uniform vec3 uCamPos;
  uniform float uTime;
  uniform float uField;
  varying float vA;
  varying float vRand;

  void main() {
    vec3 base = position + uField * floor((uCamPos - position) / uField + 0.5);
    // continuous fall: wrap vertically inside the field as time passes
    float fall = uTime * (0.35 + 0.25 * fract(aRand * 5.1));
    base.y = uCamPos.y + mod(position.y - fall - uCamPos.y + uField * 0.5, uField) - uField * 0.5;
    // sway side to side while falling
    base.x += sin(uTime * 0.9 + aRand * 40.0) * 0.6;
    base.z += cos(uTime * 0.7 + aRand * 31.0) * 0.6;
    float d = distance(base, uCamPos);
    vA = 1.0 - smoothstep(uField * 0.3, uField * 0.5, d);
    vRand = aRand;
    vec4 mv = viewMatrix * vec4(base, 1.0);
    gl_PointSize = (3.0 + 2.0 * fract(aRand * 7.7)) * (30.0 / max(-mv.z, 1.0));
    gl_Position = projectionMatrix * mv;
  }
`;

const LEAF_FRAG = /* glsl */ `
  varying float vA;
  varying float vRand;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    // spin the leaf silhouette by stretching one axis over time
    if (dot(d, d) > 0.22) discard;
    vec3 col = mix(vec3(0.32, 0.4, 0.13), vec3(0.45, 0.33, 0.12), fract(vRand * 3.3));
    gl_FragColor = vec4(col, vA * 0.9);
  }
`;

const FLY_VERT = /* glsl */ `
  attribute float aRand;
  uniform vec3 uCamPos;
  uniform float uTime;
  uniform float uField;
  varying float vA;
  varying float vRand;

  void main() {
    vec3 base = position + uField * floor((uCamPos - position) / uField + 0.5);
    // flutter: quick small loops near the ground
    base.x += sin(uTime * 1.8 + aRand * 50.0) * 0.9;
    base.y += sin(uTime * 2.6 + aRand * 80.0) * 0.45;
    base.z += cos(uTime * 2.1 + aRand * 60.0) * 0.9;
    float d = distance(base, uCamPos);
    float pulse = 0.55 + 0.45 * sin(uTime * 3.0 + aRand * 90.0);
    vA = (1.0 - smoothstep(uField * 0.28, uField * 0.5, d)) * pulse;
    vRand = aRand;
    vec4 mv = viewMatrix * vec4(base, 1.0);
    gl_PointSize = 2.5 * (30.0 / max(-mv.z, 1.0));
    gl_Position = projectionMatrix * mv;
  }
`;

const FLY_FRAG = /* glsl */ `
  varying float vA;
  varying float vRand;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.3, 1.0, d)) * vA;
    // fireflies glow green-yellow; a few read as white butterflies
    vec3 col = fract(vRand * 4.7) > 0.7 ? vec3(0.95, 0.95, 0.9) : vec3(0.75, 0.95, 0.35);
    gl_FragColor = vec4(col * a, a);
  }
`;

function wrapPoints(count: number, field: number, yMin: number, yMax: number) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const rand = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = Math.random() * field;
    pos[i * 3 + 1] = yMin + Math.random() * (yMax - yMin);
    pos[i * 3 + 2] = Math.random() * field;
    rand[i] = Math.random();
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aRand", new THREE.BufferAttribute(rand, 1));
  return geo;
}

export class AirFx {
  readonly group = new THREE.Group();
  private uTime = { value: 0 };
  private uCamPos = { value: new THREE.Vector3() };
  private mists: { sp: THREE.Sprite; vx: number; vz: number }[] = [];

  constructor(mistTexture: THREE.Texture) {
    const common = { uTime: this.uTime, uCamPos: this.uCamPos };

    const leaves = new THREE.Points(
      wrapPoints(LEAF_COUNT, LEAF_FIELD, 0, LEAF_FIELD),
      new THREE.ShaderMaterial({
        vertexShader: LEAF_VERT,
        fragmentShader: LEAF_FRAG,
        uniforms: { ...common, uField: { value: LEAF_FIELD } },
        transparent: true,
        depthWrite: false,
      })
    );
    leaves.frustumCulled = false;
    this.group.add(leaves);

    const flies = new THREE.Points(
      wrapPoints(FLY_COUNT, FLY_FIELD, 0, 3),
      new THREE.ShaderMaterial({
        vertexShader: FLY_VERT,
        fragmentShader: FLY_FRAG,
        uniforms: { ...common, uField: { value: FLY_FIELD } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    flies.frustumCulled = false;
    this.group.add(flies);

    // mist patches: big soft sprites slowly rolling across the map
    const mat = new THREE.SpriteMaterial({
      map: mistTexture,
      color: 0xc9d4c8,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    for (let i = 0; i < MIST_COUNT; i++) {
      const sp = new THREE.Sprite(mat);
      const x = (Math.random() - 0.5) * 2 * WORLD_HALF;
      const z = (Math.random() - 0.5) * 2 * WORLD_HALF;
      sp.position.set(x, terrainHeight(x, z) + 3, z);
      sp.scale.set(34 + Math.random() * 22, 10 + Math.random() * 6, 1);
      this.group.add(sp);
      this.mists.push({ sp, vx: 0.4 + Math.random() * 0.5, vz: (Math.random() - 0.5) * 0.4 });
    }
  }

  update(time: number, dt: number, cam: THREE.Vector3) {
    this.uTime.value = time;
    this.uCamPos.value.copy(cam);
    for (const m of this.mists) {
      const p = m.sp.position;
      p.x += m.vx * dt;
      p.z += m.vz * dt;
      if (p.x > WORLD_HALF + 30) {
        p.x = -WORLD_HALF - 20;
        p.z = (Math.random() - 0.5) * 2 * WORLD_HALF;
      }
      p.y = terrainHeight(p.x, p.z) + 3;
    }
  }
}
