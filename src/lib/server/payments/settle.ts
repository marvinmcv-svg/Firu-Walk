// Settlement — moving a walk's money to the walker once it happens.
//
// Split of one walk payment (integer centavos):
//   available    = amountCents − refundedCents
//   walkerBase   = (amountCents − ownerFeeCents) − refundedCents   (≥ 0)
//   commission   = round(walkerBase × commissionPct)
//   walker  net  = walkerBase − commission
//   platform     = commission + (available − walkerBase)  ← owner service fee
// Refunds come out of the walk price first, the service fee last.

import type { Payment } from "@prisma/client";
import { db } from "@/lib/db";
import { formatBOB } from "@/lib/firu/money";
import type { AppConfig } from "@/lib/firu/types";
import { postTxn, type TxnEntry } from "../ledger";
import { notify } from "../notify";
import { consumePlanWalk } from "./plans";
import { sendRefund } from "./service";

export function walkSplit(
  p: Pick<Payment, "amountCents" | "ownerFeeCents" | "refundedCents">,
  commissionPct: number
): { available: number; netCents: number; platformCents: number; commissionCents: number } {
  const available = p.amountCents - p.refundedCents;
  const walkerBase = Math.max(0, p.amountCents - p.ownerFeeCents - p.refundedCents);
  const commissionCents = Math.round((walkerBase * commissionPct) / 100);
  return {
    available,
    commissionCents,
    netCents: walkerBase - commissionCents,
    platformCents: available - walkerBase + commissionCents,
  };
}

export type WalkSettlement = "released" | "cash" | "plan" | "unpaid" | "none";

/**
 * Settle the payment of a completed walk:
 *   QR/TRANSFER HELD → platform:held to walker (net) + platform:revenue
 *   PLAN HELD        → one walk drawn from plan:{id}
 *   CASH PENDING     → walker owes commission + service fee (wallet debit)
 *   QR/TRANSFER PENDING → nothing moves; the owner is reminded to pay
 */
