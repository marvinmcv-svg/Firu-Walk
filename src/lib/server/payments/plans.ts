// Monthly plans: an owner buys N walks up front (QR), the money sits in
// ledger account `plan:{subscriptionId}` and one walk's worth is released to
// the walker per completed walk. At period end the unused balance follows
// Config plans.unusedWalkPolicy ("forfeit" → platform, "credit" → owner).

import type { Plan, Prisma, Subscription } from "@prisma/client";
import { db } from "@/lib/db";
import { formatBOB, priceBreakdown } from "@/lib/firu/money";
import type { AppConfig, PlanDTO, SubscriptionDTO } from "@/lib/firu/types";
import { getAppConfig } from "../config";
import { ApiError } from "../http";
import { accountBalance, postTxn, type DbClient } from "../ledger";
import { notify, notifyEvent } from "../notify";
import { paymentOf } from "../serialize";

export function planOf(p: Plan, cfg: AppConfig): PlanDTO {
  const b = priceBreakdown(p.priceCents, cfg.fees.ownerFeePct);
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    walks: p.walks,
    durationMin: p.durationMin,
    priceCents: p.priceCents,
    periodDays: p.periodDays,
    active: p.active,
    perWalkCents: Math.floor(p.priceCents / p.walks),
    ownerFeeCents: b.ownerFeeCents,
    totalCents: b.totalCents,
  };
}

export const subscriptionInclude = {
  plan: true,
  payments: { where: { purpose: "PLAN" }, orderBy: { createdAt: "desc" }, take: 1 },
} satisfies Prisma.SubscriptionInclude;

type FullSubscription = Prisma.SubscriptionGetPayload<{ include: typeof subscriptionInclude }>;

export function subscriptionOf(s: FullSubscription, cfg: AppConfig): SubscriptionDTO {
  const payment = s.payments[0];
  return {
    id: s.id,
    status: s.status,
    plan: planOf(s.plan, cfg),
    walksTotal: s.walksTotal,
    walksUsed: s.walksUsed,
    walksLeft: s.walksTotal - s.walksUsed,
    durationMin: s.durationMin,
    priceCents: s.priceCents,
    periodStart: s.periodStart?.toISOString() ?? null,
    periodEnd: s.periodEnd?.toISOString() ?? null,
    payment: payment ? paymentOf(payment) : null,
    createdAt: s.createdAt.toISOString(),
  };
}

/** Start a plan purchase: PENDING_PAYMENT subscription + PENDING QR payment. */
export async function startPlanPurchase(ownerId: string, planId: string): Promise<FullSubscription> {
  const cfg = await getAppConfig();
  const plan = await db.plan.findUnique({ where: { id: planId } });
  if (!plan || !plan.active) throw new ApiError(404, "Ese plan no está disponible.");

  // Re-opening the checkout of the same plan reuses the unpaid purchase.
  const open = await db.subscription.findFirst({
    where: { ownerId, planId, status: "PENDING_PAYMENT" },
    include: subscriptionInclude,
  });
  if (open) return open;

  const b = priceBreakdown(plan.priceCents, cfg.fees.ownerFeePct);
  const sub = await db.subscription.create({
    data: {
      ownerId,
      planId,
      walksTotal: plan.walks,
      durationMin: plan.durationMin,
      priceCents: plan.priceCents,
      payments: {
        create: {
          purpose: "PLAN",
          ownerId,
          method: "QR",
          amountCents: b.totalCents,
          ownerFeeCents: b.ownerFeeCents,
        },
      },
    },
    include: subscriptionInclude,
  });
  return sub;
}

/** The owner's usable subscription for a walk of `durationMin`, if any. */
export async function usableSubscription(
  ownerId: string,
  subscriptionId: string,
  durationMin: number
): Promise<Subscription> {
  const sub = await db.subscription.findUnique({ where: { id: subscriptionId } });
  if (!sub || sub.ownerId !== ownerId) throw new ApiError(404, "Plan no encontrado.");
  if (sub.status !== "ACTIVE" || (sub.periodEnd && sub.periodEnd <= new Date())) {
    throw new ApiError(400, "Tu plan no está activo.");
  }
  if (sub.walksUsed >= sub.walksTotal) throw new ApiError(400, "Ya usaste todos los paseos de tu plan.");
  if (sub.durationMin !== durationMin) {
    throw new ApiError(400, `Tu plan cubre paseos de ${sub.durationMin} min.`);
  }
  return sub;
}

/**
 * Value of the next walk drawn from a plan: the remaining balance spread over
 * the remaining walks (the last walk takes any rounding remainder).
 */
export async function nextPlanWalkValue(sub: Subscription, client: DbClient = db): Promise<number> {
  const left = sub.walksTotal - sub.walksUsed;
  if (left <= 0) return 0;
  const balance = await accountBalance(`plan:${sub.id}`, client);
  return left === 1 ? balance : Math.floor(balance / left);
}

