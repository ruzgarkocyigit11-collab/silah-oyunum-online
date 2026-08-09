const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS_PER_ROOM = 8;
const TICK_MS = 50;

const rooms = new Map();

function id() {
  return crypto.randomBytes(4).toString('hex');
}

function cleanName(v) {
  return String(v || 'Oyuncu')
    .replace(/[^a-zA-Z0-9_ğüşöçıİĞÜŞÖÇ -]/g, '')
    .slice(0, 16) || 'Oyuncu';
}

function cleanRoom(v) {
  return String(v || 'arena')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 16) || 'arena';
}

function roomPlayers(room) {
  return [...room.values()].map(p => ({
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

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room, data, except = null) {
  for (const p of room.values()) {
    if (p.ws !== except) {
      send(p.ws, data);
    }
  }
}

/* =========================================================
   HTTP SUNUCUSU
   ========================================================= */

const GAME_FILE = path.join(
  __dirname,
  '3D_Silah_Savasi_Seviye_250XP_Silahlar_Boss.html'
);

const server = http.createServer((req, res) => {

  if (req.url === '/' || req.url === '/index.html') {

    fs.readFile(GAME_FILE, (err, data) => {

      if (err) {
        res.writeHead(500, {
          'Content-Type': 'text/plain; charset=utf-8'
        });

        return res.end(
          'Oyun dosyasi bulunamadi.\n' +
          'HTML dosyasinin server.js ile ayni klasorde oldugundan emin olun.'
        );
      }

      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      });

      res.end(data);
    });

    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8'
  });

  res.end('3D Silah Savasi Multiplayer Beta server is running.');
});

/* =========================================================
   WEBSOCKET SUNUCUSU
   ========================================================= */

const wss = new WebSocket.Server({
  server
});

wss.on('connection', ws => {

  let player = null;

  ws.on('message', raw => {

    let m;

    try {
      m = JSON.parse(raw.toString());
    } catch {
      return;
    }

    /* =====================================================
       OYUNCU ODAYA GIRIYOR
       ===================================================== */

    if (m.type === 'join') {

      if (player) {
        return;
      }

      const roomName = cleanRoom(m.room);

      let room = rooms.get(roomName);

      if (!room) {
        room = new Map();
        rooms.set(roomName, room);
      }

      if (room.size >= MAX_PLAYERS_PER_ROOM) {

        return send(ws, {
          type: 'error',
          message: 'Oda dolu (maksimum 8 oyuncu).'
        });
      }

      player = {
        id: id(),
        name: cleanName(m.name),
        room: roomName,
        ws,

        x: 0,
        y: 0,
        z: 6,

        yaw: 0,
        pitch: 0,

        hp: 100,
        weapon: 0,

        crouching: false,

        lastHit: 0
      };

      room.set(player.id, player);

      send(ws, {
        type: 'welcome',
        id: player.id,
        room: roomName
      });

      send(ws, {
        type: 'state',
        players: roomPlayers(room)
      });

      broadcast(
        room,
        {
          type: 'state',
          players: roomPlayers(room)
       