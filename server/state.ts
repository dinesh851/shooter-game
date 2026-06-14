// Colyseus schema = the authoritative state that is automatically delta-synced
// to every client. Only fields declared with @type are replicated.

import { Schema, type, MapSchema } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") id = "";
  @type("string") name = "";
  @type("number") team = 0;

  // transform
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") z = 0;
  @type("number") yaw = 0;
  @type("number") pitch = 0;
  @type("number") lean = 0;
  @type("number") vx = 0;
  @type("number") vy = 0;
  @type("number") vz = 0;
  @type("boolean") onGround = true;
  @type("boolean") crouch = false;

  // combat
  @type("number") health = 100;
  @type("boolean") alive = true;
  @type("string") weapon = "rifle";
  @type("number") ammo = 30;
  @type("boolean") reloading = false;
  @type("number") kills = 0;
  @type("number") deaths = 0;

  // lobby + end-of-match stats
  @type("boolean") ready = false;
  @type("boolean") bot = false;
  @type("number") shots = 0;
  @type("number") hits = 0;
  @type("number") longest = 0; // longest kill distance (m)

  // netcode: last input sequence the server has processed for this player.
  // The client uses this to discard acknowledged inputs and replay the rest.
  @type("number") lastSeq = 0;
}

export class MatchState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type("string") phase = "lobby"; // "lobby" | "warmup" | "live" | "ended"
  @type("string") hostId = ""; // first player in the room runs the lobby
  @type("string") weather = "mist"; // host-controlled: sunny | mist | heavy | rain
  @type("number") timeRemaining = 0; // ms left in the current phase
  @type("number") scoreTeam0 = 0;
  @type("number") scoreTeam1 = 0;
  @type("number") serverTime = 0; // ms since room start (authoritative clock)
}
