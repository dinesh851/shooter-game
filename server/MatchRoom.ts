import colyseus from "colyseus";
import type { Client } from "colyseus";
import { MatchState, Player } from "./state";

// `colyseus` ships as CommonJS without an `exports` map, so Node's ESM loader
// can't see its re-exported names. Default-import the module and destructure.
const { Room } = colyseus;
import { rayCapsule, raySphere, HEAD_RADIUS } from "./hitscan";
import {
  Msg, Ev, ShootCmd, GrenadeCmd, SwitchCmd, TracerEv, HitEv, KillEv, GrenadeThrowEv, ExplosionEv, PingEv,
  WEATHER_KINDS,
} from "../shared/protocol";
import { terrainHeight } from "../shared/terrain";
import { InputCmd, MoveState, playerHeightFor, DT_MAX } from "../shared/phys";
import { step as arcadeStep } from "../shared/arcade";
import { MAP } from "../shared/mapdata";
import { rayObstructionT, grenadeStep } from "../shared/blockmap";
import { WEAPONS, DEFAULT_WEAPON, isWeaponId } from "../shared/weapons";
import * as C from "../shared/constants";

export class MatchRoom extends Room<MatchState> {
  maxClients = C.MAX_PLAYERS;

  // Server-only data (not replicated)
  private inputs = new Map<string, InputCmd[]>();
  private lastShotAt = new Map<string, number>();
  private now = 0; // authoritative clock (ms since room start)
  private respawnAt = new Map<string, number>();
  private reloadEndsAt = new Map<string, number>();
  private simBudget = new Map<string, number>(); // ms of movement a player may simulate
  private grenades: {
    id: number;
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    owner: string;
    team: number;
    fuseAt: number;
  }[] = [];
  private grenadeSeq = 0;
  private lastGrenadeAt = new Map<string, number>();
  private lastPingAt = new Map<string, number>();
  private lastDamageAt = new Map<string, number>();
  private bots = new Map<string, { tx: number; tz: number; nextShot: number; repath: number }>();
  private botSeq = 0;

