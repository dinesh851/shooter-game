// Volumetric-looking sun shafts: crossed additive "ray cards" aligned with the
// sun direction, scattered through the forest. Tree trunks in front occlude
// them (depth test), the fog fades them with distance, and the bloom pass
// makes them glow — the classic cheap god-ray that reads like the reference.

import * as THREE from "three";
import { terrainHeight } from "../../../shared/terrain";
import { SUN_DIR } from "./Shade";

const COUNT = 28;
const W = 14; // shaft width (m)
const H = 32; // shaft length along the sun axis (m)

const VERT = /* glsl */ `
  varying vec2 vUv;
  varying float vFogDepth;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uTex;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uFogDensity;
  varying vec2 vUv;
  varying float vFogDepth;
  void main() {
    float a = texture2D(uTex, vUv).r * uOpacity;
    // additive shafts must fade out with the fog, not blend toward grey
    a *= exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth * 0.7);
    gl_FragColor = vec4(uColor * a, a);
  }
`;

export class Sunrays {
  readonly group = new THREE.Group();
  private mats: { u: { value: number }; base: number; phase: number }[] = [];
  private uFogDensity: { value: number };

  constructor(fogDensity: number) {
    this.uFogDensity = { value: fogDensity };
    const tex = makeStreakTexture();

    // basis: quad "up" follows the sun axis, so the shafts slant like the light
    const up = SUN_DIR.clone();
    const side = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 1, 0)).normalize();
    const normal = new THREE.Vector3().crossVectors(side, up).normalize();
    const basis = new THREE.Matrix4().makeBasis(side, up, normal);
    const q = new THREE.Quaternion().setFromRotationMatrix(basis);
    const qCross = q
      .clone()
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));

    const geo = new THREE.PlaneGeometry(W, H);
    for (let i = 0; i < COUNT; i++) {
      // deterministic golden-angle scatter covering the whole playable area
      const r = 8 + (i / COUNT) * 86;
      const th = i * 2.39996;
      const x = Math.cos(th) * r;
      const z = Math.sin(th) * r;

      const base = 0.42 + 0.18 * ((i * 7) % 3) / 2;
      const uOpacity = { value: base };
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uTex: { value: tex },
          uColor: { value: new THREE.Color(0xfff3cd) },
          uOpacity,
          uFogDensity: this.uFogDensity,
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      this.mats.push({ u: uOpacity, base, phase: i * 1.7 });

      // shaft centre sits halfway up the ray so the card reaches from the
      // canopy down into the grass
      const cx = x + SUN_DIR.x * (H / 2 - 4);
      const cz = z + SUN_DIR.z * (H / 2 - 4);
      const cy = terrainHeight(x, z) + SUN_DIR.y * (H / 2) - 2;

      const a = new THREE.Mesh(geo, mat);
      a.quaternion.copy(q);
      a.position.set(cx, cy, cz);
      const b = new THREE.Mesh(geo, mat);
      b.quaternion.copy(qCross);
      b.position.set(cx, cy, cz);
      this.group.add(a, b);
    }
  }

  update(time: number) {
    // slow shimmering so the shafts feel alive
    for (const m of this.mats) {
      m.u.value = m.base * (0.75 + 0.25 * Math.sin(time * 0.35 + m.phase));
    }
  }

  setFogDensity(d: number) {
    this.uFogDensity.value = d;
  }
}

// vertical soft light streaks with feathered ends
function makeStreakTexture(): THREE.Texture {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, s, s);

  const bars: [number, number, number][] = [
    [38, 26, 0.9], [86, 14, 0.55], [122, 30, 1.0], [168, 12, 0.5], [205, 22, 0.8], [235, 10, 0.45],
  ];
  for (const [bx, bw, str] of bars) {
    const g = ctx.createLinearGradient(bx - bw, 0, bx + bw, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, `rgba(255,255,255,${str})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(bx - bw, 0, bw * 2, s);
  }
  // feather top and bottom so the shaft ends dissolve
  const v = ctx.createLinearGradient(0, 0, 0, s);
  v.addColorStop(0, "rgba(0,0,0,1)");
  v.addColorStop(0.18, "rgba(0,0,0,0)");
  v.addColorStop(0.72, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,1)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, s, s);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
