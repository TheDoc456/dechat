# DeChat

Monorepo containing:
- `router/` (central router)
- `node/` (chat node)

## Build/Run Router
cd router
docker build -t dechat-router .
docker run -d --name dechat-router --restart unless-stopped -p 8080:8080 -v dechat-router-data:/data dechat-router

## Build/Run Node
cd node
docker build -t dechat-node .
docker run -d --name dechat-node --restart unless-stopped \
  -e ROUTER_URL=https://router.dechat.app \
  -e NODE_PUBLIC_URL=http://node-1.dechat.app:8081 \
  -v dechat-node-data:/data \
  -p 8081:8081 -p 9090:9090 \
  dechat-node
