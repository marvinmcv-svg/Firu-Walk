#!/usr/bin/env bash
# Vercel build: apply pending migrations ONLY for production deployments,
# then build. Preview deployments never migrate (they may share the DB).
set -euo pipefail

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
