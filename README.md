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
| 🗺️ **Live walk tracking** | Real-time GPS path on an interactive map, powered by a socket.io live-service. |
| 📅 **Smart match wizard** | Zone, duration and pace matching to find the perfect walker. |
| 💳 **Wallet & ledger** | In-app balance, payments, walker payouts and platform fees with a double-entry ledger. |
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

# 5. Start the live walk-tracking service (port 3003)
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

## ☁️ Deployment (Vercel)

Every push to GitHub deploys automatically (Vercel project `firu-walk`, region `gru1` São Paulo).

- Build runs `scripts/vercel-build.sh`: `prisma generate` → `prisma migrate deploy` (**production only**) → `next build`.
- Database: Neon (Vercel → Storage). It sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED`; the build uses the unpooled one as `DIRECT_URL` for migrations.
- The socket.io live-service does **not** run on Vercel; host it separately (Milestone 3).

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

mini-services/live-service/ # socket.io GPS simulation + chat relay (:3003)
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
