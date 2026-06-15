import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Soldier as Character, preloadSoldier } from "./Soldier";
import { MAP } from "../../../shared/mapdata";
import { terrainHeight, inWater, WATER_LEVEL } from "../../../shared/terrain";
import { grenadeStep, GrenadeBody } from "../../../shared/blockmap";
import { Water } from "./Water";
import { AirFx } from "./AirFx";
import { Landmarks } from "./Landmarks";
import { buildTerrain } from "./Terrain";
import { Forest } from "./Forest";
import { Grass } from "./Grass";
import { Motes } from "./Motes";
import { RainFx } from "./RainFx";
import { buildShadeTexture, SUN_DIR } from "./Shade";
import { Sunrays } from "./Sunrays";
import { TEAM_COLORS, MAX_SPEED } from "../../../shared/phys";
import { GrenadeThrowEv } from "../../../shared/protocol";

interface Remote {
  char: Character;
  team: number;
  name: string;
  tag?: THREE.Sprite; // floating name tag (teammates only)
  stride: number; // accumulated metres for footstep timing
  crouching: boolean;
  gun?: THREE.Object3D;
  weapon: string; // which weapon model the gun holder currently shows
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  lean: number;
  tx: number;
  ty: number;
  tz: number;
  tyaw: number;
  tpitch: number;
  tlean: number;
  px: number;
  py: number;
  pz: number;
}

// a bullet in flight: a short bright streak travelling at BULLET_SPEED
interface Bullet {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  remaining: number; // metres until the recorded end point
}

// a burst of impact debris particles (dirt, wood chips, sparks)
interface Burst {
  points: THREE.Points;
  vel: Float32Array;
  ttl: number;
  max: number;
  gravity: number;
  baseOpacity?: number;
}

const BULLET_SPEED = 340; // m/s, visual

const TEAM_ACCENTS = [0xbfe6ff, 0xffd2a8];

