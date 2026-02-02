// router/src/server.js
"use strict";

const express = require("express");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const path = require("path");
const os = require("os");
const NodeRegistry = require("./registry");
const registry = new NodeRegistry();
registry.resetOnlineState();
const { createProxyMiddleware } = require("http-proxy-middleware");
const { StickyMap } = require("./sticky");
const { JoinTokens } = require("./joinTokens");
const { nowMs, clamp, randId, randHex, hmacHex } = require("./utils");
const PORT = Number(process.env.PORT || 8080);
const ROUTER_PUBLIC_URL = process.env.ROUTER_PUBLIC_URL || "";
const STICKY_TTL_SEC = Number(process.env.STICKY_TTL_SEC || 86400);
const MAX_NODES_RETURNED = Number(process.env.MAX_NODES_RETURNED || 50);
const OPEN_JOIN = String(process.env.OPEN_JOIN || "0") === "1";
const OPEN_JOIN_TTL_SEC = Number(process.env.OPEN_JOIN_TTL_SEC || 900);
const OPEN_JOIN_MAX_TOKENS = Number(process.env.OPEN_JOIN_MAX_TOKENS || 50);
const fs = require("fs");
const crypto = require("crypto");
const DATA_DIR = "/data";
const SECRET_FILE = path.join(DATA_DIR, "router.secret");
let ROUTER_SECRET;

if (fs.existsSync(SECRET_FILE)) {
  ROUTER_SECRET = fs.readFileSync(SECRET_FILE, "utf8").trim();
} else {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  ROUTER_SECRET = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(SECRET_FILE, ROUTER_SECRET, { mode: 0o600 });
  console.log("[router] Generated ROUTER_SECRET");
}

if (!ROUTER_SECRET || ROUTER_SECRET.length < 32) {
  throw new Error("ROUTER_SECRET invalid");
}

const SECRET_PATH = "/data/router.secret";

const app = express();

/**
 * CORS: allow external hosted HTML dashboards/clients to call router APIs.
 * This sets Access-Control-Allow-Origin: *
 * and handles preflight OPTIONS.
 */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Middleware order matters: JSON parser must be before /register, /allocate, /public/join, etc.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json({ limit: "256kb" }));
app.use(morgan("tiny"));

app.use("/n/:nodeKey", (req, res, next) => {
  try {
    const nodeKey = req.params.nodeKey;
    const n = registry.get(nodeKey);

    if (!n || !n.wgIp) return res.status(404).send("node_not_found");

    const target = "http://" + n.wgIp + ":8081";

    return createProxyMiddleware({
      target,
      changeOrigin: true,
      ws: true,
      pathRewrite: function (pathReq) {
        return pathReq.replace("/n/" + nodeKey, "");
      },
      proxyTimeout: 30000,
    })(req, res, next);
  } catch (e) {
    console.error("[proxy] error", e);
    res.status(500).send("proxy_error");
  }
});

// State
const sticky = new StickyMap(STICKY_TTL_SEC);
const joinTokens = new JoinTokens();

setInterval(() => sticky.sweep(), 30_000).unref();
setInterval(() => joinTokens.sweep(), 30_000).unref();

// ---- Web pages (served by router) ----
app.get("/", (_req, res) =>
  res.sendFile(path.join(__dirname, "..", "web", "landing.html"))
);
app.get("/chat", (_req, res) =>
  res.sendFile(path.join(__dirname, "..", "web", "chat.html"))
);
app.get("/network", (_req, res) =>
  res.sendFile(path.join(__dirname, "..", "web", "network.html"))
);

// Health/ping
app.get("/ping", (_req, res) => res.status(200).send("pong"));

// ---- Public discovery endpoints ----

// Public router list (for network dashboard aggregating multiple routers)
app.get("/public/routers", (_req, res) => {
  // If you only run one router, just return itself.
  // You can later extend this to return a cluster list.
  const baseUrl = ROUTER_PUBLIC_URL || "";
  res.json({
    ok: true,
    routers: baseUrl ? [{ baseUrl, routerId: "router-1", lastSeenMin: 0 }] : [],
  });
});

// --- Node bootstrap join token ---
app.get("/.well-known/dechat-join", (_req, res) => {
  const ts = Date.now();
  const nonce = crypto.randomBytes(16).toString("hex");

  const sig = crypto
    .createHmac("sha256", ROUTER_SECRET)
    .update(`${ts}:${nonce}`)
    .digest("hex");

  res.json({
    joinToken: `${ts}:${nonce}:${sig}`
  });
});