export async function settleCompletedWalk(input: {
  payment: Payment;
  walk: { id: string; walkerId: string; ownerId: string };
  dogName: string;
  cfg: AppConfig;
  at: Date;
}): Promise<WalkSettlement> {
  const { payment, walk, dogName, cfg, at } = input;
  const pct = cfg.fees.commissionPct;

  if (payment.method === "PLAN" && payment.status === "HELD" && payment.subscriptionId) {
    const subscriptionId = payment.subscriptionId;
    const drawn = await db.$transaction(async (tx) => {
      const took = await consumePlanWalk(tx, subscriptionId);
      if (!took) return null;
      const valued = { amountCents: took.value, ownerFeeCents: 0, refundedCents: 0 };
      const split = walkSplit(valued, pct);
      await postTxn(
        [
          { account: `plan:${subscriptionId}`, debit: took.value, memo: `Paseo del plan (${took.sub.walksUsed + 1}/${took.sub.walksTotal}) — ${dogName}` },
          { account: `walker:${walk.walkerId}`, credit: split.netCents, memo: `Ingreso neto paseo de ${dogName} — plan (comisión ${pct}%)` },
          { account: "platform:revenue", credit: split.platformCents, memo: `Comisión ${pct}% — paseo de plan` },
        ],
        "walk",
        walk.id,
        at,
        tx
      );
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: "RELEASED", amountCents: took.value, walkerId: walk.walkerId },
      });
      return took;
    });
    if (drawn) return "plan";
    // Plan used up or expired meanwhile: this walk is paid like a normal one.
    const booking = payment.bookingId
      ? await db.booking.findUnique({ where: { id: payment.bookingId } })
      : null;
    const base = booking?.pricePerWalkCents ?? payment.amountCents;
    const fee = Math.round((base * cfg.fees.ownerFeePct) / 100);
    await db.payment.update({
      where: { id: payment.id },
      data: { method: "QR", status: "PENDING", amountCents: base + fee, ownerFeeCents: fee, subscriptionId: null },
    });
    await notify(
      walk.ownerId,
      "PAYMENT",
      "Tu plan ya no cubre este paseo ⏳",
      `El paseo de ${dogName} terminó, pero tu plan no tiene paseos disponibles. Págalo con QR (${formatBOB(base + fee)}) desde Reservas.`,
      "bookings"
    );
    return "unpaid";
  }

  if ((payment.method === "QR" || payment.method === "TRANSFER") && payment.status === "HELD") {
    const split = walkSplit(payment, pct);
    const moved = await db.$transaction(async (tx) => {
      const res = await tx.payment.updateMany({
        where: { id: payment.id, status: "HELD", refundedCents: payment.refundedCents },
        data: { status: "RELEASED", walkerId: walk.walkerId },
      });
      if (res.count === 0) return false;
      if (split.available > 0) {
        await postTxn(
          [
            { account: "platform:held", debit: split.available, memo: `Liberación — paseo completado (${dogName})` },
            { account: `walker:${walk.walkerId}`, credit: split.netCents, memo: `Ingreso neto paseo de ${dogName} (comisión ${pct}%)` },
            { account: "platform:revenue", credit: split.platformCents, memo: `Comisión ${pct}%${payment.ownerFeeCents ? " + tarifa de servicio" : ""} — paseo completado` },
          ],
          "walk",
          walk.id,
          at,
          tx
        );
      }
      return true;
    });
    return moved ? "released" : "none";
  }

  if (payment.method === "CASH" && payment.status === "PENDING") {
    // Cash: the walker collected everything; the platform's part becomes walker debt.
    const split = walkSplit(payment, pct);
    await db.$transaction(async (tx) => {
      const res = await tx.payment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: { status: "CASH_SETTLED", confirmedAt: at, walkerId: walk.walkerId },
      });
      if (res.count === 0) return;
      await postTxn(
        [
          { account: `walker:${walk.walkerId}`, debit: split.platformCents, memo: `Comisión ${pct}%${payment.ownerFeeCents ? " + tarifa de servicio" : ""} — paseo pagado en efectivo (${dogName})` },
          { account: "platform:revenue", credit: split.platformCents, memo: `Comisión ${pct}% — paseo en efectivo` },
        ],
        "walk",
        walk.id,
        at,
        tx
      );
    });
    return "cash";
  }

  if ((payment.method === "QR" || payment.method === "TRANSFER") && payment.status === "PENDING") {
    await notify(
      walk.ownerId,
      "PAYMENT",
      "Pago pendiente ⏳",
      `El paseo de ${dogName} terminó, pero tu pago (${payment.method}) sigue pendiente. Págalo desde Reservas para que el paseador reciba su ingreso.`,
      "bookings"
    );
    return "unpaid";
  }
  return "none";
}

/**
 * Owner/admin cancellation of a booking's current payment.
 * Late (inside the free window, walker assigned): the walker keeps
 * lateCancelWalkerSharePct of the walk price (net of commission), the rest
 * goes back to the owner. Otherwise a full refund. Returns the walker's net
 * share (0 when none).
 */
