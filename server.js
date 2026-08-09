const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 8;

const GAME_FILE = path.join(
  __dirname,
  "3D_Silah_Savasi_Seviye_250XP_Silahlar_Boss.html"
);

const rooms = new Map();

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room, data, except = null) {
  for (const player of room.players.values()) {
    if (player.ws !== except) {
      send(player.ws, data);
    }
  }
}

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    x: player.x,
    y: player.y,
    z: player.z,
    yaw: player.yaw,
    pitch: player.pitch,
    hp: player.hp
  };
}

function getRoomPlayers(room) {
  return Array.from(room.players.values()).map(publicPlayer);
}

function createRoom(name) {
  const room = {
    name,
    players: new Map(),
    zombies: new Map(),
    wave: 1,
    nextZombieId: 1,
    lastSpawn: 0
  };

  rooms.set(name, room);
  return room;
}

function spawnZombie(room, isBoss = false) {
  const id = "zombie_" + room.nextZombieId++;

  const angle = Math.random() * Math.PI * 2;
  const distance = 20 + Math.random() * 20;

  const zombie = {
    id,
    type: isBoss ? "boss" : "zombie",
    x: Math.cos(angle) * distance,
    y: 0,
    z: Math.sin(angle) * distance,

    hp: isBoss
      ? 1000 + room.wave * 250
      : 120 + room.wave * 30,

    maxHp: isBoss
      ? 1000 + room.wave * 250
      : 120 + room.wave * 30,

    speed: isBoss
      ? 1.2 + room.wave * 0.03
      : 2.2 + room.wave * 0.08,

    damage: isBoss
      ? 25 + room.wave * 2
      : 10 + room.wave,

    attackCooldown: 0
  };

  room.zombies.set(id, zombie);

  return zombie;
}

function spawnWave(room) {
  const amount = Math.min(50, 5 + room.wave * 3);

  for (let i = 0; i < amount; i++) {
    spawnZombie(room, false);
  }

  if (room.wave % 5 === 0) {
    spawnZombie(room, true);
  }

  broadcast(room, {
    type: "wave",
    wave: room.wave,
    zombieCount: room.zombies.size
  });
}

function nearestPlayer(room, zombie) {
  let best = null;
  let bestDistance = Infinity;

  for (const player of room.players.values()) {
    const dx = player.x - zombie.x;
    const dz = player.z - zombie.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    if (distance < bestDistance) {
      bestDistance = distance;
      best = player;
    }
  }

  return best;
}

function updateZombies(room, delta) {
  for (const zombie of room.zombies.values()) {
    const target = nearestPlayer(room, zombie);

    if (!target) continue;

    const dx = target.x - zombie.x;
    const dz = target.z - zombie.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    if (distance > 1.8) {
      zombie.x += (dx / Math.max(distance, 0.001)) *
        zombie.speed * delta;

      zombie.z += (dz / Math.max(distance, 0.001)) *
        zombie.speed * delta;
    } else {
      zombie.attackCooldown -= delta;

      if (zombie.attackCooldown <= 0) {
        zombie.attackCooldown = 1;

        target.hp = Math.max(
          0,
          target.hp - zombie.damage
        );

        send(target.ws, {
          type: "zombieAttack",
          zombieId: zombie.id,
          damage: zombie.damage,
          hp: target.hp
        });

        if (target.hp <= 0) {
          target.hp = 100;

          target.x = 0;
          target.y = 1.6;
          target.z = 0;

          send(target.ws, {
            type: "respawn",
            hp: 100,
            x: 0,
            y: 1.6,
            z: 0
          });
        }
      }
    }
  }
}

function broadcastZombieState(room) {
  broadcast(room, {
    type: "zombies",
    wave: room.wave,
    zombies: Array.from(room.zombies.values()).map(z => ({
      id: z.id,
      type: z.type,
      x: z.x,
      y: z.y,
      z: z.z,
      hp: z.hp,
      maxHp: z.maxHp
    }))
  });
}

const server = http.createServer((req, res) => {
  const cleanUrl = req.url.split("?")[0];

  if (
    cleanUrl === "/" ||
    cleanUrl === "/index.html"
  ) {
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
        "Content-Type": "text/html; charset=utf-8"
      });

      res.end(data);
    });

    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8"
  });

  res.end(
    "Silah Oyunu Multiplayer Beta Server - ONLINE"
  );
});

