import * as THREE from "three";
import { Room } from "colyseus.js";
import { Scene } from "../render/Scene";
import { Input } from "../input/Input";
import { Hud } from "../ui/Hud";
import { Minimap } from "../ui/Minimap";
import { Audio } from "../audio/Audio";
import {
  Msg, Ev, ShootCmd, GrenadeCmd, SwitchCmd, TracerEv, HitEv, KillEv, GrenadeThrowEv, ExplosionEv, RocketEv, PingEv,
} from "../../../shared/protocol";
import { InputCmd, MoveState, eyeHeightFor, MAX_SPEED } from "../../../shared/phys";
import { step as arcadeStep } from "../../../shared/arcade";
import { grenadeStep, GrenadeBody, rayObstructionT } from "../../../shared/blockmap";
import { inWater, WATER_LEVEL, terrainHeight } from "../../../shared/terrain";
import { WEATHER_KINDS } from "../../../shared/protocol";
import { WEAPONS, WEAPON_LIST, WeaponId, DEFAULT_WEAPON } from "../../../shared/weapons";
import { Lobby } from "../ui/Lobby";
import * as C from "../../../shared/constants";

export class Game {
  private scene: Scene;
  private input: Input;
  private hud: Hud;
  private minimap: Minimap;
  private audio: Audio;
  private room: Room<any>;
  private meId: string;

