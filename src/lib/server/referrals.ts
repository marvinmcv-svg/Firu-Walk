// "Regalá un paseo" — owner referrals (Phase 2 soft launch).
//
//   1. Every owner has a referral code (created lazily, e.g. "ANA7K2Q").
//   2. A new owner enters it at sign-up (or shortly after, before their
//      first walk) → Referral PENDING.
//   3. When that friend completes their FIRST PAID walk (QR/transfer
//      released, cash settled, or a purchased plan walk — never a gifted
//      one), both sides get a gifted walk → Referral REWARDED.
//
// A gifted walk is a 1-walk Subscription (gift: true) funded from the
// ledger account `platform:marketing`, so it rides the existing plan
// machinery: booking with method PLAN, release to the walker with
// commission on completion, late-cancel shares, and expiry. Whatever is
// left unused goes back to platform:marketing (never to the owner).

import type { Prisma, Subscription } from "@prisma/client";
import { db } from "@/lib/db";
import type { AppConfig } from "@/lib/firu/types";
import { priceBandForDuration } from "./bookingEngine";
import { getAppConfig } from "./config";
import { ApiError } from "./http";
import { postTxn } from "./ledger";
import { log } from "./log";
import { notify } from "./notify";
import { GIFT_PLAN_PREFIX } from "./payments/plans";
import type { WalkSettlement } from "./payments/settle";

/** Ledger account that funds gifted walks (marketing expense). */
export const MARKETING_ACCOUNT = "platform:marketing";

/** Owners may still enter a code this long after signing up (if no walk yet). */
export const REDEEM_WINDOW_DAYS = 30;

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O, 1/I/L

/** Acquisition channels an owner can report at sign-up (CAC by channel). */
export const ACQUISITION_CHANNELS = [
  "organic", // no source given
  "referral",
  "concierge",
  "instagram",
  "tiktok",
  "facebook",
  "whatsapp",
  "google",
  "flyer",
  "vet",
  "condo",
  "other",
] as const;
export type AcquisitionChannel = (typeof ACQUISITION_CHANNELS)[number];

/** Map a raw `utm_source`-like value to a known channel ("other" if unknown, null if empty). */
export function normalizeChannel(raw: unknown): AcquisitionChannel | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  const alias: Record<string, AcquisitionChannel> = {
    ig: "instagram",
    fb: "facebook",
    meta: "facebook",
    wa: "whatsapp",
    tt: "tiktok",
    volante: "flyer",
    flyers: "flyer",
    veterinaria: "vet",
    condominio: "condo",
    edificio: "condo",
  };
  if (alias[v]) return alias[v];
  return (ACQUISITION_CHANNELS as readonly string[]).includes(v) ? (v as AcquisitionChannel) : "other";
}

/** Upper-case, keep only A–Z/0–9 (people type "ana-7k2q" or "ana 7k2q"). */
export function normalizeCode(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 16);
}