const wss = new WebSocket.Server({
  server
});

wss.on("connection", ws => {
  let player = null;

  ws.on("message", raw => {
    let message;

    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.type === "join") {
      const roomName =
        String(message.room || "arena")
          .replace(/[^a-zA-Z0-9_-]/g, "")
          .slice(0, 20) || "arena";

      let room = rooms.get(roomName);

      if (!room) {
        room = createRoom(roomName);
      }

      if (room.players.size >= MAX_PLAYERS) {
        send(ws, {
          type: "error",
          message: "Oda dolu."
        });

        return;
      }

      player = {
        id: Math.random()
          .toString(36)
          .slice(2, 10),

        name: String(
          message.name || "Oyuncu"
        ).slice(0, 16),

        ws,
        room: roomName,

        x: 0,
        y: 1.6,
        z: 0,

        yaw: 0,
        pitch: 0,

        hp: 100
      };

      room.players.set(player.id, player);

      send(ws, {
        type: "welcome",
        id: player.id,
        room: roomName,
        maxPlayers: MAX_PLAYERS
      });

      send(ws, {
        type: "players",
        players: getRoomPlayers(room)
      });

      send(ws, {
        type: "zombies",
        wave: room.wave,
        zombies: Array.from(
          room.zombies.values()
        )
      });

      broadcast(
        room,
        {
          type: "playerJoined",
          player: publicPlayer(player)
        },
        ws
      );

      if (room.zombies.size === 0) {
        spawnWave(room);
      }

      return;
    }

    if (!player) return;

    const room = rooms.get(player.room);

    if (!room) return;

    /*
     * Oyuncular birbirine zarar veremez.
     * Burada sadece oyuncunun konumu güncelleniyor.
     */
    if (message.type === "state") {
      player.x = Number(message.x) || 0;
      player.y = Number(message.y) || 0;
      player.z = Number(message.z) || 0;

      player.yaw = Number(message.yaw) || 0;
      player.pitch = Number(message.pitch) || 0;

      broadcast(
        room,
        {
          type: "playerState",
          player: publicPlayer(player)
        },
        ws
      );

      return;
    }

    /*
     * Ateş etme.
     * Sadece zombie hedefleri kabul edilir.
     */
    if (message.type === "shootZombie") {
      const zombie = room.zombies.get(
        String(message.target)
      );

      if (!zombie) return;

      const damage = Math.max(
        1,
        Math.min(
          500,
          Number(message.damage) || 25
        )
      );

      zombie.hp -= damage;

      broadcast(room, {
        type: "zombieHit",
        zombieId: zombie.id,
        hp: Math.max(0, zombie.hp),
        maxHp: zombie.maxHp,
        attacker: player.id
      });

      if (zombie.hp <= 0) {
        room.zombies.delete(zombie.id);

        broadcast(room, {
          type: "zombieKilled",
          zombieId: zombie.id,
          killer: player.id,
          xp: zombie.type === "boss" ? 500 : 50
        });

        if (room.zombies.size === 0) {
          room.wave++;

          setTimeout(() => {
            if (room.players.size > 0) {
              spawnWave(room);
            }
          }, 2500);
        }
      }

      return;
    }
  });

  ws.on("close", () => {
    if (!player) return;

    const room = rooms.get(player.room);

    if (!room) return;

    room.players.delete(player.id);

    broadcast(room, {
      type: "playerLeft",
      id: player.id
    });

    if (room.players.size === 0) {
      rooms.delete(player.room);
    }
  });
});

/*
 * Server oyun döngüsü.
 * Zombiler burada hareket eder.
 */
let lastTime = Date.now();

setInterval(() => {
  const now = Date.now();

  const delta = Math.min(
    0.1,
    (now - lastTime) / 1000
  );

  lastTime = now;

  for (const room of rooms.values()) {
    updateZombies(room, delta);
    broadcastZombieState(room);
  }
}, 100);

/*
 * Server başlat.
 */
server.listen(PORT, "0.0.0.0", () => {
  console.log(
    "Silah Oyunu Multiplayer Beta Server ONLINE"
  );

  console.log(
    "Port: " + PORT
  );
});
