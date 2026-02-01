#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/install-common.sh"

REPO_URL="${REPO_URL:-https://github.com/TheDoc456/dechat.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/dechat}"
ROUTER_PUBLIC_URL="${ROUTER_PUBLIC_URL:-https://router.dechat.app}"
STICKY_TTL_SEC="${STICKY_TTL_SEC:-86400}"
MAX_NODES_RETURNED="${MAX_NODES_RETURNED:-50}"
JOIN_TTL_SEC="${JOIN_TTL_SEC:-900}"

ensure_packages
install_docker
repo_sync "$REPO_URL" "$INSTALL_DIR"

# router secret: keep existing if present, else generate
ENV_FILE="$INSTALL_DIR/router/.env"
mkdir -p "$INSTALL_DIR/router"

ROUTER_SECRET=""
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE" || true
  ROUTER_SECRET="${ROUTER_SECRET:-}"
fi
if [[ -z "${ROUTER_SECRET:-}" ]]; then
  ROUTER_SECRET="$(rand_hex)"
  log "generated ROUTER_SECRET"
fi

cat > "$ENV_FILE" <<EOF
ROUTER_PUBLIC_URL=${ROUTER_PUBLIC_URL}
ROUTER_SECRET=${ROUTER_SECRET}
STICKY_TTL_SEC=${STICKY_TTL_SEC}
MAX_NODES_RETURNED=${MAX_NODES_RETURNED}
OPEN_JOIN=1
OPEN_JOIN_TTL_SEC=${JOIN_TTL_SEC}
OPEN_JOIN_MAX_TOKENS=50
EOF

log "starting router..."
cd "$INSTALL_DIR/docker"
compose_up router.compose.yml

# mint a join token via local router endpoint (admin bearer)
log "minting JOIN_TOKEN..."
JOIN_JSON="$(curl -fsSL -X POST \
  -H "content-type: application/json" \
  -H "authorization: Bearer ${ROUTER_SECRET}" \
  -d "{\"ttlSec\": ${JOIN_TTL_SEC}}" \
  "http://127.0.0.1:8080/public/join-token" )"

JOIN_TOKEN="$(echo "$JOIN_JSON" | jq -r '.joinToken // empty')"
if [[ -z "$JOIN_TOKEN" ]]; then
  echo ""
  echo "ERROR: could not mint join token. Raw:"
  echo "$JOIN_JSON"
  exit 1
fi

echo ""
echo "==================== DeChat Router Installed ===================="
echo "Router URL:        ${ROUTER_PUBLIC_URL}"
echo "ROUTER_SECRET:     (stored in ${ENV_FILE})"
echo ""
echo "Paste this on a NODE machine to install + join (no router secret shared):"
echo ""
echo "curl -fsSL https://raw.githubusercontent.com/YOURNAME/dechat/main/scripts/install-node.sh | \\"
echo "ROUTER_URL='${ROUTER_PUBLIC_URL}' NODE_PUBLIC_URL='https://node-1.dechat.app' bash"
echo ""
echo "================================================================="
echo ""