function randomPart(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

function codePrefix(name: string): string {
  const first = normalizeCode(name.split(/\s+/)[0] ?? "").replace(/[0-9]/g, "");
  return first && first !== "NUEVO" ? first.slice(0, 4) : "FIRU";
}

/** The owner's referral code, created on first use. */
export async function ensureReferralCode(user: { id: string; name: string; referralCode: string | null }): Promise<string> {
  if (user.referralCode) return user.referralCode;
  for (let i = 0; i < 6; i++) {
    const code = codePrefix(user.name) + randomPart(4);
    const res = await db.user.updateMany({
      where: { id: user.id, referralCode: null },
      data: { referralCode: code },
    }).catch((err: unknown) => {
      // Unique clash with another owner's code → try another one.
      if ((err as { code?: string }).code === "P2002") return null;
      throw err;
    });
    if (res === null) continue;
    if (res.count === 1) return code;
    // Someone set it concurrently: read it back.
    const fresh = await db.user.findUnique({ where: { id: user.id }, select: { referralCode: true } });
    if (fresh?.referralCode) return fresh.referralCode;
  }
  throw new ApiError(500, "No pudimos generar tu código de invitación. Intenta de nuevo.");
}

export type AttachResult =
  | { applied: true; referralId: string }
  | { applied: false; reason: "disabled" | "invalid" | "own" | "already" | "not_eligible" };

/**
 * Link `refereeId` to the owner whose code is `rawCode`. Never throws for
 * a bad code (sign-up must not fail because of it) — returns the reason.
 */
export async function attachReferral(refereeId: string, rawCode: unknown, cfg?: AppConfig): Promise<AttachResult> {
  const config = cfg ?? (await getAppConfig());
  if (!config.referrals.enabled) return { applied: false, reason: "disabled" };
  const code = normalizeCode(rawCode);
  if (code.length < 4) return { applied: false, reason: "invalid" };

  const [referrer, referee] = await Promise.all([
    db.user.findUnique({ where: { referralCode: code }, select: { id: true, role: true } }),
    db.user.findUnique({
      where: { id: refereeId },
      select: { id: true, role: true, createdAt: true, importedAt: true, referredBy: { select: { id: true } } },
    }),
  ]);
  if (!referrer || referrer.role !== "OWNER" || !referee) return { applied: false, reason: "invalid" };
  if (referrer.id === referee.id) return { applied: false, reason: "own" };
  if (referee.referredBy) return { applied: false, reason: "already" };
  if (referee.role !== "OWNER") return { applied: false, reason: "not_eligible" };
  if (Date.now() - referee.createdAt.getTime() > REDEEM_WINDOW_DAYS * 86_400_000) {
    return { applied: false, reason: "not_eligible" };
  }
  const walked = await db.walk.count({ where: { ownerId: referee.id, status: "COMPLETED" } });
  if (walked > 0) return { applied: false, reason: "not_eligible" };

  try {
    const ref = await db.referral.create({
      data: { referrerId: referrer.id, refereeId: referee.id, code },
    });
    // The referral is the channel — except for Phase-0 customers ops imported
    // (they keep "concierge" / the channel ops recorded).
    if (!referee.importedAt) {
      await db.user.update({ where: { id: referee.id }, data: { acquisitionChannel: "referral" } });
    }
    return { applied: true, referralId: ref.id };
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return { applied: false, reason: "already" };
    throw err;
  }
}

/** The (hidden, never purchasable) plan gifted walks hang off. */
async function giftPlanFor(durationMin: number) {
  const key = `${GIFT_PLAN_PREFIX}${durationMin}`;
  return db.plan.upsert({
    where: { key },
    update: {},
    create: {
      key,
      name: `Paseo de regalo (${durationMin} min)`,
      walks: 1,
      durationMin,
      priceCents: 0, // the gift's value lives on each Subscription
      periodDays: 60,
      active: false,
      sortOrder: 999,
    },
  });
}

/** Create one ACTIVE gifted walk for `ownerId`, funded from platform:marketing. */
async function grantGiftWalk(
  tx: Prisma.TransactionClient,
  input: { ownerId: string; planId: string; durationMin: number; valueCents: number; validDays: number; referralId: string; memo: string; at: Date }
): Promise<Subscription> {
  const sub = await tx.subscription.create({
    data: {
      ownerId: input.ownerId,
      planId: input.planId,
      status: "ACTIVE",
      gift: true,
      walksTotal: 1,
      durationMin: input.durationMin,
      priceCents: input.valueCents,
      periodStart: input.at,
      periodEnd: new Date(input.at.getTime() + input.validDays * 86_400_000),
    },
  });
  await postTxn(
    [
      { account: MARKETING_ACCOUNT, debit: input.valueCents, memo: input.memo },
      { account: `plan:${sub.id}`, credit: input.valueCents, memo: "Paseo de regalo — Regalá un paseo" },
    ],
    "referral",
    input.referralId,
    input.at,
    tx
  );
  return sub;
}

/** True when a completed walk was paid for by the owner (not a gift). */
async function wasPaidWalk(
  settlement: WalkSettlement,
  payment: { subscriptionId: string | null }
): Promise<boolean> {
  if (settlement === "released" || settlement === "cash") return true;
  if (settlement !== "plan" || !payment.subscriptionId) return false;
  const sub = await db.subscription.findUnique({ where: { id: payment.subscriptionId }, select: { gift: true } });
  return !!sub && !sub.gift;
}

/**
 * Called after a walk is settled. If the owner was referred and this is
 * their first paid walk, both sides get their gifted walk. Never throws —
 * a reward problem must not break walk completion.
 */
export async function rewardReferralIfDue(input: {
  ownerId: string;
  walkId: string;
  settlement: WalkSettlement;
  payment: { subscriptionId: string | null };
  at?: Date;
}): Promise<"rewarded" | "skipped"> {
  try {
    const referral = await db.referral.findUnique({
      where: { refereeId: input.ownerId },
      include: { referee: { select: { name: true } }, referrer: { select: { id: true, name: true, role: true } } },
    });
    if (!referral || referral.status !== "PENDING") return "skipped";
    if (!(await wasPaidWalk(input.settlement, input.payment))) return "skipped";

    const cfg = await getAppConfig();
    if (!cfg.referrals.enabled) return "skipped";
    const at = input.at ?? new Date();
    const durationMin = [30, 45, 60].includes(cfg.referrals.giftDurationMin) ? cfg.referrals.giftDurationMin : 30;
    const valueCents = priceBandForDuration(cfg, durationMin);
    const validDays = Math.max(1, cfg.referrals.giftValidDays || 60);
    if (valueCents <= 0) return "skipped";
    const plan = await giftPlanFor(durationMin);

    const out = await db.$transaction(async (tx) => {
      // Claim it first so two completions can never reward twice.
      const claimed = await tx.referral.updateMany({
        where: { id: referral.id, status: "PENDING" },
        data: { status: "REWARDED", rewardedAt: at, rewardWalkId: input.walkId, rewardCents: valueCents },
      });
      if (claimed.count === 0) return null;

      const refereeGift = await grantGiftWalk(tx, {
        ownerId: input.ownerId,
        planId: plan.id,
        durationMin,
        valueCents,
        validDays,
        referralId: referral.id,
        memo: "Regalá un paseo — premio de bienvenida",
        at,
      });

      const already = await tx.referral.count({
        where: { referrerId: referral.referrerId, referrerRewarded: true },
      });
      let referrerGift: Subscription | null = null;
      if (referral.referrer.role === "OWNER" && already < cfg.referrals.maxRewardsPerReferrer) {
        referrerGift = await grantGiftWalk(tx, {
          ownerId: referral.referrerId,
          planId: plan.id,
          durationMin,
          valueCents,
          validDays,
          referralId: referral.id,
          memo: `Regalá un paseo — invitaste a ${referral.referee.name}`,
          at,
        });
      }
      await tx.referral.update({
        where: { id: referral.id },
        data: {
          refereeGiftId: refereeGift.id,
          referrerGiftId: referrerGift?.id ?? null,
          referrerRewarded: !!referrerGift,
        },
      });
      return { referrerRewarded: !!referrerGift };
    });
    if (!out) return "skipped";

    await notify(
      input.ownerId,
      "PAYMENT",
      "¡Tienes un paseo de regalo! 🎁",
      `Gracias por pasear con FiruWalk. Tu próximo paseo de ${durationMin} min va por nuestra cuenta (válido ${validDays} días). Elige "Plan" al reservar.`,
      "home"
    );
    if (out.referrerRewarded) {
      const friend = referral.referee.name.split(" ")[0] || "Tu amigo";
      await notify(
        referral.referrerId,
        "PAYMENT",
        "¡Ganaste un paseo de regalo! 🎁",
        `${friend} completó su primer paseo con tu código. Tu próximo paseo de ${durationMin} min va por nuestra cuenta (válido ${validDays} días).`,
        "home"
      );
    }
    return "rewarded";
  } catch (err) {
    log.error("referrals.reward_failed", { err, ownerId: input.ownerId, walkId: input.walkId });
    return "skipped";
  }
}