  // local prediction
  private pred: MoveState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: true, crouch: false };
  private pending: InputCmd[] = [];
  private seq = 0;
  private lastAck = -1;

  // weapons / combat
  private weapon: WeaponId = DEFAULT_WEAPON;
  private localAmmo = WEAPONS[DEFAULT_WEAPON].magazine;
  private reloadUntil = 0; // perf time when reload completes (0 = not reloading)
  private recoilPitch = 0;
  private recoilYaw = 0;
  private wasFiring = false;
  private firedEmpty = false;
  private lastShotAt = 0;
  private wasG = false;
  private lastGrenade = 0;
  private gHoldStart = 0; // perf time when G went down (0 = not cooking)
  private fov: number;
  private wasAlive = true;
  private lobby: Lobby;
  private lobbyRefresh = 0;
  private lastPhase = "";
  private lastWeather = "";
  private wasV = false;
  private tpv = true; // third-person view (default); toggle with T
  private wasViewToggle = false;
  private bodySpeed = 0; // smoothed locomotion speed for the local body animation
  // death cam + death screen
  private deathAt = 0;
  private deathPos = { x: 0, y: 0, z: 0 };
  private killerName = "";
  private deathEl?: HTMLDivElement;
  private strideAcc = 0;
  private prevX = 0;
  private prevZ = 0;

  private lastTime = 0;
  private scoreboardOpen = false;
  private leanAmt = 0; // smoothed peek (-1 left .. +1 right)
  private leanX = 0;
  private leanZ = 0;
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();
  private up = new THREE.Vector3();
  private muzzle = new THREE.Vector3();

  constructor(room: Room<any>, sessionId: string) {
    this.room = room;
    this.meId = sessionId;
    (window as any).__room = room; // dev: diagnostics read phase / authoritative pos
    this.scene = new Scene(document.getElementById("app")!);
    this.input = new Input(this.scene.renderer.domElement);
    this.hud = new Hud();
    this.minimap = new Minimap();
    this.audio = new Audio();
    this.audio.resume();
    this.fov = this.scene.baseFov;
    this.hud.show();
    this.scene.setWeapon(this.weapon);
    this.scene.setThirdPerson(this.tpv); // default to third-person
    this.input.lock();

    // lobby overlay (team select / ready / host start) + end-of-round scoreboard
    this.lobby = new Lobby();
    (window as any).__lobby = this.lobby; // dev: inspect/preview overlays
    this.lobby.onSelectTeam = (team) => this.room.send(Msg.SelectTeam, { team });
    this.lobby.onReady = (ready) => this.room.send(Msg.Ready, { ready });
    this.lobby.onStart = () => this.room.send(Msg.Start);
    this.lobby.onAddBot = () => this.room.send(Msg.AddBot);
    this.lobby.onWeather = (w) => this.room.send(Msg.Weather, { w });
    this.lobby.onSetName = (name) => this.room.send(Msg.SetName, { name });
    this.lobby.onClaimAdmin = (password) => this.room.send(Msg.Admin, { password });
    this.lobby.onEndMatch = () => this.room.send(Msg.EndMatch);
    // server replies to an admin claim with { ok }
    this.room.onMessage(Msg.Admin, (e: { ok: boolean }) => {
      if (!e.ok) this.lobby.adminDenied();
    });

    // positional footsteps from other players
    this.scene.onRemoteStep = (x, z, crouch, water) => {
      const d = Math.hypot(x - this.pred.x, z - this.pred.z);
      const gain = Math.max(0, 1 - d / 32) * (crouch ? 0.15 : 0.5) * (water ? 1.4 : 1);
      this.audio.footstep(gain * 0.5, water);
    };

    this.bindState();
    this.bindEvents();

    this.lastTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  private bindState() {
    const players = this.room.state.players;
    players.onAdd((p: any, id: string) => {
      if (id === this.meId) {
        this.pred = { x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, onGround: p.onGround, crouch: p.crouch };
        this.input.yaw = p.yaw;
      }
    });
    players.onRemove((_p: any, id: string) => this.scene.removeRemote(id));
  }

  private bindEvents() {
    this.room.onMessage(Ev.Tracer, (e: TracerEv) => {
      if (e.shooter === this.meId) {
        // start the local player's tracer at the gun muzzle so it visibly streaks.
        // in third-person the camera is behind the body, so originate at the
        // player's aim point (eye + a little forward) instead of the camera.
        if (this.tpv) {
          this.scene.cameraForward(this.fwd);
          const eye = eyeHeightFor(this.pred.crouch);
          this.muzzle.set(this.pred.x + this.leanX, this.pred.y + eye - 0.15, this.pred.z + this.leanZ);
          this.muzzle.addScaledVector(this.fwd, 0.6);
        } else {
          this.scene.muzzleWorld(this.muzzle);
        }
        this.scene.addTracer(this.muzzle.x, this.muzzle.y, this.muzzle.z, e.ex, e.ey, e.ez);
      } else {
        this.scene.addTracer(e.ox, e.oy, e.oz, e.ex, e.ey, e.ez);
      }
      this.scene.addImpact(e.ex, e.ey, e.ez);
    });
    this.room.onMessage(Ev.Hit, (e: HitEv) => {
      this.scene.addBlood(e.x, e.y, e.z); // blood spray at the wound
      if (e.shooter === this.meId) {
        this.hud.hitmarker();
        this.audio.hit();
      }
      if (e.victim === this.meId) this.hud.damageFlash();
    });
    // latency probe: server echoes our timestamp; RTT shows next to FPS
    this.room.onMessage(Msg.Lat, (e: { t: number }) => this.scene.setNetPing(performance.now() - e.t));
    setInterval(() => this.room.send(Msg.Lat, { t: performance.now() }), 2000);

    this.room.onMessage(Ev.Ping, (e: PingEv) => {
      this.scene.addPing(e.x, e.y, e.z);
      this.minimap.addPing(e.x, e.z);
      this.audio.ping();
    });
    this.room.onMessage(Ev.Kill, (e: KillEv) => {
      // your kill: confirm it with a red kill marker + sound
      if (e.killer === this.meId && e.victim !== this.meId) {
        this.hud.killmarker();
        this.audio.hit();
      }
      // killcam-lite: mark where your killer shot from for a couple of seconds
      if (e.victim === this.meId) {
        this.killerName = e.killerName;
        const k = this.room.state.players.get(e.killer);
        if (k) {
          this.scene.addKillBeam(k.x, k.y, k.z);
          this.minimap.addPing(k.x, k.z);
        }
      }
      const players = this.room.state.players;
      const kt = players.get(e.killer)?.team ?? 0;
      const vt = players.get(e.victim)?.team ?? 1;
      this.hud.killfeed(e.killerName, e.victimName, kt, vt, e.head);
    });
    this.room.onMessage(Ev.GrenadeThrow, (e: GrenadeThrowEv) => this.scene.spawnGrenade(e));
    this.room.onMessage(Ev.Rocket, (e: RocketEv) => this.scene.spawnRocket(e));
    this.room.onMessage(Ev.Explosion, (e: ExplosionEv) => {
      this.scene.addExplosion(e.x, e.y, e.z);
      this.audio.boom();
      const me = this.room.state.players.get(this.meId);
      if (me) {
        const d = Math.hypot(me.x - e.x, me.y - e.y, me.z - e.z);
        if (d < C.GRENADE.radius) this.hud.damageFlash();
      }
    });
  }

  private loop = () => {
    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.1) dt = 0.1;

    const me = this.room.state.players.get(this.meId);
    const w = WEAPONS[this.weapon];

    // recoil recovers toward zero
    const recover = Math.exp(-dt * 7);
    this.recoilPitch *= recover;
    this.recoilYaw *= recover;

    // effective look = mouse + recoil
    const limit = Math.PI / 2 - 0.01;
    const effYaw = this.input.yaw + this.recoilYaw;
    const effPitch = Math.max(-limit, Math.min(limit, this.input.pitch + this.recoilPitch));

    // respawn / death bookkeeping
    if (me && me.alive && !this.wasAlive) this.onRespawn();
    if (me && !me.alive && this.wasAlive) this.onDeath(now, me);
    if (me) this.wasAlive = me.alive;

    // warmup freezes everyone at spawn (a "get ready" countdown); don't predict or
    // send movement, just mirror the server so control resumes seamlessly at live.
    const frozen = this.room.state.phase === "warmup";
    if (me && me.alive && !frozen) {
      this.predictAndSend(dt * 1000, effYaw, effPitch);
    } else if (me) {
      // dead or warmup-frozen: mirror the FULL authoritative state (incl. velocity/
      // onGround/crouch) so prediction restarts cleanly instead of carrying stale
      // velocity (which caused a rubber-band on every respawn / round start).
      this.pred = { x: me.x, y: me.y, z: me.z, vx: me.vx, vy: me.vy, vz: me.vz, onGround: me.onGround, crouch: me.crouch };
      this.pending.length = 0;
      this.lastAck = me.lastSeq;
    }

    // ADS field-of-view zoom; sniper gets a real scope overlay
    const ads = this.input.ads && !!me && me.alive;
    const scoped = ads && this.weapon === "sniper";
    const targetFov = ads ? w.adsFov : this.scene.baseFov;
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 12);
    this.scene.setFov(this.fov);
    this.scene.setAds(ads);
    this.scene.setScoped(scoped); // hide the gun view-model while looking through the scope
    this.hud.setScope(scoped);
    this.hud.setReddot(ads && !scoped); // red-dot reticle for non-sniper ADS
    this.hud.setAds(ads && !scoped);

    // peek/lean: shift the eye + shot origin sideways and roll the view, while the
    // collision body stays put — so you can peek around cover (Q/E).
    const leanTarget = me && me.alive ? this.input.leanDir() : 0;
    this.leanAmt += (leanTarget - this.leanAmt) * Math.min(1, dt * 12);
    const LEAN = 1.1; // how far the eye/shot shifts sideways when peeking
    this.leanX = Math.cos(effYaw) * this.leanAmt * LEAN;
    this.leanZ = -Math.sin(effYaw) * this.leanAmt * LEAN;

    // view toggle: T flips between third- and first-person
    const tNow = this.input.isDown("KeyT");
    if (tNow && !this.wasViewToggle) {
      this.tpv = !this.tpv;
      this.scene.setThirdPerson(this.tpv);
    }
    this.wasViewToggle = tNow;

    // camera: death cam orbits the body; otherwise first- or third-person from
    // prediction. dev: __freezeCam lets a diagnostic script position the camera.
    if ((window as any).__freezeCam) {
      // leave the camera where the diagnostic put it
    } else if (me && !me.alive && this.deathAt) {
      this.updateDeathCam(now);
    } else {
      const eye = eyeHeightFor(this.pred.crouch);
      const cx = this.pred.x + this.leanX;
      const cy = this.pred.y + eye;
      const cz = this.pred.z + this.leanZ;
      const roll = -this.leanAmt * 0.16; // gentle head tilt; 0.4 rad rolled the whole view
      if (this.tpv && me && me.alive) {
        this.scene.setCameraThirdPerson(cx, cy, cz, effYaw, effPitch, roll);
      } else {
        // first-person: nudge the eye forward a touch so less torso shows when
        // looking down, and keep it at STANDING height even while crouched so the
        // view doesn't sink into the (hunched) body and fill the screen.
        const fo = 0.12;
        const fpCy = this.pred.y + eyeHeightFor(false);
        this.scene.setCamera(cx - Math.sin(effYaw) * fo, fpCy, cz - Math.cos(effYaw) * fo, effYaw, effPitch, roll);
      }
    }

    // drive the local player's own body so it's visible in third-person
    if (me && me.alive) {
      // smooth the predicted speed: the raw per-frame value is jittery (prediction
      // corrections), which made the idle/walk/run blend flicker and the legs
      // stutter. Remotes interpolate, so they were already smooth.
      const rawSpeed = Math.min(1, Math.hypot(this.pred.vx, this.pred.vz) / MAX_SPEED);
      this.bodySpeed += (rawSpeed - this.bodySpeed) * Math.min(1, dt * 10);
      this.scene.updateLocalBody(
        dt, me.team, this.weapon,
        this.pred.x, this.pred.y, this.pred.z,
        effYaw, effPitch, this.leanAmt, this.pred.crouch,
        this.bodySpeed, this.pred.onGround
      );
    }

    if (me && me.alive) this.handleWeapons(now, ads);

    // middle-click ping: mark whatever you're aiming at for your team
    if (this.input.consumePing() && me && me.alive) {
      this.scene.cameraForward(this.fwd);
      const o = { x: this.pred.x + this.leanX, y: this.pred.y + eyeHeightFor(this.pred.crouch), z: this.pred.z + this.leanZ };
      const t = Math.min(rayObstructionT(o, this.fwd, 70), 70);
      this.room.send(Msg.Ping, { x: o.x + this.fwd.x * t, y: o.y + this.fwd.y * t, z: o.z + this.fwd.z * t });
    }

    // local footsteps (your own boots)
    if (me && me.alive && this.pred.onGround) {
      const moved = Math.hypot(this.pred.x - this.prevX, this.pred.z - this.prevZ);
      this.strideAcc += moved;
      const strideLen = this.pred.crouch ? 2.6 : 2.1;
      if (this.strideAcc > strideLen && moved > 0.01) {
        this.strideAcc = 0;
        const wading = inWater(this.pred.x, this.pred.z) && this.pred.y < WATER_LEVEL + 0.3;
        this.audio.footstep(this.pred.crouch ? 0.05 : 0.16, wading);
        if (wading) this.scene.addSplash(this.pred.x, WATER_LEVEL + 0.05, this.pred.z);
      }
    }
    this.prevX = this.pred.x;
    this.prevZ = this.pred.z;

    this.updateRemotes();
    this.updateHud(me, w);

    this.scene.update(dt);
    this.hud.update(dt);
    requestAnimationFrame(this.loop);
  };

  private onRespawn() {
    this.localAmmo = WEAPONS[this.weapon].magazine;
    this.reloadUntil = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    // clear the death experience
    this.deathAt = 0;
    this.killerName = "";
    this.scene.removeLocalCorpse();
    this.scene.setViewmodelVisible(true);
    if (this.deathEl) this.deathEl.style.display = "none";
  }

  private predictAndSend(dtMs: number, effYaw: number, effPitch: number) {
    const me = this.room.state.players.get(this.meId);
    if (me && me.lastSeq !== this.lastAck) {
      this.lastAck = me.lastSeq;
      this.pred = { x: me.x, y: me.y, z: me.z, vx: me.vx, vy: me.vy, vz: me.vz, onGround: me.onGround, crouch: me.crouch };
      this.pending = this.pending.filter((c) => c.seq > me.lastSeq);
      for (const c of this.pending) arcadeStep(this.pred, c);
    }

    const cmd = this.input.command(++this.seq, dtMs);
    cmd.yaw = effYaw; // send the recoil-adjusted aim so server + view agree
    cmd.pitch = effPitch;
    cmd.lean = this.leanAmt; // replicate the peek so other players see the body lean
    arcadeStep(this.pred, cmd);
    this.pending.push(cmd);
    if (this.pending.length > 200) this.pending.shift();
    this.room.send(Msg.Input, cmd);
  }

  private handleWeapons(now: number, ads: boolean) {
    const w = WEAPONS[this.weapon];

    // grenade: HOLD G to cook + preview the arc, release to throw
    const wantG = this.input.isDown("KeyG");
    const eye = eyeHeightFor(this.pred.crouch);
    if (wantG && !this.wasG && now - this.lastGrenade > C.GRENADE.cooldownMs) {
      this.gHoldStart = now; // start cooking
      this.audio.click();
    }
    if (this.gHoldStart) {
      const heldMs = now - this.gHoldStart;
      this.scene.cameraForward(this.fwd);
      const ox = this.pred.x + this.leanX;
      const oy = this.pred.y + eye;
      const oz = this.pred.z + this.leanZ;
      if (!wantG || heldMs >= C.GRENADE.fuseMs - 280) {
        // released (or cooked to the limit): throw
        this.gHoldStart = 0;
        this.lastGrenade = now;
        this.scene.showGrenadeArc(null);
        const cmd: GrenadeCmd = {
          ox, oy, oz,
          dx: this.fwd.x,
          dy: this.fwd.y + 0.15,
          dz: this.fwd.z,
          clientTime: now,
          heldMs,
        };
        this.room.send(Msg.Grenade, cmd);
      } else {
        // preview: run the SAME physics the server will, collect dotted arc
        const dl = Math.hypot(this.fwd.x, this.fwd.y + 0.15, this.fwd.z) || 1;
        const body: GrenadeBody = {
          x: ox, y: oy, z: oz,
          vx: (this.fwd.x / dl) * C.GRENADE.throwSpeed,
          vy: ((this.fwd.y + 0.15) / dl) * C.GRENADE.throwSpeed + C.GRENADE.up,
          vz: (this.fwd.z / dl) * C.GRENADE.throwSpeed,
        };
        const pts: { x: number; y: number; z: number }[] = [];
        const steps = Math.floor((C.GRENADE.fuseMs - heldMs) / 50);
        for (let i = 0; i < Math.min(steps, 72); i++) {
          grenadeStep(body, 0.05);
          if (i % 3 === 0) pts.push({ x: body.x, y: body.y, z: body.z });
        }
        this.scene.showGrenadeArc(pts);
      }
    }
    this.wasG = wantG;

    // weapon switching (1..4)
    for (const def of WEAPON_LIST) {
      if (this.input.isDown(`Digit${def.slot}`) && def.id !== this.weapon) {
        this.switchWeapon(def.id);
        break;
      }
    }

    // manual reload
    if (this.input.isDown("KeyR")) this.startReload(now);

    // finish reload
    if (this.reloadUntil && now >= this.reloadUntil) {
      this.localAmmo = w.magazine;
      this.reloadUntil = 0;
    }

    // firing
    const wantFire = this.input.firing;
    const trigger = w.automatic ? wantFire : wantFire && !this.wasFiring;
    if (!wantFire) this.firedEmpty = false;
    this.wasFiring = wantFire;

    if (trigger && !this.reloadUntil && now - this.lastShotAt >= w.fireIntervalMs) {
      if (this.localAmmo > 0) this.fire(now, ads);
      else if (!this.firedEmpty) {
        this.audio.empty();
        this.firedEmpty = true;
        this.startReload(now);
      }
    }
  }

  // ---- death experience -----------------------------------------------------

  private onDeath(now: number, me: any) {
    this.deathAt = now;
    this.deathPos = { x: this.pred.x, y: this.pred.y, z: this.pred.z };
    // your body drops where you stood; the death cam orbits it
    this.scene.spawnLocalCorpse(this.pred.x, this.pred.y, this.pred.z, this.input.yaw, me.team);
    this.scene.setViewmodelVisible(false);
    this.scene.setLocalBodyVisible(false); // hide the live body; the corpse takes over
    this.scene.showGrenadeArc(null);
    this.gHoldStart = 0;
  }

  private updateDeathCam(now: number) {
    const t = (now - this.deathAt) / 1000;
    // slow orbit, pulling up and back from the body
    const ang = this.input.yaw + Math.PI + t * 0.35;
    const r = 3.2 + Math.min(1.6, t * 0.8);
    const cx = this.deathPos.x + Math.sin(ang) * r;
    const cz = this.deathPos.z + Math.cos(ang) * r;
    let cy = this.deathPos.y + 2.2 + Math.min(1.2, t * 0.6);
    cy = Math.max(cy, terrainHeight(cx, cz) + 0.5); // never sink into a hill
    const dx = this.deathPos.x - cx;
    const dy = this.deathPos.y + 0.4 - cy;
    const dz = this.deathPos.z - cz;
    this.scene.setCamera(cx, cy, cz, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)), 0);

    // death screen: unmistakable + respawn countdown
    if (!this.deathEl) {
      this.deathEl = document.createElement("div");
      this.deathEl.style.cssText =
        "position:fixed;inset:0;z-index:25;pointer-events:none;display:none;" +
        "background:radial-gradient(ellipse at center, rgba(80,0,0,0.18) 40%, rgba(60,0,0,0.6) 100%);" +
        "font-family:var(--ui-font);text-align:center";
      this.deathEl.innerHTML =
        `<div style="margin-top:30vh">` +
        `<div id="ds-title" style="font-size:54px;font-weight:900;letter-spacing:10px;color:#ff5b4d;text-shadow:0 4px 18px rgba(0,0,0,0.8)">YOU DIED</div>` +
        `<div id="ds-killer" style="margin-top:10px;font-size:17px;color:#f1d9d4"></div>` +
        `<div id="ds-count" style="margin-top:16px;font-size:15px;color:#cfd8cf;letter-spacing:2px"></div></div>`;
      document.body.appendChild(this.deathEl);
    }
    this.deathEl.style.display = "block";
    const killerEl = this.deathEl.querySelector("#ds-killer") as HTMLElement;
    killerEl.textContent = this.killerName ? `killed by ${this.killerName}` : "";
    const left = Math.max(0, C.RESPAWN_MS / 1000 - t);
    (this.deathEl.querySelector("#ds-count") as HTMLElement).textContent =
      left > 0.05 ? `respawning in ${left.toFixed(1)}s` : "respawning...";
  }

  private fire(now: number, ads: boolean) {
    const w = WEAPONS[this.weapon];
    this.localAmmo--;
    this.lastShotAt = now;

    // base direction from the camera, then add a spread cone
    this.scene.cameraForward(this.fwd);
    const moving =
      this.input.isDown("KeyW") ||
      this.input.isDown("KeyA") ||
      this.input.isDown("KeyS") ||
      this.input.isDown("KeyD");
    let spread = ads ? w.spreadAds : w.spreadHip;
    if (moving) spread *= w.moveSpreadMult;
    if (!this.pred.onGround) spread *= 1.5;
    this.applySpread(this.fwd, spread);

    const cmd: ShootCmd = {
      ox: this.pred.x + this.leanX,
      oy: this.pred.y + eyeHeightFor(this.pred.crouch),
      oz: this.pred.z + this.leanZ,
      dx: this.fwd.x,
      dy: this.fwd.y,
      dz: this.fwd.z,
      clientTime: now,
    };
    this.room.send(Msg.Shoot, cmd);

    if (this.weapon === "rocket") this.audio.rocketLaunch();
    else this.audio.shot(this.weapon);
    this.scene.flashMuzzle();

    // recoil kick (up + random horizontal)
    this.recoilPitch += w.recoilPitch;
    this.recoilYaw += (Math.random() - 0.5) * 2 * w.recoilYaw;

    if (this.localAmmo === 0) this.startReload(now);
  }

  // perturb a unit direction within a cone of the given half-angle
  private applySpread(dir: THREE.Vector3, halfAngle: number) {
    if (halfAngle <= 0) return;
    this.up.set(0, 1, 0);
    if (Math.abs(dir.y) > 0.95) this.up.set(1, 0, 0);
    this.right.copy(dir).cross(this.up).normalize();
    this.up.copy(this.right).cross(dir).normalize();
    const a = Math.random() * Math.PI * 2;
    const r = Math.tan(halfAngle * Math.sqrt(Math.random()));
    dir
      .addScaledVector(this.right, Math.cos(a) * r)
      .addScaledVector(this.up, Math.sin(a) * r)
      .normalize();
  }

  private switchWeapon(id: WeaponId) {
    this.weapon = id;
    this.localAmmo = WEAPONS[id].magazine;
    this.reloadUntil = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.scene.setWeapon(id);
    this.audio.click();
    this.room.send(Msg.Switch, { weapon: id } as SwitchCmd);
  }

  private startReload(now: number) {
    const w = WEAPONS[this.weapon];
    if (this.reloadUntil || this.localAmmo >= w.magazine) return;
    this.reloadUntil = now + w.reloadMs;
    this.audio.reload();
    this.room.send(Msg.Reload);
  }

  private updateRemotes() {
    const players = this.room.state.players;
    players.forEach((p: any, id: string) => {
      if (id === this.meId) return;
      this.scene.ensureRemote(
        id, p.team, p.x, p.y, p.z, p.yaw,
        p.lean ?? 0, p.pitch ?? 0, p.weapon ?? "rifle", p.crouch ?? false, p.name ?? ""
      );
      this.scene.setRemoteVisible(id, p.alive);
    });
  }

  private updateHud(me: any, w: { name: string }) {
    const s = this.room.state;
    this.minimap.update(s, this.meId);
    this.hud.setScores(s.scoreTeam0, s.scoreTeam1);
    this.hud.setTimer(s.timeRemaining);
    this.hud.setPhase(s.phase, s.scoreTeam0, s.scoreTeam1);
    if (me) this.scene.setLocalTeam(me.team);

    // weather: replicated from the host's dial
    if (s.weather !== this.lastWeather) {
      this.lastWeather = s.weather;
      this.scene.setWeather(s.weather);
    }
    // host can also cycle the weather live with V
    const vNow = this.input.isDown("KeyV");
    if (vNow && !this.wasV && s.hostId === this.meId) {
      const i = (WEATHER_KINDS as readonly string[]).indexOf(s.weather);
      this.room.send(Msg.Weather, { w: WEATHER_KINDS[(i + 1) % WEATHER_KINDS.length] });
    }
    this.wasV = vNow;

    // lobby / scoreboard overlays follow the match phase
    this.lobbyRefresh -= 1;
    if (s.phase === "lobby") {
      if (this.lobbyRefresh <= 0 || this.lastPhase !== "lobby") {
        this.lobbyRefresh = 20; // rebuild the DOM ~3x/sec
        this.lobby.showLobby(s, this.meId);
      }
    } else if (s.phase === "ended") {
      if (this.lobbyRefresh <= 0 || this.lastPhase !== "ended") {
        this.lobbyRefresh = 60;
        this.lobby.showScoreboard(s);
      }
    } else if (this.lastPhase === "lobby" || this.lastPhase === "ended") {
      this.lobby.hide();
      this.input.lock(); // back into the action
    }
    this.lastPhase = s.phase;
    if (me) {
      this.hud.setHealth(me.health);
      this.hud.setSpawnProtected(!!me.protected && me.alive);
      this.hud.setWeaponHud(
        this.weapon,
        WEAPONS[this.weapon].name,
        this.localAmmo,
        WEAPONS[this.weapon].magazine,
        this.reloadUntil > 0
      );
    }

    const open = this.input.isDown("Tab") || s.phase === "ended";
    if (open !== this.scoreboardOpen) {
      this.scoreboardOpen = open;
      this.hud.toggleScoreboard(open);
    }
    if (open) {
      const rows: any[] = [];
      s.players.forEach((p: any, id: string) =>
        rows.push({ id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths })
      );
      this.hud.renderScoreboard(rows, this.meId);
    }
  }
}
