# FiruWalk web app — multi-stage image (Next.js standalone output).
#   docker build -t firuwalk .
# Migrations are applied by the `migrate` service in docker-compose.yml
# (or `bun run db:migrate:deploy` in your release step), not on app start.

FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g bun@1.3.14
WORKDIR /app

# ---- deps: install once, cached unless the lockfile changes ----
FROM base AS deps
COPY package.json bun.lock ./
COPY prisma ./prisma
RUN bun install --frozen-lockfile

# ---- builder: full source + build (also used to run migrations/seed) ----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Public socket URL of the live-service, inlined into the client bundle.
ARG NEXT_PUBLIC_LIVE_URL=""
ENV NEXT_PUBLIC_LIVE_URL=$NEXT_PUBLIC_LIVE_URL
RUN bunx prisma generate && bunx next build

# ---- runner: minimal runtime ----
FROM node:22-bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app app
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/health || exit 1
CMD ["node", "server.js"]
