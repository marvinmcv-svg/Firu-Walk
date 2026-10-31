# FiruWalk live-service (socket.io) — port 3003 (public), 3004 (internal publish API).
FROM oven/bun:1.3.14-slim
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY . .
EXPOSE 3003 3004
CMD ["bun", "index.ts"]
