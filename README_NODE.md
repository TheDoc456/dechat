# DeChat Node (Worker) — Installation & Operations Guide

This README is **Node-only** (the worker that hosts rooms + Socket.IO).  
It assumes you already have (or will later deploy) a DeChat Router at `https://router.dechat.app`.

---

## What the Node does

A DeChat **Node** is a stateless room worker:

- Serves HTTP health endpoints (e.g. `/ping`)
- Hosts Socket.IO for chat sessions (WebSocket + long-poll fallback)
- Joins a Router to receive a `nodeKey` + `nodeSecret`
- Sends heartbeats (`/register`) so the Router can allocate rooms to it
- Stores its credentials locally so it can reboot and re-register automatically

**Ports**
- **8081**: HTTP (health + any REST endpoints)
- **9090**: Socket.IO / WebSocket (if you expose it separately; many setups proxy both to the same origin)

**Persistence**
- Node stores credentials in `/data/node-credentials.env`  
  (so you MUST mount a persistent volume to `/data`).

---

## Requirements

### Supported OS
- Debian / Raspberry Pi OS / Ubuntu (ARM64 or AMD64)
- Works well on Raspberry Pi / RockPi

### Packages
- `git`
- `docker`
- `docker-compose` (optional; Docker alone is enough)

---

## 1) One-command install (clone + build + run)

Run this on the **node machine**:

```bash
bash -lc 'set -euo pipefail
cd ~
sudo apt-get update -y
sudo apt-get install -y git docker.io docker-compose
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER" || true

rm -rf ~/dechat
git clone https://github.com/TheDoc456/dechat.git ~/dechat

cd ~/dechat/node

# Create a persistent volume for /data (credentials live here)
sudo docker volume create dechat-node-data >/dev/null

# Replace any existing container
sudo docker rm -f dechat-node 2>/dev/null || true

# Build and run
sudo docker build --no-cache -t dechat-node .
sudo docker run -d --name dechat-node --restart unless-stopped \
  -p 8081:8081 -p 9090:9090 \
  -v dechat-node-data:/data \
  -e ROUTER_URL=https://router.dechat.app \
  -e NODE_PUBLIC_URL=https://nodes.dechat.app \
  dechat-node

# Follow logs
sudo docker logs -f --tail 200 dechat-node'
```

### After you run it
- The node will attempt **auto-join** to the router if no credentials exist.
- It will write credentials into `/data/node-credentials.env`.
- It will begin heartbeating (`/register`) periodically.

---

## 2) Verify the node locally

On the node machine:

```bash
curl -i http://127.0.0.1:8081/ping
curl -i "http://127.0.0.1:8081/socket.io/?EIO=4&transport=polling" | head -n 20
```

Expected:
- `/ping` returns **200** and body `pong`
- Socket.IO polling returns **200** with a payload like:
  `0{"sid":"...","upgrades":["websocket"],...}`

---

## 3) Expose the node publicly (Cloudflare Tunnel)

If you see:
- `https://nodes.dechat.app/ping` works
- but `https://nodes.dechat.app/socket.io/...` returned **404**

…then your tunnel (or reverse proxy) was forwarding `/ping` but not `/socket.io`.

### Cloudflare Tunnel with ingress config

When you can manage the Cloudflare Tunnel host mapping, configure the hostname to point to the node’s local HTTP service.

**Example `/etc/cloudflared/config.yml`:**

```yaml
tunnel: <YOUR_TUNNEL_UUID>
credentials-file: /etc/cloudflared/<YOUR_TUNNEL_UUID>.json

ingress:
  - hostname: nodes.dechat.app
    service: http://127.0.0.1:8081
  - service: http_status:404
```

Restart:

```bash
sudo systemctl restart cloudflared
sudo journalctl -u cloudflared -n 80 --no-pager
```

Verify from anywhere:

```bash
curl -i https://nodes.dechat.app/ping | head -n 20
curl -i "https://nodes.dechat.app/socket.io/?EIO=4&transport=polling" | head -n 30
```

Expected:
- `/ping` => **200 pong**
- `/socket.io/?EIO=4&transport=polling` => **200** (NOT 404)

> If `/socket.io` is 404 publicly but works locally, the tunnel/proxy is misrouted (wrong service target or wrong hostname route).

