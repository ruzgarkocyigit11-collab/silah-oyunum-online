const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const GAME_FILE = path.join(__dirname, '3D_Silah_Savasi_Seviye_250XP_Silahlar_Boss.html');
const rooms = new Map();

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function getState(room) {
  return Array.from(room.values()).map(p => ({
    id: p.id,
    name: p.name,
    x: p.x,
    y: p.y,
    z: p.z,
    yaw: p.yaw,
    pitch: p.pitch,
    hp: p.hp,
    weapon: p.weapon
  }));
}

function broadcast(room, data, except) {
  for (const p of room.values()) {
    if (p.ws !== except) send(p.ws, data);
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(GAME_FILE, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Oyun dosyasi bulunamadi.');
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8'
      });

      res.end(data);
    });

    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8'
  });

  res.end('Silah Oyunu Multiplayer Beta Server');
});

const wss = new WebSocket.Server({ server });

wss.on('connection', ws => {
  let player = null;

  ws.on('message', raw => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }

    if (msg.type === 'join') {
      const roomName = String(msg.room || 'arena')
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 20) || 'arena';

      let room = rooms.get(roomName);

      if (!room) {
        room = new Map();
        rooms.set(roomName, room);
      }

      if (room.size >= 8) {
        send(ws, {
          type: 'error',
          message: 'Oda dolu.'
        });
        return;
      }

      player = {
        id: Math.random().toString(36).slice(2, 10),
        name: String(msg.name || 'Oyuncu').slice(0, 16),
        room: roomName,
        ws: ws,
        x: 0,
        y: 1.6,
        z: 0,
        yaw: 0,
        pitch: 0,
        hp: 100,
        weapon: 0
      };

      room.set(player.id, player);

      send(ws, {
        type: 'welcome',
        id: player.id,
        room: roomName
      });

      broadcast(room, {
        type: 'state',
        players: getState(room)
      });

      return;
    }

    if (!player) return;

    const room = rooms.get(player.room);
    if (!room) return;

    if (msg.type === 'state') {
      player.x = Number(msg.x) || 0;
      player.y = Number(msg.y) || 0;
      player.z = Number(msg.z) || 0;
      player.yaw = Number(msg.yaw) || 0;
      player.pitch = Number(msg.pitch) || 0;
      player.weapon = Number(msg.weapon) || 0;
      return;
    }

    if (msg.type === 'shot') {
      broadcast(room, {
        type: 'shot',
        id: player.id,
        x: Number(msg.x) || 0,
        y: Number(msg.y) || 0,
        z: Number(msg.z) || 0,
        tx: Number(msg.tx) || 0,
        ty: Number(msg.ty) || 0,
        tz: Number(msg.tz) || 0
      }, ws);

      return;
    }

    if (msg.type === 'hit') {
      const target = room.get(String(msg.target));

      if (!target || target === player) return;

      const damage = Math.max(
        1,
        Math.min(100, Number(msg.damage) || 10)
      );

      target.hp = Math.max(
        0,
        target.hp - damage
      );

      send(target.ws, {
        type: 'hit',
        target: target.id,
        damage: damage
      });

      if (target.hp <= 0) {
        target.hp = 100;

        target.x = (Math.random() - 0.5) * 30;
        target.z = (Math.random() - 0.5) * 30;

        broadcast(room, {
          type: 'kill',
          killer: player.id,
          victim: target.id,
          points: 100
        });
      }
    }
  });

  ws.on('close', () => {
    if (!player) return;

    const room = rooms.get(player.room);
    if (!room) return;

    room.delete(player.id);

    if (room.size === 0) {
      rooms.delete(player.room);
    } else {
      broadcast(room, {
        type: 'state',
        players: getState(room)
      });
    }
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    broadcast(room, {
      type: 'state',
      players: getState(room)
    });
  }
}, 100);

server.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
