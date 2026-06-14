// Floating dust/pollen motes — tiny additive points drifting slowly in a cube
// that wraps toroidally around the camera (same trick as the grass field), so
// the air always has gentle particles in it without any per-frame CPU work.

import * as THREE from "three";

const COUNT = 320;
const FIELD = 26; // metres; motes live in a FIELD³ cube around the camera

const VERT = /* glsl */ `
  attribute float aRand;
  uniform vec3 uCamPos;
  uniform float uTime;
  uniform float uField;
  varying float vA;

  void main() {
    vec3 base = position + uField * floor((uCamPos - position) / uField + 0.5);
    // slow 3D drift, unique per mote
    base += vec3(
      sin(uTime * 0.13 + aRand * 43.0) * 1.4,
      sin(uTime * 0.09 + aRand * 71.0) * 0.9,
      cos(uTime * 0.11 + aRand * 57.0) * 1.4
    );
    float d = distance(base, uCamPos);
    vA = (1.0 - smoothstep(uField * 0.28, uField * 0.48, d)) * (0.35 + 0.65 * fract(aRand * 7.3));
    vec4 mv = viewMatrix * vec4(base, 1.0);
    gl_PointSize = (1.5 + 2.0 * fract(aRand * 3.1)) * (30.0 / max(-mv.z, 1.0));
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  varying float vA;

  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.25, 1.0, d)) * vA * 0.38;
    gl_FragColor = vec4(vec3(1.0, 0.97, 0.86) * a, a);
  }
`;

export class Motes {
  readonly points: THREE.Points;
  private uTime = { value: 0 };
  private uCamPos = { value: new THREE.Vector3() };

  constructor() {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(COUNT * 3);
    const rand = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = Math.random() * FIELD;
      pos[i * 3 + 1] = Math.random() * FIELD;
      pos[i * 3 + 2] = Math.random() * FIELD;
      rand[i] = Math.random();
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aRand", new THREE.BufferAttribute(rand, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: this.uTime, uCamPos: this.uCamPos, uField: { value: FIELD } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  update(time: number, cam: THREE.Vector3) {
    this.uTime.value = time;
    this.uCamPos.value.copy(cam);
  }
}
