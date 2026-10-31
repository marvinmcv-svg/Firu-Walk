# FiruWalk — notes for Claude

## Deploying (owner's standing instruction)

Always ship finished work to Vercel **production** without being asked:

1. Run `npx tsc --noEmit` and `npx eslint` on what changed (and the relevant
   e2e tests when the landing or app flows change).
2. Commit and push to the working branch.
3. Create a production deployment of that commit on the Vercel project
   `firu-walk` (team `team_oJjp2m4ndYj0sRVbnyFFjypE`, project
   `prj_SsMRcIHT0ytmnG9avPrWYXl8sCS8`) with `target: "production"` and a
   GitHub `gitSource` (`marvinmcv-svg/Firu-Walk`, branch + sha).
4. Wait for READY (read the build logs and fix on ERROR), then fetch
   `/api/config` on the production URL (Vercel `web_fetch_vercel_url` — the
   sandbox can't reach vercel.app) and check runtime logs: a READY build can
   still 500 at runtime if a required env var is missing (see
   `src/lib/server/env.ts`). Then report https://firu-walk.vercel.app.

Production builds run `prisma migrate deploy` (scripts/vercel-build.sh), so
review new migrations before deploying. Never set `SEED_ON_BUILD=true` on
production — it wipes the database.

## Admin sign-in

Username/password team access reads `ADMIN_USERNAME` and
`ADMIN_PASSWORD_HASH` from the Vercel environment. Generate a new hash with
`bun scripts/hash-password.ts '<password>'`; never commit a password.
