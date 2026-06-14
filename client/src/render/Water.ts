// The river surface, v4 — built on three.js' open-source Reflector (MIT):
//  - TRUE planar reflections: trees, sky and sun mirror on the water and
//    wobble with the waves (the single biggest realism win)
//  - dual scrolling normal MAPS (the official three.js water textures),
//    advected downstream along the meander so the surface visibly flows
//  - fresnel blend between the reflection and the deep tint, sun glints,
//    bank foam, expanding wading ripple rings
//  - bank SKIRT (edges bend down into the ground) so there is never a gap
//    to see under the surface from the side
// The channel itself is carved into the heightfield (shared/terrain.ts).

import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { WATER_LEVEL, riverCenter } from "../../../shared/terrain";
import { TERRAIN_EXTENT } from "./Terrain";
import { SUN_DIR } from "./Shade";

const HALF_W = 8.0;
const SKIRT_W = 2.5;
const SKIRT_DROP = 1.25;
const MAX_RIPPLES = 10;

const VERT = /* glsl */ `
  attribute vec2 aTan;
  uniform mat4 uTexMatrix;
  varying vec4 vMirror;
  varying vec3 vWorld;
  varying vec2 vUv;
  varying vec2 vTan;
  varying float vFogDepth;

  void main() {
    vUv = uv;
    vTan = aTan;
    vMirror = uTexMatrix * vec4(position, 1.0);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 mv = viewMatrix * world;
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D tReflection;
  uniform sampler2D tNormal0;
  uniform sampler2D tNormal1;
  uniform float uTime;
  uniform vec3 uCam;
  uniform vec3 uSunDir;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform vec4 uRipples[${MAX_RIPPLES}];
  varying vec4 vMirror;
  varying vec3 vWorld;
  varying vec2 vUv;
  varying vec2 vTan;
  varying float vFogDepth;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash12(i), b = hash12(i + vec2(1, 0)), c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // ripple rings height (for normals + crests)
  float ringH(vec2 p) {
    float h = 0.0;
    for (int i = 0; i < ${MAX_RIPPLES}; i++) {
      vec4 rp = uRipples[i];
      float age = uTime - rp.z;
      if (rp.w > 0.0 && age > 0.0 && age < 2.2) {
        float r = distance(p, rp.xy);
        h += sin(r * 9.0 - age * 11.0) * exp(-r * 0.85) * exp(-age * 2.4) * rp.w;
      }
    }
    return h;
  }

  void main() {
    // dual normal maps scrolling downstream at different speeds/scales — this
    // is what makes the surface read as continuously FLOWING water
    vec2 flow = vTan * uTime;
    vec2 q0 = vWorld.xz * 0.140 - flow * 0.34;
    vec2 q1 = vWorld.xz * 0.310 - flow * 0.15 + vec2(0.37, 0.61);
    vec3 m0 = texture2D(tNormal0, q0).rgb * 2.0 - 1.0;
    vec3 m1 = texture2D(tNormal1, q1).rgb * 2.0 - 1.0;
    vec2 nm = m0.rg + m1.rg;

    // wading ripple rings perturb the normal too
    float e = 0.14;
    float r0 = ringH(vWorld.xz);
    nm.x += (r0 - ringH(vWorld.xz + vec2(e, 0.0))) / e * 0.6;
    nm.y += (r0 - ringH(vWorld.xz + vec2(0.0, e))) / e * 0.6;

    vec3 n = normalize(vec3(nm.x, 1.7, nm.y)); // choppy

    vec3 view = normalize(uCam - vWorld);
    float fresnel = pow(1.0 - max(dot(view, n), 0.0), 3.0);

    // REAL mirrored scene, distorted by the waves (tinted so it never washes
    // to pure white even when mirroring the bright fog sky)
    vec2 ruv = vMirror.xy / vMirror.w + n.xz * 0.13;
    vec3 refl = texture2D(tReflection, ruv).rgb * vec3(0.8, 0.9, 0.88);

    // depth tint: shallow green near banks, dark midstream
    float bank = smoothstep(0.45, 0.95, abs(vUv.y * 2.0 - 1.0));
    vec3 deep = mix(vec3(0.06, 0.14, 0.15), vec3(0.15, 0.28, 0.23), bank);

    vec3 col = mix(deep, refl, clamp(0.28 + fresnel * 0.5, 0.0, 1.0));

    // sun glints
    float spec = pow(max(dot(reflect(-uSunDir, n), view), 0.0), 150.0);
    col += vec3(1.0, 0.92, 0.7) * spec * 1.4;

    // foam: banks, ring crests, drifting streaks
    vec2 fq = vWorld.xz - vTan * uTime * 1.6;
    float foam = bank * smoothstep(0.34, 0.7, vnoise(fq * vec2(0.6, 1.5)));
    foam += clamp(r0 * 1.4, 0.0, 1.0) * 0.5;
    foam += 0.08 * smoothstep(0.74, 0.95, vnoise(fq * 1.2 + 31.0));
    col = mix(col, vec3(0.88, 0.92, 0.9), clamp(foam, 0.0, 1.0) * 0.8);

    float alpha = 0.92;
    float f = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
    col = mix(col, uFogColor, clamp(f, 0.0, 1.0));
    gl_FragColor = vec4(col, alpha);
  }
`;

