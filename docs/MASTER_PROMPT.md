# FiruWalk — Master Prompt for the Coding Agent

> How to use: paste everything inside the block below into your coding agent.
> Then ask it to do **one milestone at a time** ("Do Milestone 1"), review,
> merge, and continue. Don't ask for all milestones in one go.

---

```text
ROLE
You are a senior full-stack engineer taking FiruWalk from a high-fidelity demo
to a production marketplace launching in Santa Cruz de la Sierra, Bolivia.
Work in the existing repo. Read README.md, prisma/schema.prisma,
src/lib/server/*, src/app/api/**, mini-services/live-service/* and
docs/LAUNCH_PLAN.md before changing anything.

PRODUCT CONTEXT
- FiruWalk connects dog owners with vetted dog walkers. Three roles: OWNER,
  WALKER, ADMIN. Bilingual ES (primary) / EN. Currency: Bolivianos (BOB),
  stored ONLY as integer centavos. Timezone: America/La_Paz (UTC-4, no DST).
- Users are mobile-first, WhatsApp-native, pay mostly with bank QR or cash.
  Walkers often use low-end Android phones on prepaid data.
- City: Santa Cruz de la Sierra. Remove any "La Paz" city references in
  README/UI copy (the timezone name America/La_Paz stays).

NON-NEGOTIABLE RULES
1. Keep the existing architecture and code style (Next.js 16 App Router route
   handlers, `run()/ok()/ApiError` helpers, Spanish user-facing errors,
   typed locale modules in src/lib/firu/locales/{es,en}). Every new UI string
   goes in BOTH locales.
2. Money: integer centavos, every money movement goes through
   src/lib/server/ledger.ts postTxn() and must balance. Never floats.
3. Never trust the client for identity, role, price, or payment status.
4. Every route: Zod-validate input, authenticate, authorize (ownership + role).
5. Secrets only via env vars; update .env.example with every new variable
   (placeholders, never real values). Never commit secrets or the DB file.
6. Keep the existing Playwright e2e suite green; update tests when behavior
   changes intentionally; add tests for every new flow. Run `bun run lint`
   and a production build before finishing each milestone.
7. Small, reviewable commits per logical change. At the end of each milestone
   write a short summary: what changed, migrations, new env vars, manual steps.
8. If a requirement is ambiguous or needs a business decision (provider
   choice, pricing, legal text), stop and ask instead of guessing. Put
   provider integrations behind an interface with a mock implementation so
   development and tests work without credentials.

MILESTONE 1 — Production foundation
- Migrate Prisma from SQLite to PostgreSQL. Convert documented string statuses
  to Prisma enums and *Json string columns to Json/jsonb where sensible.
  Create proper migrations (no `db push --accept-data-loss` in prod). Keep
  seed.ts working for local/staging only (guard against running in prod).
- Add env-driven config (validated with Zod at boot): DATABASE_URL,
  REDIS_URL, APP_URL, SESSION_SECRET, storage, LLM, WhatsApp, payment keys.
- Add Sentry (or equivalent) error tracking and structured logging.
- Add a /api/health endpoint (DB + Redis check).
- Dockerfile + docker-compose for local Postgres/Redis; document deploy.
Acceptance: app runs on Postgres locally via docker-compose, all e2e tests
pass, build succeeds.

MILESTONE 2 — Real authentication & authorization (launch blocker)
- Remove X-User-Id header auth entirely (src/lib/server/session.ts,
  src/lib/firu/api.ts, src/lib/firu/session.ts).
- Phone OTP login: generate 6-digit random code, store a hash with 5-min
  expiry, max 5 attempts, resend cooldown 60 s, per-phone and per-IP rate
  limits in Redis. Send via an `OtpSender` interface with implementations:
  WhatsAppCloudOtpSender (primary), SmsOtpSender (fallback), ConsoleOtpSender
  (dev only). Never reveal the code in error messages.
- Sessions: httpOnly, Secure, SameSite=Lax cookie holding a signed session id
  (DB-backed Session table with expiry + revoke on logout). CSRF protection
  for mutating routes.
- Demo mode only when NODE_ENV !== "production" AND DEMO_MODE=true.
- ADMIN users can only be created via a CLI script, never via signup.
- Audit every route in src/app/api/** for ownership checks (owner sees only
  own dogs/bookings/payments; walker only assigned walks; admin routes
  requireAdmin). Write an authorization test per route.
- Move rate limiting (incl. FirulAI) from in-memory Map to Redis.
Acceptance: impossible to act as another user by changing headers/body;
tests prove 401/403 on cross-user access.

MILESTONE 3 — Secure realtime
- live-service: require a short-lived JWT (issued by the Next.js API) on the
  socket handshake. Server checks the user may join `walk:{id}` (owner of
  the dog, assigned walker, or admin) and `chat:{threadId}` (booking
  participants). Use the Redis adapter for multi-instance.
- Persist chat messages server-side (do not trust client-provided fromId/
  fromName/role — derive from the token).
- Keep the GPS simulator ONLY behind a dev flag.
Acceptance: joining a room you don't belong to is rejected (test it).

MILESTONE 4 — Real GPS tracking (core trust feature)
- Wrap the walker experience with Capacitor (Android first, iOS second)
  using a maintained background-geolocation plugin. Owner side stays a PWA.
- Walker app: start walk → background location every ~10 s / 15 m,
  offline buffer in local storage, batch upload to
  POST /api/walks/[id]/track (idempotent by seq), retry with backoff.
- Server: validate points (reject speed > 25 km/h between points, teleports,
  timestamps out of order, Android mock-location flag), compute distance
  server-side, broadcast to the owner over the secure socket.
- Start/end walk require being within 150 m of the owner's address
  (configurable) or an admin override with reason (audit log).
- Owner live view uses real points; end-of-walk summary (map, distance,
  duration, report card photos).
- Battery-light walker UI: disable heavy animations on walker screens.
Acceptance: a real Android device produces a real track with screen locked
for 30 min; owner sees it live.

MILESTONE 5 — Real payments (Bolivian QR) & payouts
- Define `PaymentProvider` interface: createQr(amount, reference, expiry) →
  {qrImage, providerRef}; verifyWebhook(req); getStatus(ref). Implement a
  MockProvider now, and a provider adapter skeleton to be filled once the
  business picks a bank/aggregator (ask me which).
- Payment status changes ONLY via verified webhook or provider status poll —
  remove the owner self-confirm path (keep it admin-only for manual
  reconciliation with a required reason + audit log).
- Idempotent webhook handling; daily reconciliation job comparing provider
  settlements vs ledger, flag mismatches in the admin panel.
- Monthly plans: new `Plan` / `Subscription` models (e.g. 20 walks/month),
  paid upfront, walks consumed per completed walk, unused-walk policy in
  Config.
- Owner service fee + commission from Config (already partly exists:
  fees.commissionPct, fees.ownerFeePct) — show the breakdown before paying.
- Walker payouts: weekly batch, admin approves, export CSV for bank transfer,
  mark PAID with reference; walker sees history.
- Cash: keep supported but recorded as walker debt (existing behavior);
  block new bookings for walkers whose debt exceeds a Config threshold.
Acceptance: full flow with MockProvider including webhook, refund via
dispute, payout batch; ledger always balances (add a test asserting
Σdebits = Σcredits).

MILESTONE 6 — WhatsApp notifications & anti-disintermediation
- `Notifier` interface with channels: in-app (existing Notification table),
  WhatsApp Cloud API templates, web push. User preferences per channel.
- Templates (ES/EN): booking request to walker, booking confirmed, walker on
  the way, walk started, walk finished + report link, payment received,
  payout sent, plan expiring.
- Phone numbers of the other party are never shown in UI; communication
  goes through in-app chat. Detect phone numbers / "wa.me" in chat messages
  and show a gentle warning ("keep it in FiruWalk to stay covered by the
  guarantee").
Acceptance: each booking/walk event triggers the right template (mocked in
tests).

MILESTONE 7 — Walker vetting & documents
- Walker application with uploads (CI front/back, selfie, certificado de
  antecedentes, optional video intro) to private object storage; access only
  via short-lived signed URLs for admins. Encrypt the CI number at rest.
- Admin review checklist (identity match, background certificate,
  interview done, trial walk done) before ACTIVE.
- Image compression client-side (walkers' data plans).
Acceptance: documents are never publicly reachable; tests cover access.

MILESTONE 8 — Safety & ops
- SOS button on active walk: notifies owner + ops WhatsApp group, shares
  live location, logs IncidentLog, shows nearest-vet list (admin-managed).
- Late-start detection (walk not started 10 min after scheduled) → alert
  owner + ops, trigger backup walker from the candidate chain.
- Scheduled jobs (accept-timeout sweep, reminders, reconciliation, payouts)
  as a proper worker/cron, not request-triggered.
- Admin: live map of in-progress walks, incident queue, walker leaderboard
  (on-time %, rating, no-shows).

MILESTONE 9 — FirulAI to production
- Replace z-ai-web-dev-sdk with a production LLM API behind an `LlmClient`
  interface (key via env). Keep the live-config system prompt.
- Guardrails: no medical diagnosis (always recommend a vet), no promises
  outside policy, hand off to WhatsApp for human support. Log conversations
  (with consent notice) and cap tokens/cost per IP and per day.
- Tools for FirulAI: check price, check zone coverage, start booking flow
  (deep link), never execute payments.

MILESTONE 10 — Launch polish
- Legal pages (ES/EN placeholders I will replace): Terms, Privacy (GPS +
  photo consent), Walker Agreement, Cancellation & Guarantee.
- Analytics events (PostHog or similar): signup, dog added, booking
  requested/confirmed, payment completed, walk completed, review, plan
  purchased, referral used.
- Referral codes ("Regalá un paseo"): credit both sides via the ledger.
- Performance: Lighthouse ≥ 90 on owner landing (mobile), lazy-load intro
  video, respect prefers-reduced-motion.
- SEO for Santa Cruz (metadata, sitemap, LocalBusiness schema).

OUTPUT FORMAT FOR EACH MILESTONE
1. Plan (files to touch, migrations, risks) — wait for my OK if it changes
   the data model or adds a paid third-party service.
2. Implementation in small commits.
3. Test results (lint, build, e2e) pasted verbatim.
4. Summary: changes, new env vars, manual setup steps, open questions.
```
