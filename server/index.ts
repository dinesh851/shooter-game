import http from "http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import express from "express";
import colyseus from "colyseus";
import wsTransport from "@colyseus/ws-transport";
import { MatchRoom } from "./MatchRoom";

// CommonJS packages without an `exports` map — default-import + destructure.
const { Server } = colyseus;
const { WebSocketTransport } = wsTransport;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 2890;

const app = express();
app.get("/health", (_req, res) => res.json({ ok: true }));

// In production (after `npm run build`) serve the built client from this same
// server, so the whole game is reachable at a single LAN URL on one port.
const clientDir = path.resolve(__dirname, "../dist/client");
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir));
  app.get("*", (_req, res) => res.sendFile(path.join(clientDir, "index.html")));
  console.log("[server] serving built client from", clientDir);
}

const server = http.createServer(app);
const gameServer = new Server({ transport: new WebSocketTransport({ server }) });
gameServer.define("match", MatchRoom);

gameServer.listen(PORT, "0.0.0.0");
console.log(`[server] LAN shooter listening on 0.0.0.0:${PORT}`);
