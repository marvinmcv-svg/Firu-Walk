#!/usr/bin/env bash
# Vercel build: generate the Prisma client, apply pending migrations when
# allowed, optionally load demo data, then build.
#   - Migrations run on production deploys, or on any deploy with
#     RUN_MIGRATIONS=true (set per-branch in Vercel for a dev branch).
#   - SEED_ON_BUILD=true loads the demo seed — it WIPES the database.
#     Turn it on for one build only, then switch it off again.
set -euo pipefail

# Prisma migrations need a direct (non-pooled) connection. Neon's Vercel
# integration exposes it as DATABASE_URL_UNPOOLED; fall back to DATABASE_URL.
export DIRECT_URL="${DIRECT_URL:-${DATABASE_URL_UNPOOLED:-${DATABASE_URL:-}}}"

prisma generate

if [ "${VERCEL_ENV:-}" = "production" ] || [ "${RUN_MIGRATIONS:-}" = "true" ]; then
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "DATABASE_URL is not set — refusing to migrate." >&2
    exit 1
  fi
  echo "▶ prisma migrate deploy (VERCEL_ENV=${VERCEL_ENV:-unset})"
  prisma migrate deploy
else
  echo "▶ skipping migrations (VERCEL_ENV=${VERCEL_ENV:-unset})"
fi

if [ "${SEED_ON_BUILD:-}" = "true" ]; then
  echo "▶ seeding demo data (SEED_ON_BUILD=true — wipes the database)"
  ALLOW_SEED=true bun prisma/seed.ts
fi

next build