---

## 4) Router-side checks (does the router see this node?)

From anywhere:

```bash
curl -sS https://router.dechat.app/nodes
```

You should see your node listed with:
- `publicUrl`: `https://nodes.dechat.app`
- `online`: `true` (after a heartbeat)

To force an allocation test:

```bash
curl -sS https://router.dechat.app/allocate \
  -H "content-type: application/json" \
  -d '{"roomId":"testroom","latencies":{"https://nodes.dechat.app":25}}'
```

Expected:
- `ok: true`
- `node.baseUrl: https://nodes.dechat.app`
- a `token` returned

---

## Logs & common commands

### Tail node logs
```bash
sudo docker logs -f --tail 200 dechat-node
```

### Restart node
```bash
sudo docker restart dechat-node
```

### See container env
```bash
sudo docker exec -it dechat-node sh -lc 'env | sort'
```

### Check credentials persisted
```bash
sudo docker exec -it dechat-node sh -lc 'ls -la /data && echo && sed -n "1,200p" /data/node-credentials.env || true'
```

### Remove and rebuild
```bash
cd ~/dechat/node
sudo docker rm -f dechat-node 2>/dev/null || true
sudo docker build --no-cache -t dechat-node .
sudo docker run -d --name dechat-node --restart unless-stopped \
  -p 8081:8081 -p 9090:9090 \
  -v dechat-node-data:/data \
  -e ROUTER_URL=https://router.dechat.app \
  -e NODE_PUBLIC_URL=https://nodes.dechat.app \
  dechat-node
```

---

## Troubleshooting

### A) Node logs: “can't create /data/node-credentials.env: nonexistent directory”
You forgot to mount `/data` (or the volume wasn’t created).

Fix:
- Ensure `-v dechat-node-data:/data` is present in `docker run`.

---

### B) Browser stuck on “Connecting to node”
Common root causes:
- WebSocket can’t connect
- `/socket.io` is returning 404 publicly
- Tunnel/proxy points to the wrong service

Fix checklist:
1) Local node works:
   - `curl http://127.0.0.1:8081/ping` => 200
   - `curl "http://127.0.0.1:8081/socket.io/?EIO=4&transport=polling"` => 200
2) Public node works:
   - `curl https://nodes.dechat.app/ping` => 200
   - `curl "https://nodes.dechat.app/socket.io/?EIO=4&transport=polling"` => 200 (**must not be 404**)
3) Router allocation returns your node:
   - `/allocate` returns `node.baseUrl: https://nodes.dechat.app`

If **public `/socket.io` is 404**, fix your Cloudflare Tunnel ingress/service mapping.

---

### C) “Transport unknown” when probing Socket.IO
That happens when hitting Socket.IO without the expected query params.

Use:
```bash
curl -i "https://nodes.dechat.app/socket.io/?EIO=4&transport=polling" | head -n 30
```

Raw `curl` “Upgrade: websocket” tests often fail with Socket.IO because it expects a `sid` from the polling handshake first.

---

### D) Router shows duplicates / many offline nodes
Nodes joined multiple times (new nodeKey each time) but only some are heartbeating.

Fix:
- Ensure node credentials persist in `/data/node-credentials.env`.
- Reboots should re-register using the same nodeKey/nodeSecret.

---

## Configuration reference

### Environment variables
- `ROUTER_URL` (required)
  - Example: `https://router.dechat.app`
- `NODE_PUBLIC_URL` (required)
  - Example: `https://nodes.dechat.app`

### Data paths
- `/data/node-credentials.env` — persistent credentials

---

## Quick “health snapshot”

Run this on the node host:

```bash
echo "Local:"
curl -sS -i http://127.0.0.1:8081/ping | head -n 8
curl -sS -i "http://127.0.0.1:8081/socket.io/?EIO=4&transport=polling" | head -n 12

echo
echo "Public:"
curl -sS -i https://nodes.dechat.app/ping | head -n 12
curl -sS -i "https://nodes.dechat.app/socket.io/?EIO=4&transport=polling" | head -n 18
```

If the **Public Socket.IO** request is not 200, fix the tunnel/proxy first — room allocation and chat can’t work without it.