export async function settleCancellation(input: {
  payment: Payment;
  walkerId: string | null;
  ownerId: string;
  bookingId: string;
  isLate: boolean;
  dogName: string;
  cfg: AppConfig;
  at: Date;
}): Promise<{ walkerNetCents: number; refundCents: number }> {
  const { payment, walkerId, ownerId, bookingId, isLate, dogName, cfg, at } = input;
  const pct = cfg.fees.commissionPct;
  const sharePct = cfg.policy.lateCancelWalkerSharePct;
  const late = isLate && !!walkerId;

  // Prepaid QR/TRANSFER: split what is held.
  if ((payment.method === "QR" || payment.method === "TRANSFER") && payment.status === "HELD") {
    const available = payment.amountCents - payment.refundedCents;
    const base = Math.max(0, payment.amountCents - payment.ownerFeeCents - payment.refundedCents);
    const share = late ? Math.round((base * sharePct) / 100) : 0;
    const commission = Math.round((share * pct) / 100);
    const refund = available - share;
    const entries: TxnEntry[] = [];
    if (share > 0) {
      entries.push(
        { account: "platform:held", debit: share, memo: `Cancelación tardía — parte del paseador (${dogName})` },
        { account: `walker:${walkerId}`, credit: share - commission, memo: `Compensación por cancelación tardía (comisión ${pct}%)` },
        { account: "platform:revenue", credit: commission, memo: `Comisión ${pct}% — cancelación tardía` }
      );
    }
    if (refund > 0) {
      entries.push(
        { account: "platform:held", debit: refund, memo: `Reembolso al dueño — cancelación (${dogName})` },
        { account: `owner:${ownerId}`, credit: refund, memo: `Reembolso de ${formatBOB(refund)} por cancelación` }
      );
    }
    const updated = await db.$transaction(async (tx) => {
      const res = await tx.payment.updateMany({
        where: { id: payment.id, status: "HELD", refundedCents: payment.refundedCents },
        data: { status: "REFUNDED", refundedCents: payment.refundedCents + refund },
      });
      if (res.count === 0) return null;
      if (entries.length) await postTxn(entries, "booking", bookingId, at, tx);
      return tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    });
    if (updated && refund > 0) {
      await sendRefund(updated, refund);
    }
    return { walkerNetCents: share - commission, refundCents: updated ? refund : 0 };
  }

  // Plan walk not consumed: late → the walk is used and the walker paid a share.
  if (payment.method === "PLAN" && payment.status === "HELD" && payment.subscriptionId) {
    const subscriptionId = payment.subscriptionId;
    if (!late) {
      await db.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED", refundedCents: payment.amountCents } });
      return { walkerNetCents: 0, refundCents: 0 };
    }
    const net = await db.$transaction(async (tx) => {
      const took = await consumePlanWalk(tx, subscriptionId);
      if (!took) return 0;
      const share = Math.round((took.value * sharePct) / 100);
      const commission = Math.round((share * pct) / 100);
      await postTxn(
        [
          { account: `plan:${subscriptionId}`, debit: took.value, memo: `Cancelación tardía — paseo del plan (${dogName})` },
          { account: `walker:${walkerId}`, credit: share - commission, memo: `Compensación por cancelación tardía (comisión ${pct}%)` },
          { account: "platform:revenue", credit: commission, memo: `Comisión ${pct}% — cancelación tardía` },
          { account: `owner:${ownerId}`, credit: took.value - share, memo: `Crédito por cancelación — paseo del plan` },
        ],
        "booking",
        bookingId,
        at,
        tx
      );
      await tx.payment.update({ where: { id: payment.id }, data: { status: "RELEASED", amountCents: took.value } });
      return share - commission;
    });
    return { walkerNetCents: net, refundCents: 0 };
  }

  // Cash: nothing was collected — journal the walker's late-cancel share.
  if (payment.method === "CASH" && late) {
    const base = payment.amountCents - payment.ownerFeeCents;
    const share = Math.round((base * sharePct) / 100);
    const commission = Math.round((share * pct) / 100);
    await postTxn(
      [
        { account: `owner:${ownerId}`, debit: share, memo: `Cargo por cancelación tardía (efectivo) — ${dogName}` },
        { account: `walker:${walkerId}`, credit: share - commission, memo: "Compensación por cancelación tardía (efectivo)" },
        { account: "platform:revenue", credit: commission, memo: `Comisión ${pct}% — cancelación tardía (efectivo)` },
      ],
      "booking",
      bookingId,
      at
    );
    return { walkerNetCents: share - commission, refundCents: 0 };
  }
  return { walkerNetCents: 0, refundCents: 0 };
}