export class Water {
  readonly mesh: THREE.Mesh;
  private uTime = { value: 0 };
  private uCam = { value: new THREE.Vector3() };
  private uFogDensity: { value: number };
  private ripples: THREE.Vector4[] = [];
  private rippleIdx = 0;

  constructor(fogColor: THREE.Color, fogDensity: number) {
    this.uFogDensity = { value: fogDensity };
    // Reflector requires geometry facing +Z locally; we build the ribbon in
    // local XY and rotate the mesh flat (local z becomes world height).
    // 4 verts per section: [down-skirt, edge, edge, down-skirt].
    const xs: number[] = [];
    for (let x = -TERRAIN_EXTENT; x <= TERRAIN_EXTENT; x += 3) xs.push(x);
    const cols = 4;
    const pos = new Float32Array(xs.length * cols * 3);
    const uv = new Float32Array(xs.length * cols * 2);
    const tan = new Float32Array(xs.length * cols * 2);
    xs.forEach((x, i) => {
      const zc = riverCenter(x);
      const dz = riverCenter(x + 0.5) - riverCenter(x - 0.5);
      const tl = Math.hypot(1, dz) || 1;
      const zs = [zc - HALF_W - SKIRT_W, zc - HALF_W, zc + HALF_W, zc + HALF_W + SKIRT_W];
      const drop = [SKIRT_DROP, 0, 0, SKIRT_DROP]; // outer edges plunge into the banks
      const vs = [0, 0, 1, 1];
      for (let c = 0; c < cols; c++) {
        const o = (i * cols + c) * 3;
        // local (lx, ly, lz) -> world (lx, lz, -ly) after rotation.x = -PI/2
        pos[o] = x;
        pos[o + 1] = -zs[c];
        pos[o + 2] = WATER_LEVEL - drop[c];
        uv.set([x / 14, vs[c]], (i * cols + c) * 2);
        tan.set([1 / tl, dz / tl], (i * cols + c) * 2);
      }
    });
    const idx: number[] = [];
    for (let i = 0; i < xs.length - 1; i++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = i * cols + c;
        const b = (i + 1) * cols + c;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setAttribute("aTan", new THREE.BufferAttribute(tan, 2));
    geo.setIndex(idx);

    for (let i = 0; i < MAX_RIPPLES; i++) this.ripples.push(new THREE.Vector4(0, 0, -10, 0));

    // the Reflector renders the mirrored scene each frame; we keep its
    // render-to-texture machinery but swap in our own shader
    const reflector = new Reflector(geo, { textureWidth: 512, textureHeight: 512, clipBias: 0.05, multisample: 0 });
    const stock = reflector.material as THREE.ShaderMaterial;
    const tReflection = stock.uniforms.tDiffuse.value as THREE.Texture;
    const texMatrix = stock.uniforms.textureMatrix.value as THREE.Matrix4;

    const loader = new THREE.TextureLoader();
    const norm = (url: string) => {
      const t = loader.load(url);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      return t;
    };

    reflector.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tReflection: { value: tReflection },
        uTexMatrix: { value: texMatrix }, // mutated in place by the Reflector
        tNormal0: { value: norm("/textures/waternormal1.jpg") },
        tNormal1: { value: norm("/textures/waternormal2.jpg") },
        uTime: this.uTime,
        uCam: this.uCam,
        uSunDir: { value: SUN_DIR.clone() },
        uFogColor: { value: fogColor },
        uFogDensity: this.uFogDensity,
        uRipples: { value: this.ripples },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    reflector.rotation.x = -Math.PI / 2; // lay the ribbon flat, normal up
    this.mesh = reflector;
  }

  // expanding ring where something disturbed the water
  addRipple(x: number, z: number, strength = 0.5) {
    const r = this.ripples[this.rippleIdx++ % MAX_RIPPLES];
    r.set(x, z, this.uTime.value, strength);
  }

  update(time: number, cam: THREE.Vector3) {
    this.uTime.value = time;
    this.uCam.value.copy(cam);
  }

  setFogDensity(d: number) {
    this.uFogDensity.value = d;
  }
}
