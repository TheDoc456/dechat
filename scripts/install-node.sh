#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/install-common.sh"

REPO_URL="${REPO_URL:-https://github.com/TheDoc456/dechat.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/dechat}"

ROUTER_URL="${ROUTER_URL:-}"
JOIN_TOKEN="${JOIN_TOKEN:-}"
NODE_PUBLIC_URL="${NODE_PUBLIC_URL:-}"

NODE_PORT="${NODE_PORT:-8081}"
OPERATOR_PORT="${OPERATOR_PORT:-9090}"
ROOM_IDLE_TTL_SEC="${ROOM_IDLE_TTL_SEC:-600}"
ROOM_SWEEP_INTERVAL_SEC="${ROOM_SWEEP_INTERVAL_SEC:-20}"
MAX_USERS_PER_ROOM="${MAX_USERS_PER_ROOM:-10}"
MAX_ROOMS="${MAX_ROOMS:-500}"

if [[ -z "${ROUTER_URL}" ]]; then
  echo ""
  echo "ERROR: ROUTER_URL is required."
  echo "Example:"
  echo "  ROUTER_URL='https://router.dechat.app' ./scripts/install-node.sh"
  echo ""
  exit 1
fi

# Auto-fetch JOIN_TOKEN if not provided (requires OPEN_JOIN=1 on router)
if [[ -z "${JOIN_TOKEN:-}" ]]; then
  log "fetching auto join token..."
  JOIN_TOKEN="$(curl -fsSL "${ROUTER_URL%/}/.well-known/dechat-join" | jq -r '.joinToken // empty' || true)"
  if [[ -z "$JOIN_TOKEN" ]]; then
    echo ""
    echo "ERROR: Could not fetch join token."
    echo "Make sure OPEN_JOIN=1 on the router (.env) and restart router."
    echo ""
    exit 1
  fi
fi

ensure_packages
install_docker
repo_sync "$REPO_URL" "$INSTALL_DIR"

# best-effort node public url
if [[ -z "${NODE_PUBLIC_URL}" ]]; then
  PUB_IP="$(detect_public_ip)"
  if [[ -n "$PUB_IP" ]]; then
    NODE_PUBLIC_URL="http://${PUB_IP}:${NODE_PORT}"
  else
    NODE_PUBLIC_URL="http://127.0.0.1:${NODE_PORT}"
  fi
fi

log "joining router with token (exchanging for per-node secret)..."
JOIN_RES="$(curl -fsSL -X POST \
  -H "content-type: application/json" \
  -d "{\"joinToken\": \"${JOIN_TOKEN}\", \"nodePublicUrl\": \"${NODE_PUBLIC_URL}\"}" \
  "${ROUTER_URL%/}/public/join" )"

NODE_KEY="$(echo "$JOIN_RES" | jq -r '.nodeKey // empty')"
NODE_SECRET="$(echo "$JOIN_RES" | jq -r '.nodeSecret // empty')"

if [[ -z "$NODE_KEY" || -z "$NODE_SECRET" ]]; then
  echo ""
  echo "ERROR: join failed. Response:"
  echo "$JOIN_RES"
  exit 1
fi

ENV_FILE="$INSTALL_DIR/node/.env"
mkdir -p "$INSTALL_DIR/node"
cat > "$ENV_FILE" <<EOF
NODE_PUBLIC_URL=${NODE_PUBLIC_URL}
ROUTER_URL=${ROUTER_URL}
NODE_KEY=${NODE_KEY}
NODE_SECRET=${NODE_SECRET}

NODE_PORT=${NODE_PORT}
OPERATOR_PORT=${OPERATOR_PORT}

ROOM_IDLE_TTL_SEC=${ROOM_IDLE_TTL_SEC}
ROOM_SWEEP_INTERVAL_SEC=${ROOM_SWEEP_INTERVAL_SEC}
MAX_USERS_PER_ROOM=${MAX_USERS_PER_ROOM}
MAX_ROOMS=${MAX_ROOMS}
EOF

log "starting node..."
cd "$INSTALL_DIR/docker"
compose_up node.compose.yml

echo ""
echo "===================== DeChat Node Installed ====================="
echo "NODE_PUBLIC_URL:  ${NODE_PUBLIC_URL}"
echo "NODE_KEY:         ${NODE_KEY}"
echo "Operator UI:      http://<LAN-IP>:${OPERATOR_PORT}"
echo "================================================================"
echo ""
