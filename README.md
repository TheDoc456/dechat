# DeChat

Ephemeral, latency-routed chat network with **token-based node join** (router + nodes on separate machines).

## Components
- **Router** (public): serves web UI, allocates clients to best node by latency, sticky rooms, public aggregate stats.
- **Node** (public): Socket.IO room chat, ephemeral in-memory rooms, LAN operator UI.
- **Token join**: Router mints a one-time **JOIN_TOKEN** (admin-only). Node installer uses token to securely receive a **per-node secret** (no router secret ever shared to nodes).

## Router routes
- `/` landing, `/chat` client, `/network` global stats
- `GET /nodes`
- `POST /allocate`
- `GET /public/stats`
- `POST /public/join-token` (admin: `Authorization: Bearer <ROUTER_SECRET>`)
- `POST /public/join` (JOIN_TOKEN exchange)

## Node routes
- `GET /ping`
- Socket.IO for rooms
- Operator UI (LAN): `http://<LAN-IP>:9090/`

## One-command installs (recommended)
### Router (machine A)
```bash
bash scripts/install-router.sh
```
It prints a **single node install command** that you paste on each node machine.

### Node (machine B/C/…)
Paste the printed command, e.g.
```bash
curl -fsSL https://raw.githubusercontent.com/TheDoc456/dechat/main/scripts/install-node.sh | \
ROUTER_URL='https://router.dechat.app' JOIN_TOKEN='...' NODE_PUBLIC_URL='https://node-uk1.dechat.app' bash
```

## Docker
- Router container listens on 8080 (published to `127.0.0.1:8080` by default — proxy with nginx).
- Node container listens on 8081 + operator UI 9090.


## Auto-join (no manual token)
Set `OPEN_JOIN=1` on the router to allow nodes to fetch a short-lived join token automatically from `/.well-known/dechat-join`.
Disable `OPEN_JOIN` after onboarding.