  onCreate() {
    this.setState(new MatchState());
    this.state.phase = "lobby";
    this.state.timeRemaining = 0;
    this.setPatchRate(C.PATCH_RATE_MS);

    // ---- lobby flow ----
    this.onMessage(Msg.SelectTeam, (client, msg: { team: number }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || this.state.phase !== "lobby") return;
      const t = msg?.team === 1 ? 1 : 0;
      if (p.team !== t) {
        p.team = t;
        p.ready = false;
        this.spawn(p); // stand on your own side of the map while waiting
      }
    });
    this.onMessage(Msg.Ready, (client, msg: { ready: boolean }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || this.state.phase !== "lobby") return;
      p.ready = !!msg?.ready;
    });
    this.onMessage(Msg.Start, (client) => {
      if (client.sessionId !== this.state.hostId || this.state.phase !== "lobby") return;
      let allReady = true;
      this.state.players.forEach((p) => {
        if (!p.bot && !p.ready) allReady = false;
      });
      if (!allReady) return;
      this.beginMatch();
    });
    this.onMessage(Msg.AddBot, (client) => {
      if (client.sessionId !== this.state.hostId || this.state.phase !== "lobby") return;
      if (this.bots.size >= 6 || this.state.players.size >= C.MAX_PLAYERS) return;
      this.addBot();
    });
    this.onMessage(Msg.Lat, (client, msg: { t: number }) => client.send(Msg.Lat, msg));
    this.onMessage(Msg.Weather, (client, msg: { w: string }) => {
      if (client.sessionId !== this.state.hostId) return; // admin dial only
      if ((WEATHER_KINDS as readonly string[]).includes(msg?.w)) this.state.weather = msg.w;
    });
    this.onMessage(Msg.Ping, (client, msg: { x: number; y: number; z: number }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive) return;
      const last = this.lastPingAt.get(client.sessionId) ?? -9999;
      if (this.now - last < 1000) return; // rate limit
      this.lastPingAt.set(client.sessionId, this.now);
      const ev: PingEv = { x: msg.x, y: msg.y, z: msg.z, by: p.name };
      for (const c of this.clients) {
        const tp = this.state.players.get(c.sessionId);
        if (tp && tp.team === p.team) c.send(Ev.Ping, ev);
      }
    });

    this.onMessage(Msg.Input, (client, cmd: InputCmd) => {
      const q = this.inputs.get(client.sessionId);
      if (q) q.push(cmd);
    });
    this.onMessage(Msg.Shoot, (client, cmd: ShootCmd) => this.handleShoot(client, cmd));
    this.onMessage(Msg.Grenade, (client, cmd: ShootCmd) => this.handleGrenade(client, cmd));
    this.onMessage(Msg.Reload, (client) => this.startReload(client.sessionId));
    this.onMessage(Msg.Switch, (client, cmd: SwitchCmd) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive || !isWeaponId(cmd.weapon)) return;
      if (p.weapon === cmd.weapon) return;
      p.weapon = cmd.weapon;
      p.ammo = WEAPONS[cmd.weapon].magazine; // fresh mag on swap (arcade)
      p.reloading = false;
      this.reloadEndsAt.delete(client.sessionId);
    });

    this.setSimulationInterval((dt) => this.tick(dt), C.TICK_MS);
    console.log("[MatchRoom] created");
  }

  onJoin(client: Client, options: { name?: string }) {
    const p = new Player();
    p.id = client.sessionId;
    p.name = (options?.name || "Player").slice(0, 16) || "Player";

    // assign to the smaller team to keep things balanced
    let t0 = 0;
    let t1 = 0;
    this.state.players.forEach((pl) => (pl.team === 0 ? t0++ : t1++));
    p.team = t0 <= t1 ? 0 : 1;

    this.spawn(p);
    this.state.players.set(client.sessionId, p);
    this.inputs.set(client.sessionId, []);
    if (!this.state.hostId) this.state.hostId = client.sessionId; // first player runs the lobby
    console.log(`[MatchRoom] ${p.name} joined (team ${p.team}) — ${this.state.players.size} players`);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.inputs.delete(client.sessionId);
    this.lastShotAt.delete(client.sessionId);
    this.respawnAt.delete(client.sessionId);
    this.reloadEndsAt.delete(client.sessionId);
    this.simBudget.delete(client.sessionId);
    // hand the lobby to the next human if the host left
    if (client.sessionId === this.state.hostId) {
      this.state.hostId = "";
      this.state.players.forEach((p, id) => {
        if (!this.state.hostId && !p.bot) this.state.hostId = id;
      });
    }
  }

  private beginMatch() {
    const s = this.state;
    s.phase = "warmup";
    s.timeRemaining = C.MATCH.warmupMs;
    s.scoreTeam0 = 0;
    s.scoreTeam1 = 0;
    s.players.forEach((p) => {
      p.kills = 0;
      p.deaths = 0;
      p.shots = 0;
      p.hits = 0;
      p.longest = 0;
      this.spawn(p);
    });
  }

  // ---- bots ----------------------------------------------------------------

  private addBot() {
    const id = `bot-${++this.botSeq}`;
    const p = new Player();
    p.id = id;
    p.bot = true;
    p.ready = true;
    p.name = `BOT ${String.fromCharCode(64 + this.botSeq)}`;
    let t0 = 0;
    let t1 = 0;
    this.state.players.forEach((pl) => (pl.team === 0 ? t0++ : t1++));
    p.team = t0 <= t1 ? 0 : 1;
    this.spawn(p);
    this.state.players.set(id, p);
    this.bots.set(id, { tx: p.x, tz: p.z, nextShot: 0, repath: 0 });
  }

  private updateBots(dtMs: number) {
    // bots hold at spawn during warmup too, so nobody is mid-stride when the
    // round goes live (and there is no teleport when live begins)
    if (this.state.phase !== "live") return;
    const dt = dtMs / 1000;
    this.bots.forEach((b, id) => {
      const p = this.state.players.get(id);
      if (!p) return;
      if (!p.alive) {
        const ra = this.respawnAt.get(id) ?? 0;
        if (this.now >= ra) this.spawn(p);
        return;
      }

      // wander: pick a new waypoint when reached / periodically
      b.repath -= dtMs;
      const dxw = b.tx - p.x;
      const dzw = b.tz - p.z;
      if (b.repath <= 0 || dxw * dxw + dzw * dzw < 4) {
        b.tx = (Math.random() - 0.5) * 150;
        b.tz = (Math.random() - 0.5) * 150;
        b.repath = 6000 + Math.random() * 6000;
      }

      // face an enemy if one is visible, else the waypoint
      let target: Player | null = null;
      let bestD = 55;
      this.state.players.forEach((t) => {
        if (t.team === p.team || !t.alive) return;
        const d = Math.hypot(t.x - p.x, t.z - p.z);
        if (d < bestD) {
          const dl = d || 1;
          const dir = { x: (t.x - p.x) / dl, y: (t.y - p.y) / dl, z: (t.z - p.z) / dl };
          if (rayObstructionT({ x: p.x, y: p.y + 1.5, z: p.z }, dir, d) >= d) {
            bestD = d;
            target = t;
          }
        }
      });

      const t = target as Player | null;
      const lookX = t ? t.x : b.tx;
      const lookZ = t ? t.z : b.tz;
      p.yaw = Math.atan2(-(lookX - p.x), -(lookZ - p.z));

      // walk forward (bot input synthesized directly)
      const ms: MoveState = { x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, onGround: p.onGround, crouch: false };
      arcadeStep(ms, {
        seq: 0, dtMs, forward: !t || bestD > 14, back: false, left: false, right: false,
        jump: false, crouch: false, yaw: p.yaw, pitch: 0, lean: 0,
      });
      p.x = ms.x; p.y = ms.y; p.z = ms.z;
      p.vx = ms.vx; p.vy = ms.vy; p.vz = ms.vz;
      p.onGround = ms.onGround;

      // shoot at the target with generous spread
      if (t && this.now >= b.nextShot) {
        b.nextShot = this.now + 380 + Math.random() * 300;
        const oy = p.y + 1.55;
        const dx = t.x - p.x + (Math.random() - 0.5) * 2.2;
        const dy = t.y + 1.2 - oy + (Math.random() - 0.5) * 1.4;
        const dz = t.z - p.z + (Math.random() - 0.5) * 2.2;
        this.fireHitscan(p, { x: p.x, y: oy, z: p.z }, { x: dx, y: dy, z: dz });
      }
      void dt;
    });
  }

  // ---- simulation ---------------------------------------------------------

  private tick(dtMs: number) {
    this.now += dtMs;
    this.state.serverTime = this.now;
    this.updatePhase(dtMs);
    this.updateGrenades(dtMs);
    this.updateBots(dtMs);

    this.state.players.forEach((p, id) => {
      const q = this.inputs.get(id);
      if (!q) return;

      // warmup is a "get ready" countdown: everyone is held frozen at their spawn
      // so the round can go live in place — no jarring teleport when it starts.
      // Consume inputs without moving, but advance lastSeq so the client clears its
      // pending queue (otherwise it replays a backlog and lurches when live starts).
      if (this.state.phase === "warmup") {
        for (const cmd of q) if (cmd.seq > p.lastSeq) p.lastSeq = cmd.seq;
        q.length = 0;
        p.vx = 0; p.vy = 0; p.vz = 0;
        return;
      }

      if (!p.alive) {
        q.length = 0; // ignore inputs while dead
        const ra = this.respawnAt.get(id) ?? 0;
        if (this.now >= ra) this.spawn(p);
        return;
      }

      // health regen: untouched for a few seconds -> slowly recover
      if (p.health < C.MAX_HEALTH && this.now - (this.lastDamageAt.get(id) ?? 0) > C.REGEN.delayMs) {
        p.health = Math.min(C.MAX_HEALTH, p.health + (C.REGEN.perSecond * dtMs) / 1000);
      }

      // finish a reload in progress
      if (p.reloading) {
        const end = this.reloadEndsAt.get(id) ?? 0;
        if (this.now >= end) {
          const w = WEAPONS[p.weapon as keyof typeof WEAPONS] ?? WEAPONS[DEFAULT_WEAPON];
          p.ammo = w.magazine;
          p.reloading = false;
          this.reloadEndsAt.delete(id);
        }
      }

      if (q.length > 16) q.splice(0, q.length - 16);

      const ms: MoveState = {
        x: p.x,
        y: p.y,
        z: p.z,
        vx: p.vx,
        vy: p.vy,
        vz: p.vz,
        onGround: p.onGround,
        crouch: p.crouch,
      };

      // Budget simulated time against real elapsed time so a client can't BANK
      // inputs (e.g. 10 cmds x 50ms) and teleport. Each tick grants dtMs*1.5 of
      // movement time (with a small accumulation cap for jitter); we drain the
      // queue until that budget runs out, dropping the rest.
      let budget = Math.min((this.simBudget.get(id) ?? 0) + dtMs * 1.5, dtMs * 4);
      let lastSeq = p.lastSeq;
      for (const cmd of q) {
        if (cmd.seq <= lastSeq) continue; // drop stale / replayed inputs
        const cdt = Math.min(Math.max(cmd.dtMs, 0), DT_MAX * 1000);
        if (budget < cdt) break; // out of movement budget this tick
        budget -= cdt;
        arcadeStep(ms, cmd);
        lastSeq = cmd.seq;
        p.yaw = cmd.yaw;
        p.pitch = cmd.pitch;
        p.lean = cmd.lean ?? 0;
      }
      q.length = 0;
      this.simBudget.set(id, budget);

      p.x = ms.x;
      p.y = ms.y;
      p.z = ms.z;
      p.vx = ms.vx;
      p.vy = ms.vy;
      p.vz = ms.vz;
      p.onGround = ms.onGround;
      p.crouch = ms.crouch;
      p.lastSeq = lastSeq;
    });
  }

  private updatePhase(dtMs: number) {
    const s = this.state;
    if (s.phase === "lobby") return; // waits for the host to start

    s.timeRemaining -= dtMs;
    if (s.phase === "warmup") {
      if (s.timeRemaining <= 0) {
        s.phase = "live";
        s.timeRemaining = C.MATCH.liveMs;
        s.scoreTeam0 = 0;
        s.scoreTeam1 = 0;
        // do NOT re-spawn here: everyone was frozen at their spawn through warmup,
        // so the round goes live in place. Re-spawning teleported players to a new
        // random point the instant the match started, which felt like a reset.
        this.state.players.forEach((p) => {
          p.kills = 0;
          p.deaths = 0;
        });
      }
    } else if (s.phase === "live") {
      const limitHit = s.scoreTeam0 >= C.MATCH.scoreLimit || s.scoreTeam1 >= C.MATCH.scoreLimit;
      if (s.timeRemaining <= 0 || limitHit) {
        s.phase = "ended";
        s.timeRemaining = C.MATCH.endMs;
      }
    } else if (s.phase === "ended") {
      if (s.timeRemaining <= 0) {
        // back to the lobby so teams can be reshuffled for the next round
        s.phase = "lobby";
        s.timeRemaining = 0;
        this.state.players.forEach((p) => {
          p.ready = p.bot;
          this.spawn(p);
        });
      }
    }
  }

  private spawn(p: Player) {
    const opts = MAP.spawns.filter((sp) => sp.team === p.team);
    const sp = opts.length ? opts[Math.floor(Math.random() * opts.length)] : MAP.spawns[0];
    p.x = sp.x;
    p.y = sp.y;
    p.z = sp.z;
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
    p.yaw = sp.yaw;
    p.pitch = 0;
    p.onGround = true;
    p.crouch = false;
    p.health = C.MAX_HEALTH;
    p.alive = true;
    if (!isWeaponId(p.weapon)) p.weapon = DEFAULT_WEAPON;
    p.ammo = WEAPONS[p.weapon as keyof typeof WEAPONS].magazine;
    p.reloading = false;
    this.reloadEndsAt.delete(p.id);
  }

  private startReload(id: string) {
    const p = this.state.players.get(id);
    if (!p || !p.alive || p.reloading) return;
    const w = WEAPONS[p.weapon as keyof typeof WEAPONS] ?? WEAPONS[DEFAULT_WEAPON];
    if (p.ammo >= w.magazine) return;
    p.reloading = true;
    this.reloadEndsAt.set(id, this.now + w.reloadMs);
  }

  // ---- grenades -----------------------------------------------------------

  private handleGrenade(client: Client, cmd: GrenadeCmd) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive) return;
    const last = this.lastGrenadeAt.get(client.sessionId) ?? -99999;
    if (this.now - last < C.GRENADE.cooldownMs) return;
    this.lastGrenadeAt.set(client.sessionId, this.now);

    // cooking: holding the grenade burns fuse before the throw
    const held = Math.max(0, Math.min(cmd.heldMs ?? 0, C.GRENADE.fuseMs - 250));
    const fuseMs = C.GRENADE.fuseMs - held;

    const dl = Math.hypot(cmd.dx, cmd.dy, cmd.dz) || 1;
    const id = ++this.grenadeSeq;
    const g = {
      id,
      x: cmd.ox,
      y: cmd.oy,
      z: cmd.oz,
      vx: (cmd.dx / dl) * C.GRENADE.throwSpeed,
      vy: (cmd.dy / dl) * C.GRENADE.throwSpeed + C.GRENADE.up,
      vz: (cmd.dz / dl) * C.GRENADE.throwSpeed,
      owner: client.sessionId,
      team: p.team,
      fuseAt: this.now + fuseMs,
    };
    this.grenades.push(g);
    const ev: GrenadeThrowEv = { id, x: g.x, y: g.y, z: g.z, vx: g.vx, vy: g.vy, vz: g.vz, fuseMs };
    this.broadcast(Ev.GrenadeThrow, ev);
  }

  private updateGrenades(dtMs: number) {
    const dt = dtMs / 1000;
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      // shared step: terrain bounce + map bounds + tree/rock/log bounces,
      // identical math to the grenade the clients are watching
      grenadeStep(g, dt);
      if (this.now >= g.fuseAt) {
        this.explodeGrenade(g);
        this.grenades.splice(i, 1);
      }
    }
  }

  private explodeGrenade(g: { x: number; y: number; z: number; owner: string; team: number }) {
    const ev: ExplosionEv = { x: g.x, y: g.y, z: g.z };
    this.broadcast(Ev.Explosion, ev);
    if (this.state.phase !== "live") return; // FX always, damage only in a live round

    const owner = this.state.players.get(g.owner);
    this.state.players.forEach((target, tid) => {
      if (!target.alive || target.team === g.team) return; // no friendly fire / self
      const dx = target.x - g.x;
      const dy = target.y + 1.0 - g.y;
      const dz = target.z - g.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist >= C.GRENADE.radius) return;
      let dmg = C.GRENADE.maxDamage * (1 - dist / C.GRENADE.radius);
      // standing behind a tree/rock/hill shields most of the blast
      const d = dist || 1;
      if (rayObstructionT({ x: g.x, y: g.y + 0.1, z: g.z }, { x: dx / d, y: dy / d, z: dz / d }, dist) < dist) {
        dmg *= 0.35;
      }
      target.health -= dmg;
      this.lastDamageAt.set(tid, this.now);
      const hit: HitEv = { x: target.x, y: target.y + 1, z: target.z, victim: tid, shooter: g.owner };
      this.broadcast(Ev.Hit, hit);
      if (target.health <= 0) {
        target.health = 0;
        target.alive = false;
        target.deaths++;
        this.respawnAt.set(tid, this.now + C.RESPAWN_MS);
        if (owner) {
          owner.kills++;
          if (owner.team === 0) this.state.scoreTeam0++;
          else this.state.scoreTeam1++;
        }
        const kill: KillEv = {
          killer: g.owner,
          killerName: owner?.name ?? "Grenade",
          victim: tid,
          victimName: target.name,
          head: false,
        };
        this.broadcast(Ev.Kill, kill);
      }
    });
  }

  // ---- shooting -----------------------------------------------------------

  private handleShoot(client: Client, cmd: ShootCmd) {
    const shooter = this.state.players.get(client.sessionId);
    if (!shooter || !shooter.alive) return; // bullets show in warmup too; damage gated below
    if (shooter.reloading) return;

    const w = WEAPONS[shooter.weapon as keyof typeof WEAPONS] ?? WEAPONS[DEFAULT_WEAPON];
    const last = this.lastShotAt.get(client.sessionId) ?? -9999;
    if (this.now - last < w.fireIntervalMs - 8) return; // rate limit (small net tolerance)
    if (shooter.ammo <= 0) return;
    this.lastShotAt.set(client.sessionId, this.now);
    shooter.ammo--;

    this.fireHitscan(shooter, { x: cmd.ox, y: cmd.oy, z: cmd.oz }, { x: cmd.dx, y: cmd.dy, z: cmd.dz });
  }

  // one hitscan shot from `shooter` — used by both clients and bots
  private fireHitscan(shooter: Player, o: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }) {
    const w = WEAPONS[shooter.weapon as keyof typeof WEAPONS] ?? WEAPONS[DEFAULT_WEAPON];
    const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const d = { x: dir.x / dl, y: dir.y / dl, z: dir.z / dl };
    shooter.shots++;

    let bestT = w.range;
    let hitId: string | null = null;
    let headshot = false;
    this.state.players.forEach((target, tid) => {
      if (tid === shooter.id || !target.alive || target.team === shooter.team) return;
      const h = playerHeightFor(target.crouch);
      // generous head sphere near the top + body capsule below
      const headHit = raySphere(o, d, target.x, target.y + h - 0.28, target.z, HEAD_RADIUS);
      const bodyHit = rayCapsule(o, d, target.x, target.y, target.z, h);
      let t = Infinity;
      let head = false;
      if (headHit !== null) {
        t = headHit;
        head = true;
      }
      if (bodyHit && bodyHit.t < t) {
        t = bodyHit.t;
        head = bodyHit.head;
      }
      if (t < bestT) {
        bestT = t;
        hitId = tid;
        headshot = head;
      }
    });

    // world occlusion: terrain and solid blocks (tree trunks, rocks) stop the
    // shot — the tracer/impact ends there and any player behind is safe.
    const obsT = rayObstructionT(o, d, w.range);
    if (obsT < bestT) {
      bestT = obsT;
      hitId = null;
      headshot = false;
    }

    const ex = o.x + d.x * bestT;
    const ey = o.y + d.y * bestT;
    const ez = o.z + d.z * bestT;
    const tracer: TracerEv = { ox: o.x, oy: o.y, oz: o.z, ex, ey, ez, shooter: shooter.id };
    this.broadcast(Ev.Tracer, tracer);

    if (hitId && this.state.phase === "live") {
      const target = this.state.players.get(hitId)!;
      const dmg = w.damage * (headshot ? w.headshotMult : 1);
      target.health -= dmg;
      this.lastDamageAt.set(hitId, this.now);
      shooter.hits++;
      const hit: HitEv = { x: ex, y: ey, z: ez, victim: hitId, shooter: shooter.id };
      this.broadcast(Ev.Hit, hit);

      if (target.health <= 0) {
        target.health = 0;
        target.alive = false;
        target.deaths++;
        this.respawnAt.set(hitId, this.now + C.RESPAWN_MS);
        shooter.kills++;
        shooter.longest = Math.max(shooter.longest, Math.round(bestT));
        if (shooter.team === 0) this.state.scoreTeam0++;
        else this.state.scoreTeam1++;
        const kill: KillEv = {
          killer: shooter.id,
          killerName: shooter.name,
          victim: hitId,
          victimName: target.name,
          head: headshot,
        };
        this.broadcast(Ev.Kill, kill);
      }
    }
  }
}