app.post("/public/join", (req, res) => {
  try {
    const { joinToken, nodePublicUrl } = req.body || {};
    if (!joinToken || !nodePublicUrl) {
      return res.status(400).json({ error: "missing_fields" });
    }

    const [ts, nonce, sig] = String(joinToken).split(":");
    if (!ts || !nonce || !sig) {
      return res.status(401).json({ error: "bad_token" });
    }

    const expected = crypto
      .createHmac("sha256", ROUTER_SECRET)
      .update(`${ts}:${nonce}`)
      .digest("hex");

    if (expected !== sig) {
      return res.status(401).json({ error: "bad_or_expired_token" });
    }

    const nodeKey = "DCN-" + crypto.randomBytes(6).toString("hex").toUpperCase();
    const nodeSecret = crypto.randomBytes(32).toString("hex");

    registry.add({
      key: nodeKey,
      publicUrl: nodePublicUrl,
      nodeSecret,
      roomsActive: 0,
      usersActive: 0,
      lastSeenAt: Date.now()
    });

    res.json({ nodeKey, nodeSecret });
  } catch (e) {
    console.error("Join failed:", e);
    res.status(500).json({ error: "join_failed" });
  }
});


// Public node list for clients (what /chat uses)
app.get("/nodes", (_req, res) => {
  const nodes = registry.listPublic().slice(0, MAX_NODES_RETURNED);
  res.json({ ok: true, nodes });
});

// Node heartbeat/register using per-node secret
app.post("/register", (req, res) => {
  const { nodeKey, publicUrl, roomsActive, usersActive, ts, sig } = req.body || {};
  if (!nodeKey || !publicUrl || !ts || !sig) {
    return res.status(400).json({ error: "bad_request" });
  }

  const node = registry.get(nodeKey);
  if (!node || !node.nodeSecret) {
    return res.status(401).json({ error: "unknown_node" });
  }

  const skew = Math.abs(Date.now() - Number(ts));
  if (skew > 60_000) return res.status(401).json({ error: "ts_skew" });

  const rA = Number.isFinite(Number(roomsActive)) ? Number(roomsActive) : 0;
  const uA = Number.isFinite(Number(usersActive)) ? Number(usersActive) : 0;

  const payload = `${nodeKey}|${String(publicUrl)}|${rA}|${uA}|${ts}`;
  const expected = hmacHex(node.nodeSecret, payload);
  if (expected !== sig) return res.status(401).json({ error: "bad_sig" });

  registry.markSeen(nodeKey, {
    publicUrl: String(publicUrl),
    roomsActive: rA,
    usersActive: uA
  });

  res.json({ ok: true });
});

// ---- Allocation ----
// Chooses node by latency (client pings each node /ping), and returns a per-room token
// token = HMAC(nodeSecret, `${roomId}|${userId}|${nodeKey}`)
app.post("/allocate", (req, res) => {
  const { roomId: reqRoomId, latencies } = req.body || {};
  const nodes = registry.listInternal();
  if (nodes.length === 0) return res.status(503).json({ error: "no_nodes" });

  let roomId =
    typeof reqRoomId === "string" && reqRoomId.trim() ? reqRoomId.trim() : null;

  // Sticky mapping first
  if (roomId) {
    const mappedKey = sticky.get(roomId);
    if (mappedKey) {
      const n = registry.get(mappedKey);
      if (n && n.nodeSecret) {
        const userId = randId("U-", 8);
        const token = hmacHex(n.nodeSecret, `${roomId}|${userId}|${n.key}`);
        return res.json({
          ok: true,
          sticky: true,
          roomId,
          userId,
          token,
          node: { key: n.key, baseUrl: n.publicUrl },
          lastSeenAt: Date.now()
        });
      }
    }
  }

  // Score by client latency measurement
  const score = (node) => {
    const ms = latencies && typeof latencies === "object" ? latencies[node.key] : null;
    const v = Number(ms);
    if (!Number.isFinite(v) || v <= 0) return 999999;
    return clamp(Math.round(v), 1, 120000);
  };

  const chosen = nodes
    .map((n) => ({ n, s: score(n) }))
    .sort((a, b) => a.s - b.s)[0].n;

  if (!roomId) roomId = randId("R-", 10);

  // Always map room -> node for consistency
  sticky.set(roomId, chosen.key);

  const userId = randId("U-", 8);
  const token = hmacHex(chosen.nodeSecret, `${roomId}|${userId}|${chosen.key}`);

  res.json({
    ok: true,
    sticky: true,
    roomId,
    userId,
    token,
    node: { key: chosen.key, baseUrl: chosen.publicUrl },
  });
});

// ---- Public stats (aggregate only) ----
app.get("/public/stats", (_req,res)=>{
  const up = process.uptime();
  const la = os.loadavg();
  const mem = process.memoryUsage();
  const nodes = registry.listPublic();

  const stickyInfo = sticky.stats();
  let roomsTotal = 0;
  let usersTotal = 0;

  for(const n of nodes){
    roomsTotal += Number(n.roomsActive || 0);
    usersTotal += Number(n.usersActive || 0);
  }

  res.json({
    ok:true,
    at: nowMs(),
    router: {
      uptimeSec: Math.floor(up),
      loadavg: la,
      rssMb: Math.round(mem.rss/1024/1024),
      heapUsedMb: Math.round(mem.heapUsed/1024/1024)
    },
    network: {
      routersOnline: 1,
      nodesOnline: registry.countOnline(),
      roomsTotal,
      usersTotal,
      stickyMappedRooms: stickyInfo.stickyMappedRooms
      
    }
  });
});

app.listen(PORT, () => console.log(`Router listening on :${PORT}`));
