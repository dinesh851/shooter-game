import { Client, Room } from "colyseus.js";

// Wraps the Colyseus client. We connect to the same host the page was served
// from (location.hostname), so opening the game by the server Mac's LAN IP just
// works — no hard-coded addresses. The game server listens on port 2567.
export class Connection {
  client!: Client;
  room!: Room<any>;
  sessionId = "";

  async connect(name: string): Promise<Room<any>> {
    const port = Number(import.meta.env.VITE_SERVER_PORT) || 2890;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const host = location.hostname || "localhost";
    this.client = new Client(`${proto}://${host}:${port}`);
    this.room = await this.client.joinOrCreate("match", { name });
    this.sessionId = this.room.sessionId;
    return this.room;
  }
}
