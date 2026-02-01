FROM node:20-alpine

WORKDIR /app

# --- install required runtime tools ---
RUN apk add --no-cache curl jq

# --- install node deps ---
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# --- app source ---
COPY src ./src
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV PORT=8081

EXPOSE 8081 9090

ENTRYPOINT ["/entrypoint.sh"]