export class Scene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly baseFov = 84;
  private composer: EffectComposer;

  private remotes = new Map<string, Remote>();
  private bullets: Bullet[] = [];
  private bursts: Burst[] = [];
  private pendingImpacts: { x: number; y: number; z: number; delay: number }[] = [];
  private lastTracerDelay = 0; // travel time of the most recent tracer
  private bulletGeo!: THREE.CylinderGeometry;
  private bulletMat!: THREE.MeshBasicMaterial;
  private burstMats!: {
    dirt: THREE.PointsMaterial;
    wood: THREE.PointsMaterial;
    spark: THREE.PointsMaterial;
    blood: THREE.PointsMaterial;
  };
  private muzzleFlash!: THREE.Sprite;
  private casings: { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; ttl: number }[] = [];
  private casingPool: THREE.Mesh[] = [];
  private forest!: Forest;
  private grass!: Grass;
  private motes!: Motes;
  private sunrays!: Sunrays;
  private water!: Water;
  private airFx!: AirFx;
  private rain!: RainFx;
  private sunLight!: THREE.DirectionalLight;
  private hemiLight!: THREE.HemisphereLight;
  private sunGlow!: THREE.Sprite;
  private localCorpse?: Character;
  private worldTime = 0;
  private localTeam = 0;
  private crows: { sp: THREE.Sprite; vx: number; vy: number; vz: number; ttl: number }[] = [];
  private crowTex?: THREE.Texture;
  private lastCrowAt = 0;
  private pings: { sp: THREE.Sprite; ttl: number; baseY: number }[] = [];
  private pingTex?: THREE.Texture;
  private killBeams: { mesh: THREE.Mesh; ttl: number }[] = [];
  private arcDots?: THREE.InstancedMesh;
  // remote players walking through grass/water trigger positional footsteps
  onRemoteStep?: (x: number, z: number, crouch: boolean, water: boolean) => void;
  private fpsEl!: HTMLDivElement;
  private fpsFrames = 0;
  private fpsTime = 0;
  private cullTimer = 0;
  private netPingMs = -1;

  setNetPing(ms: number) {
    // smooth a little so the number doesn't flicker
    this.netPingMs = this.netPingMs < 0 ? ms : this.netPingMs * 0.6 + ms * 0.4;
  }
  // adaptive resolution: render scale drops on weak GPUs until FPS recovers
  private dynRes = 1.25;
  private adaptFrames = 0;
  private adaptTime = 0;
  private grenadeVis: { mesh: THREE.Object3D; body: GrenadeBody; ttl: number }[] = [];
  private grenadeTpl?: THREE.Group;
  private shakeAmt = 0;
  private explosions: { mesh: THREE.Mesh; light: THREE.PointLight; ttl: number; max: number }[] = [];
  // a small fixed pool of explosion lights, added to the scene ONCE. Reused by
  // index so the scene's light COUNT never changes — changing it forces Three.js
  // to recompile every material's shader, which churns memory and stutters.
  private explosionLights: THREE.PointLight[] = [];
  private exLightIdx = 0;
  private muzzle: THREE.PointLight;
  private viewModel: THREE.Group;
  private vmHip = new THREE.Vector3(0.2, -0.2, -0.5); // hip-fire rest pose
  private vmAds = new THREE.Vector3(0, -0.13, -0.45); // aim-down-sights pose
  private vmTarget = new THREE.Vector3(0.2, -0.2, -0.5);
  private recoilKick = 0;
  // viewmodel visibility has two independent owners (alive/dead and scoped); keep
  // them as separate flags so one doesn't clobber the other (a dead-then-unscoped
  // frame used to make the gun reappear over the death cam)
  private vmAlive = true;
  private vmScoped = false;
  private gunHolder = new THREE.Group(); // holds the current gun model inside viewModel
  private gunTemplates: Record<string, THREE.Object3D> = {};
  private currentWeapon = "rifle";

  constructor(container: HTMLElement) {
    // antialias off: we render through the EffectComposer, so canvas MSAA never
    // applies to the actual scene — it only costs memory/fill rate
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // the forest is static, so the shadow map is rendered during load and then
    // FROZEN — re-rendering 600+ trees into it every frame was a huge cost
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    // image-based lighting so PBR / metallic materials (the gun models) shade
    // correctly instead of looking flat/dark.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    // far plane tight to the fog: at density 0.028 nothing survives past ~150 m
    this.camera = new THREE.PerspectiveCamera(this.baseFov, window.innerWidth / window.innerHeight, 0.05, 220);
    this.camera.rotation.order = "YXZ";

    // misty forest: grey-green fog swallows the world edge, which is what
    // makes the bounded map read as endless woods (matches the reference)
    const fogColor = new THREE.Color(0xa9b4a4);
    // sky brighter than the fog: canopy gaps blow out white like the reference
    this.scene.background = new THREE.Color(0xdde3d4);
    this.scene.fog = new THREE.FogExp2(fogColor.getHex(), 0.028);

    this.buildLighting();
    this.buildMap();

    this.muzzle = new THREE.PointLight(0xffd27a, 0, 9, 2);
    this.camera.add(this.muzzle);

    // shared bullet/impact resources
    this.bulletGeo = new THREE.CylinderGeometry(0.035, 0.035, 2.4, 6, 1, true);
    this.bulletGeo.rotateX(Math.PI / 2); // length along -Z so lookAt() aims it
    this.bulletMat = new THREE.MeshBasicMaterial({
      // over-bright colour so the bloom pass makes the streak glow
      color: new THREE.Color(2.4, 2.0, 1.2),
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.burstMats = {
      dirt: new THREE.PointsMaterial({ color: 0x5a4226, size: 0.06, transparent: true, depthWrite: false }),
      wood: new THREE.PointsMaterial({ color: 0x6d4f2c, size: 0.05, transparent: true, depthWrite: false }),
      spark: new THREE.PointsMaterial({
        color: 0xffd27a,
        size: 0.045,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      blood: new THREE.PointsMaterial({ color: 0x9c1212, size: 0.06, transparent: true, depthWrite: false }),
    };

    // muzzle flash sprite riding just in front of the gun
    this.muzzleFlash = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeFlashTexture(),
        color: 0xffd9a0,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      })
    );
    this.muzzleFlash.position.set(0.14, -0.09, -0.78);
    this.muzzleFlash.scale.setScalar(0.22);
    this.camera.add(this.muzzleFlash);

    // brass casing pool (ejected on every shot, reused round-robin)
    const casingGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.05, 6);
    const casingMat = new THREE.MeshStandardMaterial({ color: 0xc9a24b, roughness: 0.35, metalness: 0.8 });
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(casingGeo, casingMat);
      m.visible = false;
      this.scene.add(m);
      this.casingPool.push(m);
    }
    // pre-create the explosion light pool (intensity 0 until an explosion uses it)
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffa848, 0, 20, 2);
      this.scene.add(l);
      this.explosionLights.push(l);
    }
    this.viewModel = this.buildViewModel();
    this.camera.add(this.viewModel);
    this.scene.add(this.camera);
    this.loadGuns();
    preloadSoldier(); // realistic remote-player model, loaded once

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(
      // half-resolution bloom: visually identical for a soft glow, half the blur cost
      new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.32, 0.6, 0.85)
    );

    // subtle film vignette over the canvas (cheap DOM overlay, no GPU cost)
    const vin = document.createElement("div");
    vin.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:5;" +
      "background:radial-gradient(ellipse at center, transparent 52%, rgba(8,12,8,0.42) 100%)";
    container.appendChild(vin);

    // live FPS counter (top-right)
    this.fpsEl = document.createElement("div");
    this.fpsEl.style.cssText =
      "position:fixed;top:8px;right:10px;z-index:30;pointer-events:none;" +
      "font:600 13px/1 monospace;color:var(--text-bright);text-shadow:0 1px 2px rgba(0,0,0,0.8)";
    this.fpsEl.textContent = "-- FPS";
    document.body.appendChild(this.fpsEl);

    window.addEventListener("resize", () => this.onResize());
    (window as any).__renderer = this.renderer; // dev: perf probes read renderer.info
    (window as any).__scene = this.scene; // dev: diagnostic scripts inspect the graph
    (window as any).__THREE = THREE; // dev: diagnostic scripts build Box3/Raycaster
    (window as any).__camera = this.camera; // dev: free-cam diagnostics (with __freezeCam)
  }

  private buildLighting() {
    // dim skylight + dark floor bounce: most of the mood lives in the CONTRAST
    // between sun pools and shade, so ambient stays low
    this.hemiLight = new THREE.HemisphereLight(0xaebdb0, 0x1a2415, 0.52);
    this.scene.add(this.hemiLight);
    // low warm sun raking through the trunks (the long-shadow look). Direction
    // shared with Shade.ts so the baked ground shade matches the real shadows.
    const key = new THREE.DirectionalLight(0xffe7bd, 3.4);
    key.position.copy(SUN_DIR).multiplyScalar(95);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const c = key.shadow.camera;
    c.left = -110;
    c.right = 110;
    c.top = 110;
    c.bottom = -110;
    c.near = 1;
    c.far = 260;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.05;
    this.scene.add(key);

    // sun glare: a big additive radial sprite far out along the sun direction.
    // Trunks occlude it (depthTest on), so it flares between the trees and the
    // bloom pass turns it into soft light shafts.
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeGlowTexture(),
        color: 0xffd890,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      })
    );
    glow.position.copy(SUN_DIR).multiplyScalar(240);
    glow.position.y = Math.min(glow.position.y, 80); // keep it low, between the trunks
    glow.scale.setScalar(260);
    this.scene.add(glow);
    this.sunLight = key;
    this.sunGlow = glow;
  }

  // ---- weather (host-controlled, replicated to everyone) -------------------
  setWeather(kind: string) {
    const presets: Record<string, { fog: number; density: number; bg: number; sun: number; hemi: number; rays: boolean; rain: boolean }> = {
      sunny: { fog: 0xc2cdb6, density: 0.015, bg: 0xe8ecd8, sun: 3.9, hemi: 0.68, rays: true, rain: false },
      mist: { fog: 0xa9b4a4, density: 0.028, bg: 0xdde3d4, sun: 3.4, hemi: 0.52, rays: true, rain: false },
      heavy: { fog: 0x93a094, density: 0.05, bg: 0xaab5a6, sun: 2.0, hemi: 0.42, rays: false, rain: false },
      rain: { fog: 0x8c979d, density: 0.042, bg: 0x9da8ad, sun: 1.5, hemi: 0.38, rays: false, rain: true },
    };
    const p = presets[kind] ?? presets.mist;
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.setHex(p.fog); // shared Color instance: water/grass pick it up too
    fog.density = p.density;
    (this.scene.background as THREE.Color).setHex(p.bg);
    this.sunLight.intensity = p.sun;
    this.hemiLight.intensity = p.hemi;
    this.sunrays.group.visible = p.rays;
    this.sunGlow.visible = p.rays;
    this.rain.lines.visible = p.rain;
    this.water.setFogDensity(p.density);
    this.sunrays.setFogDensity(p.density);
  }

  // ---- local death: corpse + viewmodel ---------------------------------------
  spawnLocalCorpse(x: number, y: number, z: number, yaw: number, team: number) {
    this.removeLocalCorpse();
    const c = new Character(TEAM_COLORS[team] ?? 0x999999, 0xffffff);
    c.root.position.set(x, y, z);
    c.root.rotation.y = yaw + Math.PI;
    c.setDead(true);
    this.scene.add(c.root);
    this.localCorpse = c;
  }

  removeLocalCorpse() {
    if (!this.localCorpse) return;
    this.scene.remove(this.localCorpse.root);
    this.localCorpse.dispose();
    this.localCorpse = undefined;
  }

  setViewmodelVisible(v: boolean) {
    this.vmAlive = v;
    this.applyViewmodelVisible();
  }

  private applyViewmodelVisible() {
    // shown only when alive AND not looking through a scope
    this.viewModel.visible = this.vmAlive && !this.vmScoped;
  }

  private buildMap() {
    // baked tree-shade map shared by ground + grass
    const sunVis = buildShadeTexture();

    // ground
    const terrain = buildTerrain(sunVis);
    this.scene.add(terrain.mesh);

    // forest (EZ-Tree instanced variants, placement shared with the server)
    this.forest = new Forest();
    this.scene.add(this.forest.group);

    // the reference's instanced grass-clump models + 3D flowers, placed where
    // the ground texture shows grass; lit by the sun with real shadows
    this.grass = new Grass();
    this.scene.add(this.grass.group);
    const fog = this.scene.fog as THREE.FogExp2;

    // drifting dust/pollen in the air
    this.motes = new Motes();
    this.scene.add(this.motes.points);

    // slanted god-ray cards through the canopy
    this.sunrays = new Sunrays(fog.density);
    this.scene.add(this.sunrays.group);

    // the river surface
    this.water = new Water(fog.color, fog.density);
    this.scene.add(this.water.mesh);

    // falling leaves, fireflies/butterflies, rolling mist patches
    this.airFx = new AirFx(makeGlowTexture());
    this.scene.add(this.airFx.group);

    // rain (hidden until the host dials it in)
    this.rain = new RainFx();
    this.scene.add(this.rain.lines);

    // landmark props (camp, ruin, logging site)
    this.scene.add(new Landmarks().group);

    // boulders: render the rock collision blocks as chunky deformed spheres
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x595b54, roughness: 1.0, flatShading: true });
    const logMat = new THREE.MeshStandardMaterial({ color: 0x4d3a25, roughness: 1.0, flatShading: true });
    for (const b of MAP.blocks) {
      if (b.prop === "rock") {
        const geo = new THREE.IcosahedronGeometry(0.5, 1);
        // displace by a hash of the vertex POSITION (not index): icosahedrons
        // are non-indexed, so coincident corners must move identically or the
        // surface tears open
        const p = geo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i);
          const y = p.getY(i);
          const z = p.getZ(i);
          const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + b.x) * 43758.5453;
          const k = 0.82 + (n - Math.floor(n)) * 0.34;
          p.setXYZ(i, x * k, y * k, z * k);
        }
        geo.computeVertexNormals();
        const rock = new THREE.Mesh(geo, rockMat);
        rock.scale.set(b.sx, b.sy * 1.15, b.sz);
        rock.position.set(b.x, b.y, b.z);
        rock.rotation.y = b.yaw ?? 0;
        rock.castShadow = true;
        rock.receiveShadow = true;
        this.scene.add(rock);
      } else if (b.prop === "log") {
        // fallen log lying along the box's long axis
        const alongX = b.sx > b.sz;
        const len = alongX ? b.sx : b.sz;
        const r = (alongX ? b.sz : b.sx) / 2;
        const geo = new THREE.CylinderGeometry(r * 1.05, r * 1.2, len, 9, 1);
        const log = new THREE.Mesh(geo, logMat);
        log.rotation.z = Math.PI / 2;
        if (!alongX) log.rotation.y = Math.PI / 2;
        log.position.set(b.x, b.y, b.z);
        log.castShadow = true;
        log.receiveShadow = true;
        this.scene.add(log);
      }
    }
  }

  private buildViewModel(): THREE.Group {
    const g = new THREE.Group();
    // procedural placeholder shown until the real gun model loads
    const mat = new THREE.MeshStandardMaterial({ color: 0x2b2f37, roughness: 0.5, metalness: 0.5, flatShading: true });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.17, 0.52), mat);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.55, 8), mat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -0.48);
    this.gunHolder.add(body, barrel);
    g.add(this.gunHolder);

    // No first-person arms/hands — the viewmodel is gun-only.

    g.position.set(0.2, -0.2, -0.5);
    return g;
  }

  // ---- gun models (Kenney CC0) -------------------------------------------
  private loadGuns() {
    const loader = new GLTFLoader();
    const prep = (s: THREE.Object3D) =>
      s.traverse((o: any) => {
        if (o.isMesh) {
          o.castShadow = false; // viewmodels never need shadows — they're expensive
          o.frustumCulled = false;
        }
      });

    // realistic single-gun models (compressed from the originals with
    // gltf-transform: 1k webp textures + simplified geometry, ~1-4 MB each)
    const load = (slot: string, url: string) =>
      loader.load(url, (g) => {
        prep(g.scene);
        this.gunTemplates[slot] = g.scene;
        if (this.currentWeapon === slot) this.refreshGunModel();
        // any remote still waiting for a gun model can mount one now
        this.remotes.forEach((rm) => {
          if (!rm.gun) this.attachRemoteGun(rm);
        });
      });
    load("pistol", "/models/guns/hk_socom.glb");
    load("rifle", "/models/guns/ar.glb");
    load("smg", "/models/guns/smg2.glb");
    load("sniper", "/models/guns/akm.glb");
  }

  private refreshGunModel() {
    const cfg = GUN_CONFIG[this.currentWeapon] ?? GUN_CONFIG.rifle;
    const tpl = this.gunTemplates[this.currentWeapon];
    if (!tpl) return; // keep placeholder until the GLB is ready
    while (this.gunHolder.children.length) this.gunHolder.remove(this.gunHolder.children[0]);
    const gun = tpl.clone(true);
    fitModel(gun, cfg.len); // scale longest dimension to cfg.len, recentre at origin
    gun.rotation.set(cfg.rotX ?? 0, cfg.rotY, cfg.rotZ ?? 0);
    this.gunHolder.add(gun);
  }

  private attachRemoteGun(r: Remote) {
    if (r.gun) return;
    const cfg = GUN_CONFIG[r.weapon] ?? GUN_CONFIG.rifle;
    const tpl = this.gunTemplates[r.weapon] ?? this.gunTemplates["rifle"];
    if (!tpl) return;
    const gun = tpl.clone(true);
    fitModel(gun, cfg.len * 1.3); // world-scale: a bit larger than the viewmodel
    // holder convention: +Z = muzzle direction; the soldier grips the holder
    // with its hand bone and aligns it to the character's facing
    const holder = new THREE.Group();
    gun.rotation.set(cfg.rotX ?? 0, cfg.rotY + Math.PI, cfg.rotZ ?? 0);
    holder.add(gun);
    r.char.attachGun(holder);
    r.gun = holder;
  }

  // ---- remote players (stylized Character) --------------------------------
  ensureRemote(
    id: string,
    team: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    lean = 0,
    pitch = 0,
    weapon = "rifle",
    crouch = false,
    name = ""
  ) {
    let r = this.remotes.get(id);
    // team switched in the lobby: rebuild the character with the new colours
    if (r && r.team !== team) {
      this.removeRemote(id);
      r = undefined;
    }
    if (!r) {
      const char = new Character(TEAM_COLORS[team] ?? 0x999999, TEAM_ACCENTS[team] ?? 0xffffff);
      char.root.position.set(x, y, z);
      this.scene.add(char.root);
      r = {
        char,
        team,
        name,
        stride: 0,
        crouching: crouch,
        weapon,
        x, y, z, yaw, lean, pitch,
        tx: x, ty: y, tz: z, tyaw: yaw, tpitch: pitch, tlean: lean,
        px: x, py: y, pz: z,
      };
      // floating name tag — only teammates can read it
      const tag = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: makeNameTexture(name, TEAM_COLORS[team] ?? 0xffffff), depthTest: false, transparent: true })
      );
      tag.position.y = 2.1;
      tag.scale.set(1.3, 0.33, 1);
      tag.visible = team === this.localTeam;
      char.root.add(tag);
      r.tag = tag;
      this.remotes.set(id, r);
      this.attachRemoteGun(r);
    } else {
      // weapon switch: swap the model held in the hand
      if (weapon !== r.weapon) {
        r.weapon = weapon;
        if (r.gun) {
          r.gun.parent?.remove(r.gun);
          r.gun = undefined;
        }
        this.attachRemoteGun(r);
      }
      // teleport (respawn): snap instead of gliding across the arena
      const far = (r.x - x) * (r.x - x) + (r.z - z) * (r.z - z) > 9 || Math.abs(r.y - y) > 3;
      if (far) {
        r.x = r.px = x;
        r.y = r.py = y;
        r.z = r.pz = z;
        r.char.root.position.set(x, y, z);
      }
    }
    r.tx = x;
    r.ty = y;
    r.tz = z;
    r.tyaw = yaw;
    r.tpitch = pitch;
    r.tlean = lean;
    r.crouching = crouch;
    r.char.setCrouch(crouch);
  }

  // the local player's team — controls which name tags are visible
  setLocalTeam(team: number) {
    if (team === this.localTeam) return;
    this.localTeam = team;
    this.remotes.forEach((r) => {
      if (r.tag) r.tag.visible = r.team === team;
    });
  }

  removeRemote(id: string) {
    const r = this.remotes.get(id);
    if (r) {
      // detach the gun first: it is a clone that SHARES geometry/material with the
      // gun template, so it must NOT be disposed here (would break every other gun).
      if (r.gun) {
        r.gun.parent?.remove(r.gun); // it lives inside a hand bone, not the root
        r.gun = undefined;
      }
      if (r.tag) {
        const tm = r.tag.material as THREE.SpriteMaterial;
        tm.map?.dispose();
        tm.dispose();
      }
      this.scene.remove(r.char.root);
      r.char.dispose(); // free this character's own geometry/materials (no VRAM leak)
      this.remotes.delete(id);
    }
  }

  setRemoteVisible(id: string, visible: boolean) {
    const r = this.remotes.get(id);
    if (!r) return;
    if (!visible) {
      // death: fall over and stay on the ground a moment before vanishing
      r.char.setDead(true);
      r.char.root.visible = r.char.deathTime < 2.2;
    } else {
      r.char.setDead(false);
      r.char.root.visible = true;
    }
  }

  private updateRemotes(dt: number) {
    const a = 1 - Math.pow(0.001, dt);
    this.remotes.forEach((r) => {
      r.x += (r.tx - r.x) * a;
      r.y += (r.ty - r.y) * a;
      r.z += (r.tz - r.z) * a;
      let dy = r.tyaw - r.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      r.yaw += dy * a;
      r.pitch += (r.tpitch - r.pitch) * a;
      r.lean += (r.tlean - r.lean) * a;

      const dtc = Math.max(dt, 1e-3);
      const hSpeed = Math.hypot(r.x - r.px, r.z - r.pz) / dtc;
      const vSpeed = Math.abs(r.y - r.py) / dtc;
      r.px = r.x;
      r.py = r.y;
      r.pz = r.z;

      // positional footsteps: a step every ~2.1 m of travel
      if (hSpeed > 1.2 && r.char.root.visible) {
        r.stride += hSpeed * dt;
        if (r.stride > 2.1) {
          r.stride = 0;
          const wading = inWater(r.x, r.z) && r.y < WATER_LEVEL + 0.3;
          this.onRemoteStep?.(r.x, r.z, r.crouching, wading);
          if (wading && Math.random() < 0.6) this.addSplash(r.x, WATER_LEVEL + 0.05, r.z);
        }
      }

      r.char.root.position.set(r.x, r.y, r.z);
      r.char.root.rotation.y = r.yaw + Math.PI; // model faces +Z; yaw=0 faces -Z
      r.char.setLean(r.lean); // peek bends the upper body at the hips
      r.char.setPitch(r.pitch); // look up/down bends the spine + tilts the gun
      r.char.update(dt, Math.min(1, hSpeed / MAX_SPEED), vSpeed < 1.5);
    });
  }

  // launch a travelling bullet streak from the muzzle to the recorded end point
  addTracer(ox: number, oy: number, oz: number, ex: number, ey: number, ez: number) {
    const start = new THREE.Vector3(ox, oy, oz);
    const end = new THREE.Vector3(ex, ey, ez);
    const dir = new THREE.Vector3().subVectors(end, start);
    const len = dir.length();
    this.lastTracerDelay = len / BULLET_SPEED;
    if (len < 2) return; // point-blank: no visible flight
    dir.normalize();
    const mesh = new THREE.Mesh(this.bulletGeo, this.bulletMat);
    mesh.position.copy(start);
    mesh.lookAt(end);
    this.scene.add(mesh);
    this.bullets.push({ mesh, pos: start, dir, remaining: len });
  }

  // impact debris, delayed to match the bullet's flight time and matched to the
  // surface: dirt puff on the ground, wood chips on trunks/logs, sparks on rock
  addImpact(x: number, y: number, z: number) {
    this.pendingImpacts.push({ x, y, z, delay: this.lastTracerDelay });
    this.lastTracerDelay = 0;
  }

  private spawnCrows(x: number, y: number, z: number) {
    if (!this.crowTex) this.crowTex = makeCrowTexture();
    for (let i = 0; i < 3; i++) {
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.crowTex, color: 0x14140f, transparent: true, depthWrite: false })
      );
      sp.position.set(x + (Math.random() - 0.5) * 2, y + Math.random() * 2, z + (Math.random() - 0.5) * 2);
      sp.scale.set(0.55, 0.3, 1);
      this.scene.add(sp);
      const a = Math.random() * Math.PI * 2;
      this.crows.push({
        sp,
        vx: Math.cos(a) * (3 + Math.random() * 2),
        vy: 2.5 + Math.random() * 1.5,
        vz: Math.sin(a) * (3 + Math.random() * 2),
        ttl: 2.5,
      });
    }
  }

  // water splash at the feet of someone wading
  addSplash(x: number, y: number, z: number) {
    this.water.addRipple(x, z, 0.45); // expanding ring on the surface
    const N = 8;
    const pos = new Float32Array(N * 3);
    const vel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      vel[i * 3] = (Math.random() - 0.5) * 1.6;
      vel[i * 3 + 1] = Math.random() * 1.8 + 0.4;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 1.6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xaeccd2, size: 0.05, transparent: true, depthWrite: false });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.bursts.push({ points, vel, ttl: 0.4, max: 0.4, gravity: 8 });
  }

  // teammate ping marker: floating diamond that bobs and fades
  addPing(x: number, y: number, z: number) {
    if (!this.pingTex) this.pingTex = makePingTexture();
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.pingTex, color: 0xffd34d, transparent: true, depthTest: false })
    );
    sp.position.set(x, y + 2.2, z);
    sp.scale.setScalar(0.9);
    this.scene.add(sp);
    this.pings.push({ sp, ttl: 5, baseY: y + 2.2 });
  }

  // killcam-lite: a bright red beam marking where the killer shot from
  addKillBeam(x: number, y: number, z: number) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 30, 8, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xff4040,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    mesh.position.set(x, y + 15, z);
    this.scene.add(mesh);
    this.killBeams.push({ mesh, ttl: 2.4 });
  }

  // grenade throw preview: dotted arc (positions from the shared grenadeStep)
  showGrenadeArc(points: { x: number; y: number; z: number }[] | null) {
    if (!this.arcDots) {
      this.arcDots = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.07, 6, 5),
        new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.85, depthWrite: false }),
        24
      );
      this.arcDots.frustumCulled = false;
      this.scene.add(this.arcDots);
    }
    if (!points || points.length === 0) {
      this.arcDots.count = 0;
      return;
    }
    const m = new THREE.Matrix4();
    const n = Math.min(points.length, 24);
    for (let i = 0; i < n; i++) {
      m.makeTranslation(points[i].x, points[i].y, points[i].z);
      this.arcDots.setMatrixAt(i, m);
    }
    this.arcDots.count = n;
    this.arcDots.instanceMatrix.needsUpdate = true;
  }

  // blood spray when a player is hit
  addBlood(x: number, y: number, z: number) {
    const N = 14;
    const pos = new Float32Array(N * 3);
    const vel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      vel[i * 3] = (Math.random() - 0.5) * 3.4;
      vel[i * 3 + 1] = Math.random() * 2.2 - 0.3;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 3.4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const points = new THREE.Points(geo, this.burstMats.blood.clone());
    this.scene.add(points);
    this.bursts.push({ points, vel, ttl: 0.55, max: 0.55, gravity: 12 });
  }

  private spawnImpactBurst(x: number, y: number, z: number) {
    let mat = this.burstMats.spark;
    let gravity = 4;
    if (Math.abs(y - terrainHeight(x, z)) < 0.35) {
      mat = this.burstMats.dirt;
      gravity = 9;
    } else {
      for (const b of MAP.blocks) {
        if (
          Math.abs(x - b.x) < b.sx / 2 + 0.5 &&
          Math.abs(z - b.z) < b.sz / 2 + 0.5 &&
          Math.abs(y - b.y) < b.sy / 2 + 0.5
        ) {
          if (b.prop === "tree" || b.prop === "log") {
            mat = this.burstMats.wood;
            gravity = 9;
            // shooting a tree can scare crows out of the canopy — free intel
            if (b.prop === "tree" && this.worldTime - this.lastCrowAt > 4 && Math.random() < 0.35) {
              this.lastCrowAt = this.worldTime;
              this.spawnCrows(b.x, terrainHeight(b.x, b.z) + 9, b.z);
            }
          }
          break;
        }
      }
    }

    const N = 10;
    const pos = new Float32Array(N * 3);
    const vel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      vel[i * 3] = (Math.random() - 0.5) * 3;
      vel[i * 3 + 1] = Math.random() * 2.6 + 0.6;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 3;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const points = new THREE.Points(geo, mat.clone()); // own material so fades don't couple
    this.scene.add(points);
    this.bursts.push({ points, vel, ttl: 0.5, max: 0.5, gravity });
  }

  // a proper frag grenade: olive capsule body + safety lever + filler cap
  private buildGrenadeTpl(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: 0x3c4a2e, roughness: 0.55, metalness: 0.35 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x8e9296, roughness: 0.4, metalness: 0.8 });
    const shell = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.05, 3, 10), body);
    g.add(shell);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.03, 8), steel);
    cap.position.y = 0.085;
    g.add(cap);
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.09, 0.025), steel);
    lever.position.set(0.045, 0.05, 0);
    lever.rotation.z = 0.35;
    g.add(lever);
    return g;
  }

  spawnGrenade(e: GrenadeThrowEv) {
    if (!this.grenadeTpl) this.grenadeTpl = this.buildGrenadeTpl();
    const mesh = this.grenadeTpl.clone();
    mesh.position.set(e.x, e.y, e.z);
    this.scene.add(mesh);
    this.grenadeVis.push({
      mesh,
      body: { x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz },
      ttl: e.fuseMs / 1000,
    });
  }

  addExplosion(x: number, y: number, z: number) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffce80, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(0.5);
    this.scene.add(mesh);
    // reuse a pooled light (round-robin) — never add/remove lights at runtime.
    const light = this.explosionLights[this.exLightIdx++ % this.explosionLights.length];
    light.position.set(x, y + 0.5, z);
    light.intensity = 30;
    this.explosions.push({ mesh, light, ttl: 0.45, max: 0.45 });

    // dirt thrown up by the blast + a slow rising smoke column
    this.spawnExplosionDebris(x, y, z);
    // camera shake scaled by proximity
    const dist = this.camera.position.distanceTo(new THREE.Vector3(x, y, z));
    this.shakeAmt = Math.max(this.shakeAmt, Math.max(0, 1 - dist / 22));
  }

  private spawnExplosionDebris(x: number, y: number, z: number) {
    // fast dirt clods
    const N = 16;
    const pos = new Float32Array(N * 3);
    const vel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = x;
      pos[i * 3 + 1] = y + 0.2;
      pos[i * 3 + 2] = z;
      vel[i * 3] = (Math.random() - 0.5) * 9;
      vel[i * 3 + 1] = Math.random() * 7 + 2;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 9;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const dirt = new THREE.Points(geo, this.burstMats.dirt.clone());
    (dirt.material as THREE.PointsMaterial).size = 0.12;
    this.scene.add(dirt);
    this.bursts.push({ points: dirt, vel, ttl: 0.9, max: 0.9, gravity: 11 });

    // smoke: big soft grey points drifting upward (negative gravity = buoyancy)
    const M = 10;
    const sp = new Float32Array(M * 3);
    const sv = new Float32Array(M * 3);
    for (let i = 0; i < M; i++) {
      sp[i * 3] = x + (Math.random() - 0.5) * 1.2;
      sp[i * 3 + 1] = y + 0.4 + Math.random() * 1.2;
      sp[i * 3 + 2] = z + (Math.random() - 0.5) * 1.2;
      sv[i * 3] = (Math.random() - 0.5) * 0.8;
      sv[i * 3 + 1] = 0.8 + Math.random() * 1.4;
      sv[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
    }
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
    const smokeMat = new THREE.PointsMaterial({
      color: 0x4c4a44,
      size: 1.5,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const smoke = new THREE.Points(sgeo, smokeMat);
    this.scene.add(smoke);
    this.bursts.push({ points: smoke, vel: sv, ttl: 2.2, max: 2.2, gravity: -0.5, baseOpacity: 0.55 });
  }

  flashMuzzle() {
    this.muzzle.intensity = 7;
    this.recoilKick = 0.06; // kick the gun toward the camera; update() settles it

    // bright star flash at the muzzle, random roll/size every shot
    const fm = this.muzzleFlash.material as THREE.SpriteMaterial;
    fm.opacity = 1;
    fm.rotation = Math.random() * Math.PI * 2;
    this.muzzleFlash.scale.setScalar(0.16 + Math.random() * 0.14);

    // eject a brass casing to the right of the gun
    const m = this.casingPool[this.casings.length % this.casingPool.length];
    m.visible = true;
    m.position.set(0.22, -0.12, -0.5);
    this.camera.localToWorld(m.position);
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.casings.push({
      mesh: m,
      vel: right.multiplyScalar(1.4 + Math.random()).add(new THREE.Vector3(0, 2.2 + Math.random(), 0)),
      spin: new THREE.Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12),
      ttl: 0.9,
    });
    if (this.casings.length > this.casingPool.length) this.casings.shift();
  }

  setFov(fov: number) {
    if (Math.abs(this.camera.fov - fov) < 0.01) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  setWeapon(id: string) {
    this.currentWeapon = id;
    const v = this.viewModel;
    v.scale.set(1, 1, 1); // the gun model is sized by fitModel(), not the group
    const cfg = GUN_CONFIG[id] ?? GUN_CONFIG.rifle;
    this.vmHip.fromArray(cfg.hip);
    this.vmAds.fromArray(cfg.ads); // centred so the sight line matches the crosshair
    this.vmTarget.copy(this.vmHip);
    v.position.copy(this.vmHip);
    this.refreshGunModel();
  }

  setAds(ads: boolean) {
    this.vmTarget.copy(ads ? this.vmAds : this.vmHip);
  }

  setScoped(scoped: boolean) {
    this.vmScoped = scoped; // looking through the scope -> hide the gun
    this.applyViewmodelVisible();
  }

  setCamera(x: number, yEye: number, z: number, yaw: number, pitch: number, roll = 0) {
    this.camera.position.set(x, yEye, z);
    this.camera.rotation.y = yaw;
    this.camera.rotation.x = pitch;
    this.camera.rotation.z = roll;
  }

  cameraForward(out: THREE.Vector3) {
    this.camera.getWorldDirection(out);
  }

  // world-space muzzle point (front-right-below the camera) for the local tracer
  muzzleWorld(out: THREE.Vector3) {
    out.set(0.14, -0.1, -0.7);
    this.camera.localToWorld(out);
  }

  update(dt: number) {
    this.updateRemotes(dt);

    // wind for leaves + grass; grass field follows the camera
    this.worldTime += dt;
    this.forest.update(this.worldTime);
    this.grass.update(this.worldTime);
    this.motes.update(this.worldTime, this.camera.position);
    this.sunrays.update(this.worldTime);
    this.water.update(this.worldTime, this.camera.position);
    this.airFx.update(this.worldTime, dt, this.camera.position);
    if (this.rain.lines.visible) this.rain.update(this.worldTime, this.camera.position);
    this.localCorpse?.update(dt, 0, true); // animate the fall, hold the pose

    // crows flying off
    for (let i = this.crows.length - 1; i >= 0; i--) {
      const c = this.crows[i];
      c.ttl -= dt;
      if (c.ttl <= 0) {
        this.scene.remove(c.sp);
        this.crows.splice(i, 1);
        continue;
      }
      c.sp.position.x += c.vx * dt;
      c.sp.position.y += c.vy * dt;
      c.sp.position.z += c.vz * dt;
      const flap = 0.5 + 0.5 * Math.abs(Math.sin(this.worldTime * 14 + i));
      c.sp.scale.set(0.55, 0.3 * flap + 0.08, 1);
    }

    // team pings (bob + fade)
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      p.ttl -= dt;
      if (p.ttl <= 0) {
        this.scene.remove(p.sp);
        this.pings.splice(i, 1);
        continue;
      }
      p.sp.position.y = p.baseY + Math.sin(this.worldTime * 3) * 0.2;
      (p.sp.material as THREE.SpriteMaterial).opacity = Math.min(1, p.ttl);
    }

    // killcam beams
    for (let i = this.killBeams.length - 1; i >= 0; i--) {
      const b = this.killBeams[i];
      b.ttl -= dt;
      if (b.ttl <= 0) {
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        (b.mesh.material as THREE.Material).dispose();
        this.killBeams.splice(i, 1);
        continue;
      }
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(0.85, b.ttl);
    }

    // shadow map: keep refreshing while assets stream in, then freeze it
    if (this.worldTime < 10) this.renderer.shadowMap.needsUpdate = true;

    // distance-cull forest/grass chunks a few times a second — past ~100 m the
    // fog has swallowed everything anyway, no need to draw it
    this.cullTimer -= dt;
    if (this.cullTimer <= 0) {
      this.cullTimer = 0.25;
      this.cullChunks(this.forest.group, 115);
      this.cullChunks(this.grass.group, 82);
    }

    // FPS + network latency readout, refreshed twice a second
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      const lat = this.netPingMs >= 0 ? ` · ${Math.round(this.netPingMs)} ms` : "";
      this.fpsEl.textContent = `${Math.round(this.fpsFrames / this.fpsTime)} FPS${lat}`;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    // adaptive render resolution: every 2 s nudge the scale down if the GPU is
    // drowning, back up if there's headroom. Waits out the loading phase
    // (shadow refreshes) so it doesn't punish a temporary dip.
    if (this.worldTime > 12) {
      this.adaptFrames++;
      this.adaptTime += dt;
      if (this.adaptTime >= 2) {
        const fps = this.adaptFrames / this.adaptTime;
        const old = this.dynRes;
        if (fps < 45) this.dynRes = Math.max(0.7, this.dynRes - 0.15);
        else if (fps > 70) this.dynRes = Math.min(1.25, this.dynRes + 0.1);
        if (this.dynRes !== old) {
          this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.dynRes));
          this.renderer.setSize(window.innerWidth, window.innerHeight);
          this.composer.setSize(window.innerWidth, window.innerHeight);
        }
        this.adaptFrames = 0;
        this.adaptTime = 0;
      }
    }

    if (this.muzzle.intensity > 0) this.muzzle.intensity = Math.max(0, this.muzzle.intensity - dt * 45);
    // ease the weapon toward its target pose (hip/ADS); recoil kicks Z, then settles
    const vk = Math.min(1, dt * 14);
    const vp = this.viewModel.position;
    vp.x += (this.vmTarget.x - vp.x) * vk;
    vp.y += (this.vmTarget.y - vp.y) * vk;
    vp.z += (this.vmTarget.z + this.recoilKick - vp.z) * vk;
    this.recoilKick = Math.max(0, this.recoilKick - dt * 0.5);

    // bullets in flight (geometry/material are shared — never disposed here)
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      const step = BULLET_SPEED * dt;
      b.remaining -= step;
      if (b.remaining <= 0) {
        this.scene.remove(b.mesh);
        this.bullets.splice(i, 1);
        continue;
      }
      b.pos.addScaledVector(b.dir, step);
      b.mesh.position.copy(b.pos);
    }

    // impact debris waiting for its bullet to arrive
    for (let i = this.pendingImpacts.length - 1; i >= 0; i--) {
      const p = this.pendingImpacts[i];
      p.delay -= dt;
      if (p.delay <= 0) {
        this.spawnImpactBurst(p.x, p.y, p.z);
        this.pendingImpacts.splice(i, 1);
      }
    }

    // debris particle bursts
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const bu = this.bursts[i];
      bu.ttl -= dt;
      if (bu.ttl <= 0) {
        this.scene.remove(bu.points);
        bu.points.geometry.dispose();
        (bu.points.material as THREE.Material).dispose();
        this.bursts.splice(i, 1);
        continue;
      }
      const pos = bu.points.geometry.attributes.position as THREE.BufferAttribute;
      for (let j = 0; j < pos.count; j++) {
        bu.vel[j * 3 + 1] -= bu.gravity * dt;
        pos.setXYZ(
          j,
          pos.getX(j) + bu.vel[j * 3] * dt,
          pos.getY(j) + bu.vel[j * 3 + 1] * dt,
          pos.getZ(j) + bu.vel[j * 3 + 2] * dt
        );
      }
      pos.needsUpdate = true;
      (bu.points.material as THREE.PointsMaterial).opacity = (bu.baseOpacity ?? 1) * (bu.ttl / bu.max);
    }

    // muzzle flash decay
    const fm = this.muzzleFlash.material as THREE.SpriteMaterial;
    if (fm.opacity > 0) fm.opacity = Math.max(0, fm.opacity - dt * 16);

    // ejected brass casings
    for (let i = this.casings.length - 1; i >= 0; i--) {
      const c = this.casings[i];
      c.ttl -= dt;
      if (c.ttl <= 0) {
        c.mesh.visible = false;
        this.casings.splice(i, 1);
        continue;
      }
      c.vel.y -= 9.8 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;
    }

    // flying grenades — the SAME physics step the server runs (terrain, bounds
    // and tree/rock bounces), so the grenade you watch is where it detonates
    for (let i = this.grenadeVis.length - 1; i >= 0; i--) {
      const g = this.grenadeVis[i];
      grenadeStep(g.body, dt);
      g.mesh.position.set(g.body.x, g.body.y, g.body.z);
      const tumbling = Math.hypot(g.body.vx, g.body.vz) > 1;
      if (tumbling) {
        g.mesh.rotation.x += dt * 7;
        g.mesh.rotation.z += dt * 5;
      }
      g.ttl -= dt;
      if (g.ttl <= 0) {
        this.scene.remove(g.mesh); // clone shares the template's geo/materials — no dispose
        this.grenadeVis.splice(i, 1);
      }
    }

    // camera shake from nearby explosions (decays fast)
    if (this.shakeAmt > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmt * 0.12;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmt * 0.1;
      this.camera.rotation.z += (Math.random() - 0.5) * this.shakeAmt * 0.03;
      this.shakeAmt *= Math.pow(0.001, dt); // ~gone in a second
    } else {
      this.shakeAmt = 0;
    }

    // explosion flashes
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const ex = this.explosions[i];
      ex.ttl -= dt;
      const k = Math.max(0, ex.ttl / ex.max);
      ex.mesh.scale.setScalar(0.5 + (1 - k) * 6);
      (ex.mesh.material as THREE.MeshBasicMaterial).opacity = k * 0.9;
      ex.light.intensity = 30 * k;
      if (ex.ttl <= 0) {
        this.scene.remove(ex.mesh);
        ex.light.intensity = 0; // pooled light stays in the scene; just switch it off
        ex.mesh.geometry.dispose();
        (ex.mesh.material as THREE.Material).dispose();
        this.explosions.splice(i, 1);
      }
    }

    this.composer.render();
  }

  private cullChunks(group: THREE.Group, cutoff: number) {
    const cp = this.camera.position;
    for (const child of group.children) {
      const m = child as THREE.InstancedMesh;
      const bs = m.boundingSphere;
      if (!bs) continue;
      m.visible = cp.distanceTo(bs.center) - bs.radius < cutoff;
    }
  }

  private onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }
}

