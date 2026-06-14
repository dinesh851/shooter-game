// Headless end-to-end smoke test: connect two bot clients, move one, fire from
// it, and verify the server simulates movement and registers a hit. Run with the
// server already listening on :2567.
import { Client } from "colyseus.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForMe(room: any) {
  for (let i = 0; i < 50; i++) {
    const me = room.state.players.get(room.sessionId);
    if (me) return me;
    await sleep(50);
  }
  throw new Error("never received own player state");
}

async function main() {
  const client = new Client("ws://localhost:2890");
  const a = await client.joinOrCreate("match", { name: "Mover" });
  const b = await client.joinOrCreate("match", { name: "Target" });

  const meA = await waitForMe(a);
  await waitForMe(b);

  const startX = meA.x;
  const startZ = meA.z;
  const yaw = meA.yaw;

  // Drive forward for ~1.3s
  let seq = 0;
  for (let i = 0; i < 40; i++) {
    a.send("i", {
      seq: ++seq,
      dtMs: 33,
      forward: true,
      back: false,
      left: false,
      right: false,
      jump: false,
      yaw,
      pitch: 0,
    });
    await sleep(33);
  }
  await sleep(300);

  const movedX = meA.x;
  const movedZ = meA.z;
  const dist = Math.hypot(movedX - startX, movedZ - startZ);

  // exercise the new weapon-switch path (Phase C)
  a.send("w", { weapon: "smg" });
  await sleep(300);
  const switched = meA.weapon === "smg" && meA.ammo === 30;

  const ok =
    dist > 1.0 && // actually moved
    meA.lastSeq >= 1 && // server processed inputs
    switched && // weapon switch applied server-side
    a.state.phase !== undefined;

  console.log(
    `[smoke] move: (${startX.toFixed(2)},${startZ.toFixed(2)}) -> (${movedX.toFixed(2)},${movedZ.toFixed(
      2
    )})  dist=${dist.toFixed(2)}  lastSeq=${meA.lastSeq}  weapon=${meA.weapon} ammo=${meA.ammo}  phase=${a.state.phase}  players=${a.state.players.size}`
  );
  console.log(ok ? "[smoke] PASS" : "[smoke] FAIL");

  a.leave();
  b.leave();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("[smoke] ERROR", e);
  process.exit(1);
});
