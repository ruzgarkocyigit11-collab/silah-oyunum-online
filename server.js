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

function makeId() {
  return Math.random().toString(36).substring(2, 10);
}

function cleanName(name) {
  return String(name || "Oyuncu")
    .replace(/[^\wğüşöçıİĞÜŞÖÇ -]/g, "")
    .substring(0, 16) || "Oyuncu";
}

function cleanRoom(room) {
  return String(room || "arena")
    .replace(/[^\w-]/g, "")
    .substring(0, 20) || "arena";
}

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function playersInRoom(room) {
  return Array.from(room.values()).map(p => ({
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

function broadcast(room, data, except = null) {
  for (const player of room.values()) {
    if (player.ws !== except) {
      send(player.ws, data);
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
          "Oyun HTML dosyasi bulunamadi."
        );

        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
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

wss.on("connection", ws => {
  let player = null;

  ws.on("message", raw => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "join") {
      if (player) return;

      const roomName = cleanRoom(msg.room);

      let room = rooms.get(roomName);

      if (!room) {
        room = new Map();
        rooms.set(roomName, room);
      }

      if (room.size >= 8) {
        send(ws, {
          type: "error",
          message: "Oda dolu."
        });
        return;
      }

      player = {
        id: makeId(),
        name: cleanName(msg.name),
        room: roomName,
        ws: ws,

        x: 0,
        y: 1.6,
        z: 0,

        yaw: 0,
        pitch: 0,

        hp: 100,
        weapon: 0,
        crouching: false
      };

      room.set(player.id, player);

      send(ws, {
        type: "welcome",
        id: player.id,
        room: roomName
      });

      send(ws, {
        type: "state",
        players: playersInRoom(room)
      });

      broadcast(
        room,
        {
          type: "state",
          players: playersInRoom(room)
        },
        ws
      );

      return;
    }

    if (!player) return;

    const room = rooms.get(player.room);

    if (!room) return;

    if (msg.type === "state") {
      player.x = Number(msg.x) || 0;
      player.y = Number(msg.y) || 0;
      player.z = Number(msg.z) || 0;

      player.yaw = Number(msg.yaw) || 0;
      player.pitch = Number(msg.pitch) || 0;

      player.weapon = Number(msg.weapon) || 0;
      player.crouching = !!msg.crouching;

      return;
    }

    if (msg.type === "shot") {
      broadcast(
        room,
        {
          type: "shot",
          id: player.id,
          x: Number(msg.x) || 0,
          y: Number(msg.y) || 0,
          z: Number(msg.z) || 0,
          tx: Number(msg.tx) || 0,
          ty: Number(msg.ty) || 0,
          tz: Number(msg.tz) || 0
        },
        ws
      );

      return;
    }

    if (msg.type === "hit") {
      const target = room.get(String(msg.target));

      if (!target || target === player) {
        return;
      }

      const damage = Math.max(
        1,
        Math.min(100, Number(msg.damage) || 10)
      );

      target.hp = Math.max(
        0,
        target.hp - damage
      );

      send(target.ws, {
        type: "hit",
        target: target.id,
        damage: damage
      });

      if (target.hp <= 0) {
        target.hp = 100;

        target.x =
          (Math.random() - 0.5) * 30;

        target.z =
          (Math.random() - 0.5) * 30;

        broadcast(room, {
          type: "kill",
          killer: player.id,
          victim: target.id,
          points: 100
        });
      }

      return;
    }
  });

  ws.on("close", () => {
    if (!player) return;

    const room = rooms.get(player.room);

    if (!room) return;

    room.delete(player.id);

    broadcast(room, {
      type: "state",
      players: playersInRoom(room)
    });

    if (room.size === 0) {
      rooms.delete(player.room);
    }
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    broadcast(room, {
      type: "state",
      players: playersInRoom(room)
    });
  }
}, 100);

server.listen(PORT, () => {
  console.log(
    "Multiplayer server running on port " + PORT
  );
});
       
