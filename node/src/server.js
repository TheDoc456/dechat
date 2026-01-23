const express = require("express");
const helmet = require("helmet");
const morgan = require("morgan");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const { Rooms } = require("./rooms");
const { nodeStats } = require("./stats");
const { nowMs, hmacHex } = require("./utils");

const NODE_PUBLIC_URL = process.env.NODE_PUBLIC_URL || "";
const ROUTER_URL = process.env.ROUTER_URL || "";
const NODE_KEY = process.env.NODE_KEY || "";
const NODE_SECRET = process.env.NODE_SECRET || "";

const NODE_PORT = Number(process.env.NODE_PORT || 8081);
const OPERATOR_PORT = Number(process.env.OPERATOR_PORT || 9090);

const ROOM_IDLE_TTL_SEC = Number(process.env.ROOM_IDLE_TTL_SEC || 600);
const ROOM_SWEEP_INTERVAL_SEC = Number(process.env.ROOM_SWEEP_INTERVAL_SEC || 20);
const MAX_USERS_PER_ROOM = Number(process.env.MAX_USERS_PER_ROOM || 10);
const MAX_ROOMS = Number(process.env.MAX_ROOMS || 500);

if(!NODE_PUBLIC_URL) { console.error("NODE_PUBLIC_URL required"); process.exit(1); }
if(!ROUTER_URL) { console.error("ROUTER_URL required"); process.exit(1); }
if(!NODE_KEY || !NODE_SECRET) { console.error("NODE_KEY/NODE_SECRET required (use join token installer)"); process.exit(1); }

const rooms = new Rooms({
  idleTtlMs: Math.max(60, ROOM_IDLE_TTL_SEC|0) * 1000,
  maxUsersPerRoom: Math.max(2, MAX_USERS_PER_ROOM|0),
  maxRooms: Math.max(10, MAX_ROOMS|0)
});
setInterval(()=>rooms.sweep(), Math.max(5, ROOM_SWEEP_INTERVAL_SEC|0)*1000).unref();

// Heartbeat/register to router using per-node secret
async function register(){
  try{
    const ts = nowMs();
    const payload = `${NODE_KEY}|${NODE_PUBLIC_URL}|${ts}`;
    const sig = hmacHex(NODE_SECRET, payload);
    await fetch(`${ROUTER_URL.replace(/\/+$/,'')}/register`, {
      method:"POST",
      headers:{ "content-type":"application/json" },
      body: JSON.stringify({ nodeKey:NODE_KEY, publicUrl:NODE_PUBLIC_URL, ts, sig })
    });
  }catch(e){}
}
setInterval(register, 20_000).unref();
register();

// Public node server
const app = express();
app.use(helmet({ contentSecurityPolicy:false }));
app.use(express.json({ limit:"128kb" }));
app.use(morgan("tiny"));

app.get("/ping", (_req,res)=> res.status(200).send("pong"));
app.get("/public/stats", (_req,res)=> res.json(nodeStats({ nodeKey:NODE_KEY, publicUrl:NODE_PUBLIC_URL, rooms })));

const server = http.createServer(app);

const io = new Server(server, { cors: { origin:"*", methods:["GET","POST"] } });

io.use((socket, next)=>{
  const auth = socket.handshake.auth || {};
  const roomId = String(auth.roomId || "");
  const token = String(auth.token || "");
  const userId = String((socket.handshake.query && socket.handshake.query.userId) || "");

  if(!roomId || !token || !userId) return next(new Error("unauthorized"));

  const expected = hmacHex(NODE_SECRET, `${roomId}|${userId}|${NODE_KEY}`);
  if(expected !== token) return next(new Error("unauthorized"));

  socket.data.roomId = roomId;
  socket.data.userId = userId;
  next();
});

io.on("connection", (socket)=>{
  const roomId = socket.data.roomId;
  const userId = socket.data.userId;

  const j = rooms.join(roomId, userId);
  if(!j.ok){
    socket.emit("error_msg", { error:j.error });
    socket.disconnect(true);
    return;
  }

  socket.join(roomId);
  io.to(roomId).emit("system", { text:`${userId} joined` });
  io.to(roomId).emit("room_info", { userCount: j.userCount });

  socket.on("msg", (m)=>{
    if(!m || typeof m.text !== "string") return;
    rooms.touch(roomId);
    io.to(roomId).emit("msg", { userId, text: m.text });
  });

  socket.on("disconnect", ()=>{
    rooms.leave(roomId, userId);
    io.to(roomId).emit("system", { text:`${userId} left` });
  });
});

server.listen(NODE_PORT, ()=> console.log(`Node public listening :${NODE_PORT}`));

// Operator UI (LAN)
const op = express();
op.get("/", (_req,res)=> res.sendFile(path.join(__dirname, "..", "web", "operator.html")));
op.get("/stats", (_req,res)=> res.json(nodeStats({ nodeKey:NODE_KEY, publicUrl:NODE_PUBLIC_URL, rooms })));
op.listen(OPERATOR_PORT, ()=> console.log(`Operator UI :${OPERATOR_PORT}`));
