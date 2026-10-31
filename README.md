# 🐾 FiruWalk

**Premium dog-walking PWA for Bolivia — with FirulAI, your AI dog receptionist.**

FiruWalk connects dog owners with trusted, vetted walkers across Santa Cruz de la Sierra's safest zones. Built as an installable Progressive Web App with an Apple-grade, glossy user experience — buttery motion, glass surfaces, and a bilingual (English / Español) interface throughout.

```text
   / \__
  (    @\____
  /         O
  /   (_____/
  /_____/   U   🐶 FiruWalk — walk happy, worry never.
```

---

## ✨ Highlights

| Feature | Description |
|---|---|
| 🤖 **FirulAI** | Dog-branded AI receptionist (powered by LLM) — answers questions, quotes prices, hands off to WhatsApp. The logo dog is the mascot. |
| 🎬 **Cinematic intro** | Animated splash (rendered from the `intro-video/` composition) plays on load, with a skip button and smart "play once per session" behavior. |
| 💎 **Premium animated cards** | "How it works" and "Product trust" sections with 3D tilt, gloss sweeps, animated counters, and scroll-draw strokes. |
| 🗺️ **Live walk tracking** | Real GPS from the walker's phone (Android app, works with the screen locked), validated server-side and pushed live to the owner's map. |
| 📅 **Smart match wizard** | Zone, duration and pace matching to find the perfect walker. |
| 💳 **Payments & ledger** | Bank QR confirmed by the provider's webhook, monthly plans, weekly walker payout batches, daily reconciliation — all on a double-entry ledger. |
| 🌐 **ENG / SPA toggle** | Full bilingual experience — landing, app, admin, and FirulAI included. |
| 🌙 **Dark mode** | System-aware with a beautiful dark palette. |
| 📱 **PWA** | Manifest + icons + maskable assets — install it like a native app. |

## 👥 Three experiences, one app

- **Owner** — dog profiles, match wizard, booking & payment, live walk view, chat with the walker, walk report cards, reviews.
- **Walker** — availability, agenda, accept/decline requests, active walk GPS tracking, report submission, earnings & withdrawals.
- **Admin** — dashboard metrics, walker application approvals, bookings, dispute resolution, user management, platform config & CSV export.

## 🛠️ Tech stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript 5**
- **Tailwind CSS 4** + **shadcn/ui** (New York style) + **Lucide icons**
- **Framer Motion** for the silky animation layer
- **Prisma ORM** + **PostgreSQL** (migrations in `prisma/migrations`)
- **Redis** (optional for now — rate limits & sessions from Milestone 2)
- **Sentry** error tracking + structured JSON logs (`src/lib/server/log.ts`)
- **socket.io** live-service (mini-service on port `3003`)
- **z-ai-web-dev-sdk** (server-side only) — the LLM brain behind FirulAI
- **Playwright** (Python) end-to-end suite — 7 test files covering landing, golden paths for owner/walker/admin, language toggle, and FirulAI

## 🚀 Getting started