/** Estimated per-walk value before the plan is used (for new PLAN payments). */
export function planWalkEstimate(sub: Subscription): number {
  return Math.floor(sub.priceCents / sub.walksTotal);
}

/**
 * Draw one walk from a plan inside `tx`: walksUsed + 1 (only while walks
 * remain and the plan is active) and return its value. null = not possible.
 */
export async function consumePlanWalk(
  tx: Prisma.TransactionClient,
  subscriptionId: string
): Promise<{ value: number; sub: Subscription } | null> {
  const sub = await tx.subscription.findUnique({ where: { id: subscriptionId } });
  if (!sub || sub.status !== "ACTIVE" || sub.walksUsed >= sub.walksTotal) return null;
  const value = await nextPlanWalkValue(sub, tx);
  const moved = await tx.subscription.updateMany({
    where: { id: sub.id, status: "ACTIVE", walksUsed: sub.walksUsed },
    data: { walksUsed: { increment: 1 } },
  });
  if (moved.count === 0) return null;
  return { value, sub };
}

/**
 * Close every ACTIVE subscription whose period ended (daily job). The
 * unused balance moves per plans.unusedWalkPolicy; the purchase payment is
 * marked RELEASED.
 */
export async function expireSubscriptions(now: Date = new Date()): Promise<number> {
  const cfg = await getAppConfig();
  const due = await db.subscription.findMany({
    where: { status: "ACTIVE", periodEnd: { lte: now } },
    include: { plan: true },
  });
  let closed = 0;
  for (const sub of due) {
    const credit = cfg.plans.unusedWalkPolicy === "credit";
    const left = sub.walksTotal - sub.walksUsed;
    const remaining = await db.$transaction(async (tx) => {
      const moved = await tx.subscription.updateMany({
        where: { id: sub.id, status: "ACTIVE" },
        data: {
          status: "EXPIRED",
          closedAt: now,
          closeNote: left > 0 ? `${left} paseos sin usar (${credit ? "crédito" : "vencidos"})` : null,
        },
      });
      if (moved.count === 0) return null;
      const balance = await accountBalance(`plan:${sub.id}`, tx);
      if (balance > 0) {
        await postTxn(
          [
            { account: `plan:${sub.id}`, debit: balance, memo: `Cierre del plan — ${left} paseos sin usar` },
            credit
              ? { account: `owner:${sub.ownerId}`, credit: balance, memo: `Crédito por paseos no usados (${sub.plan.name})` }
              : { account: "platform:revenue", credit: balance, memo: `Paseos vencidos — ${sub.plan.name}` },
          ],
          "subscription",
          sub.id,
          now,
          tx
        );
      }
      await tx.payment.updateMany({
        where: { subscriptionId: sub.id, purpose: "PLAN", status: "HELD" },
        data: { status: "RELEASED" },
      });
      return balance;
    });
    if (remaining === null) continue;
    closed++;
    await notify(
      sub.ownerId,
      "PAYMENT",
      "Tu plan terminó 📅",
      left > 0
        ? credit
          ? `Tu ${sub.plan.name} terminó con ${left} paseos sin usar. Te acreditamos ${formatBOB(remaining)}.`
          : `Tu ${sub.plan.name} terminó con ${left} paseos sin usar. ¡Renuévalo para seguir paseando!`
        : `Usaste los ${sub.walksTotal} paseos de tu ${sub.plan.name}. ¡Renuévalo para seguir paseando!`,
      "home"
    );
  }
  return closed;
}

/**
 * "Plan expiring" reminder: ACTIVE plans whose period ends within
 * `plans.expiryReminderDays` and still have walks left get one notification
 * per period (Subscription.expiryRemindedAt). Run daily by /api/cron/daily.
 */
export async function remindExpiringSubscriptions(now: Date = new Date()): Promise<number> {
  const cfg = await getAppConfig();
  const days = cfg.plans.expiryReminderDays;
  if (!days || days <= 0) return 0;
  const due = await db.subscription.findMany({
    where: {
      status: "ACTIVE",
      expiryRemindedAt: null,
      periodEnd: { gt: now, lte: new Date(now.getTime() + days * 86_400_000) },
    },
    include: { plan: true },
  });
  let sent = 0;
  for (const sub of due) {
    const walksLeft = sub.walksTotal - sub.walksUsed;
    if (walksLeft <= 0 || !sub.periodEnd) continue;
    // Claim first so two concurrent runs cannot both send it.
    const claimed = await db.subscription.updateMany({
      where: { id: sub.id, expiryRemindedAt: null },
      data: { expiryRemindedAt: now },
    });
    if (claimed.count === 0) continue;
    await notifyEvent(sub.ownerId, "plan_expiring", {
      planName: sub.plan.name,
      periodEnd: sub.periodEnd,
      walksLeft,
    });
    sent++;
  }
  return sent;
}
