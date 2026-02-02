#!/bin/sh
set -e

CREDS_FILE="/data/node-credentials.env"

echo "[node] Entrypoint starting..."
echo "[node] ROUTER_URL=$ROUTER_URL"
echo "[node] NODE_PUBLIC_URL=$NODE_PUBLIC_URL"

# --------------------------------------------------
# Validate required static vars
# --------------------------------------------------
if [ -z "$ROUTER_URL" ]; then
  echo "[node] ROUTER_URL is required"
  exit 1
fi

if [ -z "$NODE_PUBLIC_URL" ]; then
  echo "[node] NODE_PUBLIC_URL is required"
  exit 1
fi

# --------------------------------------------------
# Load persisted credentials FIRST
# --------------------------------------------------
if [ -f "$CREDS_FILE" ]; then
  echo "[node] Loading persisted credentials"
  while IFS='=' read -r k v; do
    [ -z "$k" ] && continue
    export "$k=$v"
  done < "$CREDS_FILE"
fi

# --------------------------------------------------
# Join router if credentials missing
# --------------------------------------------------
if [ -z "$NODE_KEY" ] || [ -z "$NODE_SECRET" ]; then
  echo "[node] No credentials found, joining router..."

  JOIN_JSON=$(curl -fsS "$ROUTER_URL/.well-known/dechat-join")
  JOIN_TOKEN=$(echo "$JOIN_JSON" | jq -r '.joinToken')

  if [ -z "$JOIN_TOKEN" ] || [ "$JOIN_TOKEN" = "null" ]; then
    echo "[node] Failed to fetch join token"
    exit 1
  fi

  RESP=$(curl -fsS -X POST "$ROUTER_URL/public/join" \
    -H "content-type: application/json" \
    -d "{\"joinToken\":\"$JOIN_TOKEN\",\"nodePublicUrl\":\"$NODE_PUBLIC_URL\"}")

  NODE_KEY=$(echo "$RESP" | jq -r '.nodeKey')
  NODE_SECRET=$(echo "$RESP" | jq -r '.nodeSecret')
  
  export NODE_KEY NODE_SECRET

# and also write them (you already do)
cat > "$CREDS_FILE" <<EOF
NODE_KEY=$NODE_KEY
NODE_SECRET=$NODE_SECRET
EOF

  if [ -z "$NODE_KEY" ] || [ "$NODE_KEY" = "null" ]; then
    echo "[node] Join failed"
    echo "$RESP"
    exit 1
  fi

  mkdir -p /data
  cat > "$CREDS_FILE" <<EOF
NODE_KEY=$NODE_KEY
NODE_SECRET=$NODE_SECRET
EOF

  echo "[node] Joined router as $NODE_KEY"
fi

# --------------------------------------------------
# Final sanity check (NOW it’s valid)
# --------------------------------------------------
if [ -z "$NODE_KEY" ] || [ -z "$NODE_SECRET" ]; then
  echo "[node] FATAL: credentials still missing after join"
  exit 1
fi

echo "[node] Credentials OK: $NODE_KEY"

# --------------------------------------------------
# Start node
# --------------------------------------------------
set -a
. "$CREDS_FILE"
set +a
exec node src/server.js