> Prerequisites: [Bun](https://bun.sh) 1.2+, Docker (for local Postgres/Redis)

```bash
# 1. Install dependencies (also generates the Prisma client)
bun install

# 2. Start Postgres + Redis
docker compose up -d db redis

# 3. Configure environment
cp .env.example .env        # defaults match docker-compose

# 4. Apply migrations & seed demo data (walkers, owners, bookings…)
bun run db:migrate:deploy
bun run db:seed

# 5. Start the live-service (sockets :3003, internal API :3004; dev GPS simulator on)
cd mini-services/live-service && bun install && bun run dev &

# 6. Start the app (port 3000)
bun run dev
```

Open **http://localhost:3000** — the intro plays, then the landing page greets you with FirulAI in the corner. 🐕
Health check: **http://localhost:3000/api/health**.

Full stack in containers instead: `SEED=true docker compose up --build` (app on :3000, live-service on :3003).

### Useful scripts

| Command | What it does |
|---|---|
| `bun run dev` | Dev server on port 3000 |
| `bun run lint` / `bun run typecheck` | ESLint / TypeScript checks |
| `bun run db:migrate` | Create a new migration after editing `schema.prisma` (dev) |
| `bun run db:migrate:deploy` | Apply pending migrations (CI / production) |
| `bun run db:seed` | Seed demo data — **wipes the DB**; refuses in production unless `ALLOW_SEED=true` |
| `bun run db:reset` | Reset schema + re-seed from scratch |
| `bun run db:studio` | Browse the database |

## 🔐 Authentication

- **Phone + 6-digit code.** `POST /api/auth/otp` sends a code (WhatsApp Cloud API → Twilio SMS fallback; printed to the server log in development). `POST /api/auth/login` verifies it and sets an **httpOnly `fw_session` cookie** (30 days, `SameSite=Lax`, `Secure` over HTTPS). Only HMACs of codes and session tokens are stored.
- Codes expire after 5 min, allow 5 attempts, are single-use, and have a 60 s resend cooldown. Requests are rate-limited per phone and per IP (Redis when `REDIS_URL` is set, otherwise Postgres).
- `POST /api/auth/logout` revokes the session server-side. Cross-site writes to `/api/*` are rejected (`src/proxy.ts`).
- **Admins** are only created with `bun run admin:create +5917xxxxxxx "Name"` — never through the app.
- **Demo mode** (`DEMO_MODE=true`): one-click demo accounts and the fixed code `123456`. Refused on Vercel production deployments.
- API permission tests: `bun run test:api` (needs `TEST_DATABASE_URL`, a disposable DB).

To go live you need a WhatsApp Business **authentication** template with a copy-code button (`WHATSAPP_OTP_TEMPLATE`) and/or Twilio credentials.

## 📡 Realtime (live walks & chat)

- The browser connects to the live-service with a 10-minute token from `POST /api/realtime/token`; identity (user id, name, role) comes from that token, never from event payloads.
- Joining `walk:{id}` or `chat:{bookingId}` needs a 2-minute room ticket from the same endpoint (`{ room }`), issued only to the dog's owner, the assigned walker, booking participants or admins. Only the walker/admin may stop a walk.
- Chat messages are saved by `POST /api/messages`, which then publishes them to the room through the service's internal port (`:3004`, signed with `REALTIME_SECRET`). Sockets cannot send messages.
- GPS points reach `walk:{id}` only through the tracking API (below); sockets cannot inject them.
- Tests: `tests/api/realtime.test.ts` (forged/expired tokens, foreign tickets, wrong rooms, spoofed senders).

## 📍 GPS tracking (walker app)

- Walkers use the **Android app** in `android/` (Capacitor, loads the deployed site; see [docs/WALKER_APP.md](docs/WALKER_APP.md)). It records a fix every ~10 s / 15 m with the screen locked, buffers offline and uploads in batches to `POST /api/walks/[id]/track` (idempotent by `seq`, retried with backoff). In a browser the same code uses `navigator.geolocation` (foreground only).
- The server rejects fixes faster than 25 km/h, jumps over 1 km, out-of-order or out-of-window timestamps, inaccurate fixes and **mock locations** (walk flagged + audit log), computes the distance itself and pushes accepted points to the owner as `walk:points`.
- Start/finish require being within **150 m** of the owner's address. Admins can allow one start or end without it (Admin → Reservas → paseo, reason required, audit-logged). All limits live in Admin → Configuración → *GPS y geocerca*.
- Local dev / e2e: `NEXT_PUBLIC_GPS_SIM=true` makes the walker cockpit simulate a walk around the owner's address through the real API (refused in production builds).
- Tests: `tests/api/tracking.test.ts`.

## 💳 Payments, plans & payouts

- **Bank QR via a `PaymentProvider`** (`src/lib/server/payments/`): `createQr`, `verifyWebhook`, `getStatus`, `listSettlements`, `refund`. `PAYMENT_PROVIDER=mock` (default; refused in production) is a fake bank with real, meaningless QR codes and a **"Simular pago"** button; `bankqr` is the adapter skeleton for the provider the business picks.
- A payment becomes **HELD only** through a signed webhook (`POST /api/payments/webhook/<provider>`, idempotent by event id), the provider status poll (`GET /api/payments/[id]`, polled by the payment sheet), or an **admin manual confirmation** with a required reason (audit-logged). Owners cannot confirm their own payments.
- Owners pay the walk price **+ service fee** (`fees.ownerFeePct`), shown as a breakdown before paying. Completed walks release the held money: walker net of commission, platform commission + fee. Refunds (disputes, cancellations) go back through the provider, or open a *manual refund* task when it has no refund API.
- **Monthly plans** (`Plan`/`Subscription`): bought with QR, the money sits in ledger account `plan:{id}`, one walk is drawn per completed walk. Unused walks at period end follow `plans.unusedWalkPolicy` (`forfeit` or `credit`).
- **Daily reconciliation** compares provider settlements with the ledger and checks Σdebit = Σcredit; differences show up in **Admin → Pagos**.
- **Weekly payout batches**: built Monday (or by hand) from every wallet ≥ the minimum, approved by an admin, exported as a bank CSV, then marked paid with the transfer reference. Walkers set their payout account under *Ganancias*.
- **Cash** walks stay supported: the platform's share becomes walker debt. Above `payouts.maxCashDebtCents` the walker gets no new bookings until an admin records a deposit (Admin → Usuarios).
- Scheduled jobs: `GET /api/cron/daily` (reconciliation + plan expiry) and `GET /api/cron/payouts` (weekly batch), protected by `CRON_SECRET` and scheduled in `vercel.json`.
- Tests: `tests/api/payments.test.ts` (full MockProvider flow; the ledger must balance after every step).

## ☁️ Deployment (Vercel)

Every push to GitHub deploys automatically (Vercel project `firu-walk`, region `gru1` São Paulo).

- Build runs `scripts/vercel-build.sh`: `prisma generate` → `prisma migrate deploy` (production, or any deploy with `RUN_MIGRATIONS=true`) → optional demo seed (`SEED_ON_BUILD=true`, **wipes the DB**) → `next build`.
- Database: Neon (Vercel → Storage). It sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED`; the build uses the unpooled one as `DIRECT_URL` for migrations.
- The socket.io live-service does **not** run on Vercel; host it separately (any container host — `mini-services/live-service/Dockerfile`). Set the same `REALTIME_SECRET` on both, `LIVE_SERVICE_INTERNAL_URL` on the app (private network URL of port 3004), `NEXT_PUBLIC_LIVE_URL` on the app (public URL of port 3003), and `REDIS_URL` on the service to run more than one instance.

## 📁 Project structure

```text
src/
├── app/                    # App Router — / page + /api/* route handlers
│   └── api/                # bookings, walkers, payments, disputes,
│                           # firulai (LLM), admin/*, auth, wallet…
├── components/
│   ├── firu/
│   │   ├── shell/          # LandingScreen, IntroSplash, AppShell
│   │   ├── owner/          # Home, Explore, BookingFlow, LiveWalkView…
│   │   ├── walker/         # Home, ActiveWalkScreen, Earnings…
│   │   ├── admin/          # Dashboard, Applications, Disputes, Config…
│   │   └── shared/         # FirulAI widget, ChatDialog, WalkMap, bits…
│   └── ui/                 # shadcn/ui component library
└── lib/
    ├── firu/               # i18n (en/es locales), session, motion, api
    └── server/             # bookingEngine, ledger, notify, config

mini-services/live-service/ # authenticated socket.io rooms: live walks + chat (:3003)
android/ capacitor.config.ts # walker Android app (Capacitor shell + background GPS)
intro-video/                # Source composition used to render the intro MP4
prisma/                     # schema.prisma + seed.ts
tests/e2e/                  # Playwright (Python) end-to-end suite
public/                     # brand assets, pet imagery, intro video, PWA icons
```

## 🧪 End-to-end tests

The Playwright suite (Python) covers the whole product — landing (light/dark, desktop/mobile), the owner golden path (dog CRUD → wizard → payment → live walk → review), the walker golden path (accept → walk → report → withdraw), admin operations, the language toggle journey, and FirulAI (greeting, pricing, WhatsApp handoff).

```bash
node scripts/dev-gateway.mjs &          # :81 → app :3000 + live-service :3003
CHROMIUM_PATH=/path/to/chrome tests/e2e/run_all.sh   # needs pytest + playwright (Python)
```

> Screenshots from test runs are written to `tests/e2e/screenshots/` (git-ignored).

## 🌍 Languages

All UI copy lives in typed locale modules — adding a language means adding one folder:

```text
src/lib/firu/locales/en/    # English  (default)
src/lib/firu/locales/es/    # Español
```

Toggle anywhere via the language switch — FirulAI replies in the active language too.

## 📞 Contact

Questions, walks, or just want to say hi? **WhatsApp: +591 77165787** — or chat with FirulAI right in the app; he'll take care of you. 🐶

---

© FiruWalk — walk happy, worry never.
