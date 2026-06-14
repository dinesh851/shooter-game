// Rain: line-segment streaks falling in a cube that wraps toroidally around
// the camera (same trick as the dust motes). Each drop is two vertices offset
// along the fall direction, so they render as true streaks.

import * as THREE from "three";

const COUNT = 700;
const FIELD = 26;
const FALL = 13; // m/s
const STREAK = 0.55; // metres of motion blur per drop

const VERT = /* glsl */ `
  attribute float aEnd; // 0 = head of the streak, 1 = tail
  attribute float aRand;
  uniform vec3 uCamPos;
  uniform float uTime;
  uniform float uField;
  varying float vA;

  void main() {
    vec3 base = position + uField * floor((uCamPos - position) / uField + 0.5);
    // continuous fall with slight sideways drift
    float fall = uTime * ${FALL.toFixed(1)} * (0.85 + 0.3 * fract(aRand * 7.3));
    base.y = uCamPos.y + mod(position.y - fall - uCamPos.y + uField * 0.5, uField) - uField * 0.5;
    base.x += sin(uTime * 0.8 + aRand * 20.0) * 0.4;
    base += vec3(0.18, -1.0, 0.1) * ${STREAK.toFixed(2)} * aEnd; // streak tail
    float d = distance(base, uCamPos);
    vA = (1.0 - smoothstep(uField * 0.25, uField * 0.5, d)) * (1.0 - aEnd * 0.8);
    gl_Position = projectionMatrix * viewMatrix * vec4(base, 1.0);
  }
`;

const FRAG = /* glsl */ `
  varying float vA;
  void main() {
    gl_FragColor = vec4(vec3(0.75, 0.82, 0.88), vA * 0.4);
  }
`;

export class RainFx {
  readonly lines: THREE.LineSegments;
  private uTime = { value: 0 };
  private uCamPos = { value: new THREE.Vector3() };

  constructor() {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(COUNT * 2 * 3);
    const end = new Float32Array(COUNT * 2);
    const rand = new Float32Array(COUNT * 2);
    for (let i = 0; i < COUNT; i++) {
      const x = Math.random() * FIELD;
      const y = Math.random() * FIELD;
      const z = Math.random() * FIELD;
      const r = Math.random();
      for (let e = 0; e < 2; e++) {
        const o = (i * 2 + e) * 3;
        pos[o] = x;
        pos[o + 1] = y;
        pos[o + 2] = z;
        end[i * 2 + e] = e;
        rand[i * 2 + e] = r;
      }
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aEnd", new THREE.BufferAttribute(end, 1));
    geo.setAttribute("aRand", new THREE.BufferAttribute(rand, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: this.uTime, uCamPos: this.uCamPos, uField: { value: FIELD } },
      transparent: true,
      depthWrite: false,
    });
    this.lines = new THREE.LineSegments(geo, mat);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
  }

  update(time: number, cam: THREE.Vector3) {
    this.uTime.value = time;
    this.uCamPos.value.copy(cam);
  }
}
