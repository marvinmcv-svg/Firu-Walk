#!/usr/bin/env bash
# Vercel build: apply pending migrations ONLY for production deployments,
# then build. Preview deployments never migrate (they may share the DB).
set -euo pipefail

# Prisma migrations need a direct (non-pooled) connection. Neon's Vercel
# integration exposes it as DATABASE_URL_UNPOOLED; fall back to DATABASE_URL.
export DIRECT_URL="${DIRECT_URL:-${DATABASE_URL_UNPOOLED:-${DATABASE_URL:-}}}"

prisma generate

if [ "${VERCEL_ENV:-}" = "production" ]; then
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "DATABASE_URL is not set for production — refusing to build." >&2
    exit 1
  fi
  echo "▶ prisma migrate deploy (production)"
  prisma migrate deploy
else
  echo "▶ skipping migrations (VERCEL_ENV=${VERCEL_ENV:-unset})"
fi

next build
