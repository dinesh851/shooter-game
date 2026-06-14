# LAN Shooter

A browser-based, **first-person multiplayer shooter** for the office LAN. Players
open a URL â€” no install. One machine runs the authoritative game server; everyone
else connects over the local network. Built with **Three.js** (rendering) and
**Colyseus** (authoritative rooms + state sync).

This is **milestones 1-4** of the plan: connect -> first-person movement
(client-predicted, server-authoritative) -> server-side hitscan shooting ->
timed **Team Deathmatch** with scoring and a scoreboard.

---

## Quick start (one machine, for development)

```bash
npm install
npm run dev
```

- `npm run dev` runs the game server (port **2890**) and the Vite client dev
  server (port **5173**) together.
- Open **http://localhost:5173** in Chrome. Open a second window (or an incognito
  window) to play against yourself and see another player.
- Click the canvas to lock the mouse. **WASD** move, **Space** jump, **mouse**
  look, **click** to fire, **R** reload, **Tab** scoreboard, **Esc** release mouse.

## Play on the office LAN

On the **server Mac** (the one hosting):

```bash
npm install
npm run build      # builds the client once
npm start          # serves client + game server together on port 2890
```

Find that Mac's LAN IP (`System Settings -> Network`, or `ipconfig getifaddr en0`),
e.g. `192.168.1.50`. Everyone else opens:

```
http://192.168.1.50:2890
```

That single URL serves the game and connects back to the same host automatically.
Make sure macOS allows incoming connections on port 2890 (you'll get a firewall
prompt the first time, or add Node under *System Settings -> Network -> Firewall*).

> Dev vs prod: `npm run dev` is for coding (hot reload on :5173). For actual LAN
> play use `npm run build` + `npm start` (single port :2890).

> Port note: the game server defaults to **2890** (2567 was already taken on this
> machine by another app). Override with the `PORT` env var on the server and
> `VITE_SERVER_PORT` for the client if you need a different one.

## Verify it works (headless)

With the server running (`npm run dev` or `npm start`), in another terminal:

```bash
npx tsx scripts/smoke.ts
```

It connects two bot clients, drives one forward, and checks the server simulated
the movement and synced state back. Expect `[smoke] PASS`.

---

## How it's built

```
shared/      # code shared by client + server (the key to matching prediction)
  constants.ts   tunables (speed, weapon, match timings)
  arena.ts       the greybox map + spawns
  movement.ts    deterministic movement step - run on BOTH sides
  protocol.ts    message + event names and payloads

server/      # authoritative Node.js game server (Colyseus)
  index.ts       boots the server, serves the built client in production
  MatchRoom.ts   room: fixed-tick sim, input processing, match flow, shooting
  hitscan.ts     ray-vs-capsule hit detection
  state.ts       Colyseus schema (the replicated state)

client/      # browser app (Vite + Three.js)
  src/net/         Colyseus connection
  src/input/       keyboard + pointer-lock mouse, look angles
  src/render/      Three.js scene, arena, players, tracers, view model
  src/ui/          HUD (health, ammo, timer, scores, killfeed, scoreboard)
  src/game/        Game loop: prediction, reconciliation, shooting, HUD glue
```

### Netcode (the important part)

- The **server is authoritative**: it runs a 30 Hz simulation, owns every
  position and all hit detection, and broadcasts state at 20 Hz.
- The **client predicts** its own movement immediately using the *same*
  `stepMovement` function the server uses, so there's no input lag.
- When the server acks an input (`lastSeq`), the client **reconciles**: it snaps
  to the authoritative state and replays any inputs the server hasn't processed
  yet. Mismatches self-correct invisibly.
- Other players are smoothed toward their latest server position.
- **Shooting is server-checked**: the client sends the shot ray; the server
  raycasts against authoritative positions and applies damage. Clients can't
  fake hits.

### Tuning

Almost everything lives in [`shared/constants.ts`](shared/constants.ts): movement
speed, jump, gravity, weapon damage/fire-rate/range, respawn time, match length
(`MATCH.liveMs`), and the frag limit. The map is in
[`shared/arena.ts`](shared/arena.ts).

---

## Known limitations of this slice (next milestones)

- **No lag compensation / no wall occlusion** on hitscan yet - it tests against
  current positions and ignores obstacles. On a clean LAN it already feels fair;
  lag-comp rewind + obstacle ray tests are the next netcode upgrade.
- **Remote players use position smoothing**, not a full interpolation buffer.
- **Grouping/parties and matchmaking** (milestone 5) aren't built yet - right now
  everyone joins one shared match room and is auto-balanced onto two teams.
- **Art is greybox** (milestone 6): flat-shaded boxes/capsules, no models, sound,
  or baked lighting yet. See the plan's "stylized PBR" fidelity target.
- Collision is simple AABB pillars; swapping in the Rapier physics engine is the
  planned upgrade for richer maps.

## Asset credits

- EZ Tree (procedural trees, grass + ground textures, grass/flower models) by Dan Greenheck (MIT) - https://github.com/dgreenheck/ez-tree
- Gun and survival prop models: see client/public/models (Kenney CC0 + compressed Sketchfab imports in /guns)
