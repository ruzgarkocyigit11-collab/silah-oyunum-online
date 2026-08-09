const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const rooms = new Map();

const GAME_FILE = path.join(
  __dirname,
  "3D_Silah_Savasi_Seviye_250XP_Silahlar_Boss.html"
);

function createId() {
  return Math.random().toString(36).slice(2, 10);
}

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function getPlayers(room) {
  return Array.from(room.values()).map((p) => ({
    id: p.id,
    name: p.name,
    x: p.x,
    y: p.y,
    z: p.z,
    yaw: p.yaw,
    pitch: p.pitch,
    hp: p.hp,
    weapon: p.weapon,
    crouching: p.crouching
  }));
}

function broadcast(room, data, except) {
  for (const p of room.values()) {
    if (p.ws !== except) {
      send(p.ws, data);
    }
  }
}

const server = http.createServer((req, res) => {

  if (req.url === "/" || req.url === "/index.html") {

    fs.readFile(GAME_FILE, (err, data) => {

      if (err) {
        res.writeHead(500, {
          "Content-Type": "text/plain; charset=utf-8"
        });

        res.end(
          "Oyun dosyasi bulunamadi: " +
          GAME_FILE
        );

        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache"
      });

      res.end(data);
    });

    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8"
  });

  res.end("Silah Oyunu Multiplayer Beta Server");
});

const wss = new WebSocket.Server({
  server
});

wss.on("connection", (ws) => {

  let player = null;

  ws.on("message", (raw) => {

    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch (error) {
      return;
    }

    if (msg.type === "join") {

      if (player) {
        return;
      }

      const roomName =
        String(msg.room || "arena")
          .replace(/[^\w-]/g, "")
          .slice(0, 20) || "arena";

      let room = rooms.get(roomName);

      if (!room) {
        room = new Map();
        rooms.set(roomName, room);
      }

      if (room.size >= 8) {

        send(ws, {
          type: "      
