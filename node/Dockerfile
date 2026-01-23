FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY src ./src
COPY web ./web
EXPOSE 8081
EXPOSE 9090
CMD ["npm","start"]