// name tag: rounded dark pill with the player's name in their team colour
function makeNameTexture(name: string, color: number): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "rgba(8,12,10,0.62)";
  ctx.beginPath();
  ctx.roundRect(4, 8, 248, 48, 14);
  ctx.fill();
  ctx.font = "700 30px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#" + (color >>> 0).toString(16).padStart(6, "0");
  ctx.fillText((name || "Player").slice(0, 14), 128, 33);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// simple bird silhouette (two wing arcs)
function makeCrowTexture(): THREE.Texture {
  const s = 64;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d")!;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(4, 40);
  ctx.quadraticCurveTo(20, 18, 32, 34);
  ctx.quadraticCurveTo(44, 18, 60, 40);
  ctx.stroke();
  return new THREE.CanvasTexture(c);
}

// diamond ping marker
function makePingTexture(): THREE.Texture {
  const s = 96;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(s / 2, 6);
  ctx.lineTo(s - 10, s / 2);
  ctx.lineTo(s / 2, s - 6);
  ctx.lineTo(10, s / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  return new THREE.CanvasTexture(c);
}

// 4-spike star with a hot core — the muzzle flash sprite
function makeFlashTexture(): THREE.Texture {
  const s = 128;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,250,220,1)");
  g.addColorStop(0.3, "rgba(255,210,130,0.8)");
  g.addColorStop(1, "rgba(255,180,80,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = "rgba(255,235,180,0.9)";
  ctx.lineWidth = 5;
  for (const [dx, dy] of [[1, 0], [0, 1], [0.7, 0.7], [0.7, -0.7]]) {
    ctx.beginPath();
    ctx.moveTo(s / 2 - dx * s * 0.48, s / 2 - dy * s * 0.48);
    ctx.lineTo(s / 2 + dx * s * 0.48, s / 2 + dy * s * 0.48);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// soft radial gradient used by the sun-glare sprite
function makeGlowTexture(): THREE.Texture {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,244,214,1)");
  g.addColorStop(0.25, "rgba(255,238,196,0.55)");
  g.addColorStop(0.6, "rgba(255,236,190,0.16)");
  g.addColorStop(1, "rgba(255,236,190,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Scale an object so its longest dimension equals `targetLen`, then recentre it
// at the origin. Used to fit downloaded gun models to a consistent size.
function fitModel(obj: THREE.Object3D, targetLen: number): void {
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  obj.scale.setScalar(targetLen / maxDim);
  const box2 = new THREE.Box3().setFromObject(obj);
  const center = new THREE.Vector3();
  box2.getCenter(center);
  obj.position.sub(center);
}

// per-weapon view-model size, orientation and hold poses (hip + aim-down-sights)
interface GunCfg {
  len: number;
  rotX?: number;
  rotY: number;
  rotZ?: number;
  hip: [number, number, number];
  ads: [number, number, number];
}
const GUN_CONFIG: Record<string, GunCfg> = {
  // AR model's long axis = X. Pushed forward/down so the stock stays out of the camera.
  rifle: { len: 0.55, rotY: Math.PI / 2, hip: [0.24, -0.26, -0.68], ads: [0, -0.165, -0.6] },
  smg: { len: 0.45, rotY: -Math.PI / 2, hip: [0.23, -0.24, -0.58], ads: [0, -0.155, -0.5] }, // muzzle along -X natively
  sniper: { len: 0.66, rotY: 0, hip: [0.24, -0.26, -0.74], ads: [0, -0.165, -0.66] }, // AKM already points down -Z
  pistol: { len: 0.4, rotY: Math.PI / 2, hip: [0.2, -0.22, -0.46], ads: [0, -0.15, -0.4] }, // HK Mark 23, long axis = X
};

