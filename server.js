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

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room, data, except = null) {
  for (const player of room.values()) {
    if (player.ws !== except) {
      send(player.ws, data);
    }
  }
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
          'Oyun dosyasi bulunamadi.'
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

  res.end(
    '3D Silah Savasi Multiplayer Beta server is running.'
  );
});

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

    /*
     * ODAYA KATIL
     */
    if (m.type === 'join') {

      if (player) return;

      const roomName = cleanRoom(m.room);

      let room = rooms.get(roomName);

      if (!room) {
        room = new Map();
        rooms.set(roomName, room);
      }

      if (room.size >= MAX_PLAYERS_PER_ROOM) {

        send(ws, {
          type: 'error',
          message: 'Oda dolu (maksimum 8 oyuncu).'
        });

        return;
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

        crouching: false
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
        },
        ws
      );

      return;
    }

    if (!player) return;

    const room = rooms.get(player.room);

    if (!room) return;

    /*
     * OYUNCU HAREKETİ
     */
    if (m.type === 'state') {

      player.x = Number(m.x) || 0;

      player.y = Math.max(
        0,
        Number(m.y) || 0
      );

      player.z = Number(m.z) || 0;

      player.yaw =
        Number(m.yaw) || 0;

      player.pitch =
        Number(m.pitch) || 0;

      player.weapon =
        Math.max(
          0,
          Math.min(
            3,
            Number(m.weapon) || 0
          )
        );

      player.crouching =
        !!m.crouching;

      return;
    }

    /*
     * ATEŞ ETME
     *
     * ÖNEMLİ:
     * Oyuncular birbirine zarar veremez.
     *
     * Bu mesaj sadece diğer oyunculara
     * ateş efektini göstermek içindir.
     */
    if (m.type === 'shot') {

      const shot = {
        type: 'shot',

        id: player.id,

        x: Number(m.x) || 0,
        y: Number(m.y) || 0,
        z: Number(m.z) || 0,

        tx: Number(m.tx) || 0,
        ty: Number(m.ty) || 0,
        tz: Number(m.tz) || 0
      };

      broadcast(
        room,
        shot,
        ws
      );

      return;
    }

    /*
     * ESKİ PVP HIT SİSTEMİNİ KAPATTIK.
     *
     * Oyuncular artık birbirini öldüremez.
     */
    if (m.type === 'hit') {
      return;
    }

    /*
     * ZOMBİYE HASAR
     *
     * HTML tarafı zombieHit gönderirse
     * burada işlenebilir.
     */
    if (m.type === 'zombieHit') {

      broadcast(
        room,
        {
          type: 'zombieHit',
          zombieId: m.zombieId,
          damage: Math.max(
            1,
            Math.min(
              150,
              Number(m.damage) || 10
            )
          ),
          attacker: player.id
        }
      );

      return;
    }

  });

  /*
   * OYUNCU ÇIKTI
   */
  ws.on('close', () => {

    if (!player) return;

    const room =
      rooms.get(player.room);

    if (!room) return;

    room.delete(player.id);

    broadcast(
      room,
      {
        type: 'state',
        players: roomPlayers(room)
      }
    );

    if (room.size === 0) {
      rooms.delete(player.room);
    }
  });

});

/*
 * SUNUCU DÜZENLİ OLARAK OYUNCU
 * DURUMLARINI PAYLAŞIR.
 */
setInterval(() => {

  for (const room of rooms.values()) {

    broadcast(
      room,
      {
        type: 'state',
        players: roomPlayers(room)
      }
    );

  }

}, TICK_MS);

/*
 * SERVER BAŞLAT
 */
server.listen(
  PORT,
  '0.0.0.0',
  () => {

    console.log(
      `Multiplayer server listening on port ${PORT}`
    );

  }
);
