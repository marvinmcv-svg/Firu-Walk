# FiruWalk — Deep Analysis & Bolivia Launch Plan

> Written after a full read of the v1.0.0 codebase (schema, API routes, booking
> engine, ledger, live-service, FirulAI). Facts about Bolivian institutions,
> fees and providers should be re-verified locally before you commit money.

---

## 1. Verdict in one paragraph

The **product thinking is strong** — better than most first versions. The
schema shows real marketplace maturity: integer centavos, double-entry ledger,
one-at-a-time matching with a fallback chain (anti-shotgun), trial walks for
new walkers, strikes, disputes, a guarantee, recurring bookings and QR as the
default payment. What you have today is a **high-fidelity demo, not a
launchable product**: login accepts a fixed OTP (`123456`), the server trusts
a client-sent `X-User-Id` header (anyone can become admin), live GPS is
**100% simulated**, QR payments are "confirmed" by the owner pressing a
button, and the database is a single SQLite file. The business has one big
strategic risk — **disintermediation over WhatsApp** — and one big economic
risk — **a 12% cut of a Bs 15 walk is Bs 1.80**, which cannot pay for ops.
Both are fixable. Launch in **Santa Cruz, one or two zones, concierge-style
first**, and harden the tech in parallel.

---

## 2. Strengths

### Product / business
| Strength | Why it matters in Bolivia |
|---|---|
| **QR-first payments** | QR (interoperable bank QR) is the everyday way to pay in Bolivian cities. No cards needed. This removes the #1 LatAm marketplace blocker. |
| **WhatsApp handoff (FirulAI → wa.me)** | Bolivians live on WhatsApp. Meeting them there instead of fighting it is correct. |
| **Trust stack** (vetting, trial walks, GPS proof, report cards, reviews, guarantee) | Trust is *the* product. Owners are handing a family member to a stranger. You designed for it. |
| **Recurring bookings** | Recurring = retention + predictable walker income. Most competitors only do one-offs. |
| **Anti-shotgun matching** | Asking one walker at a time with a timeout avoids walkers fighting for jobs and owners getting 5 calls. Good marketplace hygiene. |
| **Cash supported, with negative walker balance** | Realistic for Bolivia — you record the platform fee owed even when cash is used. |
| **Bilingual ES/EN** | Captures expats, NGO/embassy/oil & agro staff in Santa Cruz — a high-willingness-to-pay niche. |
| **Admin tooling already exists** | Applications, disputes, config, CSV export — you can operate from day one. |

### Technical
- Clean modern stack (Next.js 16, React 19, Prisma, TS) — easy to hire for.
- Money modelled correctly (integer centavos, ledger with txnIds).
- Config table for business tunables (commission, pricing, policies) — you can change the business without deploys.
- E2E test suite (Playwright) covering golden paths — rare at this stage.
- Clear domain separation (`bookingEngine`, `ledger`, `notify`, `config`).

---

## 3. Weaknesses & risks

### 3.1 Launch blockers (must fix before a single real customer)

| # | Issue | Where | Consequence |
|---|---|---|---|
| B1 | **Auth is fake**: server identifies users by `X-User-Id` header. | `src/lib/server/session.ts` | Anyone can read any user's data, confirm payments, or act as ADMIN by changing one header. |
| B2 | **Fixed OTP `123456`**, no SMS/WhatsApp OTP, error message leaks the code. | `src/app/api/auth/login/route.ts`, `config.demo` | Account takeover of any phone number. |
| B3 | **GPS is simulated** — no `navigator.geolocation` anywhere; `live-service/sim.ts` invents routes. | `mini-services/live-service` | Your core trust promise ("GPS proof of every walk") is not real. |
| B4 | **Payments are self-confirmed** — owner clicks "I paid" → HELD. No bank/QR provider integration, no webhook. | `api/payments/[id]/confirm` | Fake payments; ledger doesn't match the bank. |
| B5 | **SQLite file DB**, in-memory rate limit, socket service with no auth. | `prisma/schema.prisma`, `firulai/route.ts`, `live-service` | No horizontal scaling, no backups, anyone can join any `walk:`/`chat:` room and read chats/locations. |
| B6 | **Walker documents** (CI, selfie, ID photo) have no real upload/storage/encryption. | `walkers/apply` | Can't vet; and if you do store them, you must protect them. |
| B7 | **LLM via `z-ai-web-dev-sdk`** (sandbox SDK). | `firulai/route.ts` | Not a production provider; swap to a real API with keys, logging and cost caps. |
| B8 | **City inconsistency**: README says La Paz, code/SEO say Santa Cruz. | README vs `layout.tsx`, `config.ts` | Pick one (recommendation: Santa Cruz). |

### 3.2 Product / platform weaknesses

