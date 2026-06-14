// Dev-only: stand a Soldier in an empty scene with a gun attached, camera on
// the +Z axis. Used by scripts/soldiershot.ts to verify facing + hand grip.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Soldier, preloadSoldier } from "./render/Soldier";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8898a8);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(3, 6, 5);
scene.add(sun);
scene.add(new THREE.GridHelper(10, 10));

// camera sits on +Z looking toward -Z: a model "facing +Z" looks AT the camera
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 50);
camera.position.set(2.4, 1.5, 2.4); // 3/4 view so the hold pose reads
camera.lookAt(0, 1.1, 0);

preloadSoldier();
const soldier = new Soldier(0x4ea1ff, 0xbfe6ff);
scene.add(soldier.root);

// attach a gun the same way Scene.attachRemoteGun does (holder +Z = muzzle)
new GLTFLoader().load("/models/guns/akm.glb", (g) => {
  const gun = g.scene;
  const box = new THREE.Box3().setFromObject(gun);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  gun.scale.setScalar(0.8 / maxDim);
  const box2 = new THREE.Box3().setFromObject(gun);
  const center = new THREE.Vector3();
  box2.getCenter(center);
  gun.position.sub(center);
  const holder = new THREE.Group();
  gun.rotation.set(0, 0 + Math.PI, 0); // AKM cfg: rotY 0, +PI to face +Z
  holder.add(gun);
  soldier.attachGun(holder);
});

// ?run=1 run cycle; ?pitch=0.6 aim up/down; ?crouch=1 crouch; ?dead=1 death
const params = new URLSearchParams(location.search);
const speed = params.has("run") ? 1.0 : 0.0;
soldier.setPitch(parseFloat(params.get("pitch") ?? "0"));
soldier.setCrouch(params.has("crouch"));
if (params.has("dead")) setTimeout(() => soldier.setDead(true), 1500);
const clock = new THREE.Clock();
function loop() {
  const dt = clock.getDelta();
  soldier.update(dt, speed, true);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();