- **PWA background GPS limitation.** Mobile browsers (especially iOS Safari) suspend geolocation when the screen locks or the app is backgrounded. A walker can't hold the phone screen-on for 45 minutes with a leash in hand. **You need a native wrapper (Capacitor) for the walker app** with background location. Owners can stay on the PWA.
- **Push notifications on iOS PWA** only work after "Add to Home Screen" — most Bolivian users won't do that. Use **WhatsApp Business API** (template messages) as the primary notification channel, push as secondary.
- **Connectivity**: mobile data drops in some zones and walkers may have prepaid data. GPS must buffer offline and batch-upload; app must be light.
- **Low-end Android devices** are common among walkers. Heavy Framer Motion / 3D tilt effects on walker screens will hurt battery and performance — keep the "premium" gloss for the owner landing page, make the walker app spartan.
- **No real-world safety flows**: SOS exists as an incident type, but no escalation (call owner, call ops, nearest vet). Street-dog encounters, heat stroke, and ticks are real Santa Cruz risks.

### 3.3 Business weaknesses

1. **Disintermediation (the #1 marketplace killer).** After 3 good walks the owner has the walker's WhatsApp and pays Bs 15 cash directly, saving your fee. Mitigations (stack several):
   - Make the platform *cheaper or better* than going direct: **monthly plans** with a discount, guarantee/backup walker, GPS + photo report, insurance-style coverage, walker gets paid faster/more reliably.
   - Mask phone numbers — all chat in-app or through a FiruWalk WhatsApp number until the relationship is established.
   - Walker incentives: tiered commission (lower % for top walkers with high in-app volume), bonuses, "Walker of the month", future benefits (accident insurance, training certificate).
   - Accept some leakage; focus on recurring plans where convenience wins.
2. **Thin unit economics.** 12% of Bs 15 = **Bs 1.80/walk**. One ops person (~Bs 4–6k/month) needs ~2,500–3,000 walks/month just to break even on that salary. Fixes:
   - Raise the take to **~18–20%** blended (commission + a small owner service fee), *justified* by the guarantee.
   - Sell **plans** (e.g. 20 walks/month) paid upfront → cash flow and retention.
   - **Group walks** (2–3 compatible dogs): owner price slightly lower, walker earns more per hour, platform earns per dog.
   - **Add adjacent services** with better margins: pet-sitting/home visits, dog daycare partners, bath/grooming at home, vet transport ("pet taxi"), training sessions, pet-shop affiliate deliveries.
3. **Market size is real but narrow.** Many Santa Cruz homes have patios, and many households have a *trabajadora del hogar* who handles the dog. Your buyer is specific: **apartment/condominium dwellers in central zones (Equipetrol, Las Palmas, Urubó condominiums, Av. San Martín area), young professionals, dual-income couples, expats, elderly owners.** Target them explicitly; don't market to "everyone with a dog".
4. **Economic environment.** Bolivia has had FX/dollar scarcity, inflation pressure and fuel issues. Keep everything in **Bolivianos**, keep cloud costs low (USD-billed services hurt), prefer providers you can pay locally or in small USD amounts, and price walks so walkers earn noticeably above informal alternatives.
5. **Labor-law exposure.** Bolivia's labour law is worker-protective. If you control walkers' schedules, uniforms and pricing tightly, they may be considered employees. Structure walkers as independent service providers (they set availability, can decline, can set their own price within bands) and get a local lawyer to review the walker agreement.
6. **Liability.** A dog gets hit by a car or bites someone during a walk. You need clear T&Cs, a walker code of conduct, an incident fund (part of the fee) and, if obtainable, a local liability policy.

### 3.4 SWOT summary
- **S:** trust-centric design, QR + WhatsApp native, recurring bookings, solid data model, bilingual.
- **W:** demo-grade auth/payments/GPS, thin margin, PWA limits, single-city single-node architecture.
- **O:** almost no structured competition (mostly Facebook/Instagram/WhatsApp-group walkers); growing pet-humanization trend; vets and pet shops as partners; expansion to La Paz/Cochabamba later; adjacent services.
- **T:** disintermediation, a single bad incident going viral on TikTok/Facebook, walker churn, copycats from existing pet shops/vets, economic downturn cutting discretionary spend.

---

## 4. Launch plan (Santa Cruz de la Sierra)

### Phase 0 — Validate with a concierge MVP (weeks 0–4, almost zero code)
Goal: prove people pay *recurring* and walkers show up — before over-engineering.
- Recruit **8–12 walkers** (vet students, UAGRM/UPSA students, animal-rescue volunteers). In-person interview, CI check, **certificado de antecedentes (REJAP)**, 1 trial walk with your own dog.
- Pick **1–2 zones** (e.g. Equipetrol + Las Palmas). Density matters more than coverage: walkers should do 4–6 walks in one area.
- Sell via Instagram/TikTok/Facebook + WhatsApp Business + flyers in **condominium buildings** and **vet clinics**. Offer a founding plan (e.g. first week 50% off on a monthly plan).
- Run bookings manually on WhatsApp + the admin panel; collect payment with your company QR.
- **Success criteria:** ≥30 paying owners, ≥50% buy a 2nd month, walker no-show rate <3%, NPS ≥50, average ≥8 walks/owner/month.

### Phase 1 — Production hardening (weeks 2–8, in parallel with Phase 0)
Order matters (each step unblocks the next):
1. **Infra:** Postgres (Supabase/Neon), object storage for photos/documents, staging + production envs, backups, Sentry, uptime monitor. Pick region closest to Bolivia (São Paulo).
2. **Auth:** real phone OTP via **WhatsApp OTP** (cheaper/more reliable than SMS in Bolivia) with SMS fallback; httpOnly session cookies/JWT; server-side role checks; rate limits in Redis; remove `X-User-Id`.
3. **Authorization audit** of every route + socket room (JWT on socket handshake).
4. **Real GPS:** Capacitor walker app with background geolocation, offline buffer, batch upload, anti-spoofing checks (speed/teleport detection, mock-location flag on Android).
5. **Payments:** integrate a Bolivian QR provider (evaluate bank QR APIs and local aggregators — e.g. BNB, BCP, Banco Ganadero, Libélula, PagosNet — compare fees, settlement time, webhook support, onboarding requirements). Webhook-confirmed payments only; reconciliation job against the ledger. Walker payouts: weekly batch transfers to their bank account / QR.
6. **Notifications:** WhatsApp Business Cloud API templates for booking requests, walker on the way, walk started/ended + report link, payment received.
7. **FirulAI:** switch to a production LLM API, keep the live-config system prompt, add logging, cost caps, guardrails (no medical diagnoses → "call your vet").
8. **Legal pages:** Terms, Privacy, Walker Agreement, Cancellation & Guarantee policy (ES first).

### Phase 2 — Soft launch (weeks 8–12)
- Move Phase-0 customers onto the app (keep WhatsApp as support).
- Invite-only growth: each owner gets referral codes ("Regalá un paseo").
- Weekly metrics review (see §6). Fix the top 3 friction points every week.
- Walker ops: weekly payouts on time, monthly meetup, simple training (leash handling, heat, dog fights, first aid basics).

### Phase 3 — Growth (months 3–9)
- **Partnerships:** vets (referral fee or free walks for their clients), pet shops, groomers, condominium administrators (building-wide discount), real-estate agencies and relocation services for expats.
- **Content:** TikTok/Instagram Reels of walks (with owner consent), "Firu del mes", walker spotlights. Local micro-influencers with dogs.
- **Plans & add-ons:** monthly plans, group walks, pet-sitting, vet transport.
- **Expand zones** only when existing zones have ≥70% walker utilization at peak hours (06:00–09:00, 17:30–20:00 — Santa Cruz heat makes midday walks unsafe).
- Then **La Paz / Cochabamba** (different geography/climate; adapt durations and walk routes).

### Legal & admin checklist (do in Phase 0–1, with a local accountant/lawyer)
- Company registration (SEPREC), tax ID (NIT) with Servicio de Impuestos Nacionales, **electronic invoicing (SIAT)** — Bolivian customers often ask for a *factura*.
- Business bank account with QR collection.
- Walker agreement (independent provider), owner T&Cs, privacy policy (consent for GPS and photos; handle CI images as sensitive data).
- Trademark "FiruWalk" registration (SENAPI).
- Incident/liability policy; ask local insurers about coverage.

---

## 5. Pricing recommendation (starting point — test it)
| Product | Owner pays | Walker gets | FiruWalk keeps |
|---|---|---|---|
| Single 30 min | Bs 20 | Bs 16 | Bs 4 (20%) |
| Single 60 min | Bs 32 | Bs 26 | Bs 6 |
| Plan 20 × 30 min / month | Bs 340 (Bs 17/walk) | Bs 14/walk | Bs 3/walk + upfront cash |
| Group walk (2–3 dogs), per dog 45 min | Bs 18 | Bs 14 per dog | Bs 4 per dog |

Walker at 3 group walks of 3 dogs per morning ≈ Bs 126 for ~2.5 h — competitive vs informal work, which is what keeps walkers loyal.

---

## 6. Metrics that decide everything
- **Recurring owner retention** (month 2 and month 3) — north star.
- Walks per active owner per month.
- Walker: acceptance rate, on-time start (GPS start within ±10 min), no-show rate, churn.
- Leakage signal: owners who stop booking but whose walker's hours stay full.
- Contribution margin per walk (fee − payment fees − incentives − incident reserve).
- CAC by channel (vet referral vs Instagram vs condo flyer).

---

## 7. Technical target architecture
```
Owner PWA (Next.js)  ─┐
Walker app (Capacitor │ wraps the same Next.js walker UI + native background GPS)
Admin (Next.js)      ─┤
                      ▼
Next.js API (Route Handlers, Zod validation, session auth, RBAC)
   │        │             │              │
Postgres  Redis       Object storage   Workers/cron (accept-timeout sweep,
(Prisma)  (rate limit, (photos, CI docs, payment reconciliation, payouts,
           socket       signed URLs)     reminders)
           adapter)
   │
Realtime: socket.io (JWT handshake, room ACL) or Supabase Realtime
Integrations: QR payment provider (webhooks) · WhatsApp Cloud API (OTP + templates)
              · LLM API (FirulAI) · Sentry · analytics (PostHog)
```

See **`docs/MASTER_PROMPT.md`** for the prompt to hand to your coding agent.
