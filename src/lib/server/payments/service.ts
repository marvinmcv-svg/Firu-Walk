// Payment service — the ONLY place a payment becomes paid.
//
//   PENDING ──(verified webhook | provider status poll | audited admin)──▶ HELD
//
// Paying posts the hold txn in the same DB transaction as the status change
// (owner → platform:held for a walk, owner → plan:{subscriptionId} for a
// plan), guarded by a conditional update so concurrent webhooks/polls can
// never post it twice.

import { Prisma, type Payment, type ReconIssueKind } from "@prisma/client";
import { db } from "@/lib/db";
import { formatBOB } from "@/lib/firu/money";
import { getAppConfig } from "../config";
import { ApiError } from "../http";
import { postTxn, type DbClient } from "../ledger";
import { log } from "../log";
import { notify, notifyAdmins, notifyEvent } from "../notify";
import { getPaymentProvider, paymentProviderName } from "./index";
import { ProviderUnavailable, WebhookRejected } from "./provider";

export type ConfirmSource = "webhook" | "poll" | "admin";

/** The provider reported a different amount than the payment asked for. */
export class AmountMismatch extends Error {
  constructor(
    public expectedCents: number,
    public actualCents: number
  ) {
    super(`amount mismatch: expected ${expectedCents}, got ${actualCents}`);
  }
}

// ---------------------------------------------------------------------
// Reconciliation issues (ops queue in Admin → Pagos)
// ---------------------------------------------------------------------

/** Open an issue unless the same one is already open. */
export async function flagIssue(
  data: {
    kind: ReconIssueKind;
    detail: string;
    paymentId?: string | null;
    providerRef?: string | null;
    expectedCents?: number | null;
    actualCents?: number | null;
    runId?: string | null;
  },
  client: DbClient = db
): Promise<boolean> {
  const existing = await client.reconciliationIssue.findFirst({
    where: {
      kind: data.kind,
      status: "OPEN",
      ...(data.paymentId ? { paymentId: data.paymentId } : data.providerRef ? { providerRef: data.providerRef } : {}),
    },
  });
  // Manual refunds are tasks, not symptoms: every one must be done.
  if (existing && data.kind !== "MANUAL_REFUND" && (data.paymentId || data.providerRef)) return false;
  await client.reconciliationIssue.create({ data });
  return true;
}

// ---------------------------------------------------------------------
// PENDING → HELD
// ---------------------------------------------------------------------

/**
 * Mark a payment paid. Idempotent: returns applied=false when it was not
 * PENDING anymore. Throws AmountMismatch if `paidCents` differs.
 */
export async function markPaid(
  paymentId: string,
  opts: { paidCents: number; source: ConfirmSource; at?: Date; method?: "QR" | "TRANSFER" }
): Promise<{ applied: boolean; payment: Payment }> {
  const at = opts.at ?? new Date();
  const result = await db.$transaction(async (tx) => {
    const p = await tx.payment.findUnique({
      where: { id: paymentId },
      include: { booking: { include: { dog: true } }, subscription: { include: { plan: true } } },
    });
    if (!p) throw new ApiError(404, "Pago no encontrado.");
    if (p.status !== "PENDING") return { applied: false, payment: p };
    if (p.method === "CASH" || p.method === "PLAN") {
      throw new ApiError(400, "Este pago no se cobra con QR ni transferencia.");
    }
    if (opts.paidCents !== p.amountCents) throw new AmountMismatch(p.amountCents, opts.paidCents);

    const moved = await tx.payment.updateMany({
      where: { id: p.id, status: "PENDING" },
      data: {
        status: "HELD",
        confirmedAt: at,
        confirmSource: opts.source,
        ...(opts.method ? { method: opts.method } : {}),
      },
    });
    if (moved.count === 0) return { applied: false, payment: p };

    const method = opts.method ?? p.method;
    const via = method === "QR" ? "QR" : "transferencia";
    if (p.purpose === "PLAN") {
      const sub = p.subscription;
      if (!sub) throw new ApiError(500, "Pago de plan sin suscripción.");
      await postTxn(
        [
          { account: `owner:${p.ownerId}`, debit: p.amountCents, memo: `Pago ${via} — ${sub.plan.name}` },
          { account: `plan:${sub.id}`, credit: sub.priceCents, memo: `Saldo prepagado — ${sub.walksTotal} paseos` },
          { account: "platform:revenue", credit: p.ownerFeeCents, memo: "Tarifa de servicio — plan" },
        ],
        "payment",
        p.id,
        at,
        tx
      );
      await tx.subscription.updateMany({
        where: { id: sub.id, status: "PENDING_PAYMENT" },
        data: {
          status: "ACTIVE",
          periodStart: at,
          periodEnd: new Date(at.getTime() + sub.plan.periodDays * 86_400_000),
        },
      });
    } else {
      await postTxn(
        [
          { account: `owner:${p.ownerId}`, debit: p.amountCents, memo: `Pago ${via} — ${p.booking?.dog?.name ?? "paseo"}` },
          { account: "platform:held", credit: p.amountCents, memo: "Retención hasta completar el paseo" },
        ],
        "payment",
        p.id,
        at,
        tx
      );
    }
    const updated = await tx.payment.findUniqueOrThrow({ where: { id: p.id } });
    return { applied: true, payment: updated, dogName: p.booking?.dog?.name, planName: p.subscription?.plan.name };
  });

  if (result.applied) {
    const p = result.payment;
    // Paid after the booking was cancelled/declined (e.g. an old QR): the
    // money arrived, so record it and give it straight back.
    if (p.bookingId) {
      const booking = await db.booking.findUnique({ where: { id: p.bookingId }, include: { dog: true } });
      if (booking && (booking.status === "CANCELLED" || booking.status === "DECLINED")) {
        await refundPayment(p, p.amountCents, {
          refType: "payment",
          refId: p.id,
          dogName: booking.dog?.name ?? "paseo",
        });
        await notify(
          p.ownerId,
          "PAYMENT",
          "Te devolvemos tu pago ↩️",
          `Recibimos ${formatBOB(p.amountCents)} por una reserva que ya no está activa, así que lo reembolsamos.`,
          "bookings"
        );
        return { applied: true, payment: (await db.payment.findUniqueOrThrow({ where: { id: p.id } })) };
      }
    }
    const bs = formatBOB(p.amountCents);
    if (p.purpose === "PLAN") {
      await notifyEvent(p.ownerId, "payment_received", {
        amountCents: p.amountCents,
        planName: ("planName" in result && result.planName) || "plan",
      });
    } else {
      const dogName = ("dogName" in result && result.dogName) || "tu perrito";
      await notifyEvent(p.ownerId, "payment_received", { amountCents: p.amountCents, dogName });
      if (p.walkerId) {
        await notify(
          p.walkerId,
          "PAYMENT",
          "Paseo prepagado ✅",
          `El pago de ${bs} del paseo de ${dogName} ya está confirmado. El dinero queda retenido hasta completar el paseo.`,
          "home"
        );
      }
    }
  }
  return { applied: result.applied, payment: result.payment };
}

// ---------------------------------------------------------------------
// QR issuing + status poll
// ---------------------------------------------------------------------

/** Keep a QR that still has this much life; otherwise issue a fresh one. */
const QR_MIN_REMAINING_MS = 60_000;

/** Return a payment with a live QR (issues or renews it with the provider). */
export async function ensureQr(paymentId: string): Promise<Payment> {
  let p = await db.payment.findUnique({ where: { id: paymentId } });
  if (!p) throw new ApiError(404, "Pago no encontrado.");
  if (p.status !== "PENDING") return p;
  if (p.method !== "QR") throw new ApiError(400, "Este pago no es con QR.");

  const providerName = paymentProviderName();
  if (
    p.providerRef &&
    p.provider === providerName &&
    p.qrExpiresAt &&
    p.qrExpiresAt.getTime() - Date.now() > QR_MIN_REMAINING_MS
  ) {
    return p;
  }
  // The old QR may have been paid in the meantime: ask before replacing it.
  if (p.providerRef) {
    p = await pollPayment(p);
    if (p.status !== "PENDING") return p;
  }

  let provider;
  try {
    provider = getPaymentProvider(providerName);
  } catch (err) {
    if (err instanceof ProviderUnavailable) {
      log.warn("payments.provider_unavailable", { err: err.message });
      throw new ApiError(503, "El pago con QR no está disponible por el momento. Elige transferencia o efectivo.");
    }
    throw err;
  }
  const cfg = await getAppConfig();
  const expiresAt = new Date(Date.now() + cfg.payments.qrExpiryMinutes * 60_000);
  let qr;
  try {
    // Reference is unique per QR and still names the payment it belongs to.
    qr = await provider.createQr(p.amountCents, `${p.id}.${Date.now().toString(36)}`, expiresAt);
  } catch (err) {
    if (err instanceof ProviderUnavailable) {
      log.warn("payments.provider_unavailable", { err: err.message });
      throw new ApiError(503, "El pago con QR no está disponible por el momento. Elige transferencia o efectivo.");
    }
    log.error("payments.create_qr_failed", { err, paymentId: p.id });
    throw new ApiError(502, "No pudimos generar el QR. Intenta de nuevo en unos segundos.");
  }
  return db.payment.update({
    where: { id: p.id },
    data: {
      provider: provider.name,
      providerRef: qr.providerRef,
      qrImage: qr.qrImage,
      qrExpiresAt: qr.expiresAt,
      qrRef: `FW-${p.id.slice(-8).toUpperCase()}`,
    },
  });
}

/**
 * Ask the provider about a PENDING payment's QR and apply what it says.
 * Provider errors are logged and leave the payment unchanged.
 */
export async function pollPayment(p: Payment): Promise<Payment> {
  if (p.status !== "PENDING" || !p.providerRef || !p.provider) return p;
  let state;
  try {
    state = await getPaymentProvider(p.provider).getStatus(p.providerRef);
  } catch (err) {
    log.warn("payments.poll_failed", { paymentId: p.id, err: err instanceof Error ? err.message : String(err) });
    return p;
  }
  if (state.status !== "PAID" || state.paidCents === undefined) return p;
  try {
    const res = await markPaid(p.id, { paidCents: state.paidCents, source: "poll", at: state.paidAt, method: "QR" });
    return res.payment;
  } catch (err) {
    if (err instanceof AmountMismatch) {
      await flagIssue({
        kind: "AMOUNT_MISMATCH",
        paymentId: p.id,
        providerRef: p.providerRef,
        expectedCents: err.expectedCents,
        actualCents: err.actualCents,
        detail: "El proveedor reporta un monto pagado distinto al del QR (consulta de estado).",
      });
      return p;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------

export type WebhookOutcome =
  | { result: "processed"; paymentId: string; applied: boolean }
  | { result: "duplicate" }
  | { result: "ignored"; reason: string };

/**
 * Verify, de-duplicate and apply one provider webhook. Throws
 * WebhookRejected (→ 401) when the request is not authentic.
 */
export async function handleWebhook(providerName: string, rawBody: string, headers: Headers): Promise<WebhookOutcome> {
  const provider = getPaymentProvider(providerName);
  const event = await provider.verifyWebhook(rawBody, headers);

  const seen = await db.paymentWebhookEvent.findUnique({
    where: { provider_eventId: { provider: provider.name, eventId: event.eventId } },
    select: { id: true },
  });
  if (seen) return { result: "duplicate" };

  let row;
  try {
    // The unique (provider, eventId) still settles a race between two deliveries.
    row = await db.paymentWebhookEvent.create({
      data: {
        provider: provider.name,
        eventId: event.eventId,
        providerRef: event.providerRef,
        payload: (event.raw ?? {}) as Prisma.InputJsonValue,
        status: "PROCESSED",
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { result: "duplicate" };
    }
    throw err;
  }

  try {
    const payment = await db.payment.findUnique({ where: { providerRef: event.providerRef } });
    if (!payment) {
      await db.paymentWebhookEvent.update({
        where: { id: row.id },
        data: { status: "IGNORED", error: "unknown reference" },
      });
      if (event.status === "PAID") {
        await flagIssue({
          kind: "UNKNOWN_REFERENCE",
          providerRef: event.providerRef,
          actualCents: event.paidCents ?? null,
          detail: "Webhook de pago para un QR que no corresponde a ningún pago de FiruWalk.",
        });
      }
      return { result: "ignored", reason: "unknown reference" };
    }
    await db.paymentWebhookEvent.update({ where: { id: row.id }, data: { paymentId: payment.id } });

    if (event.status !== "PAID" || event.paidCents === undefined) {
      await db.paymentWebhookEvent.update({
        where: { id: row.id },
        data: { status: "IGNORED", error: `status ${event.status}` },
      });
      return { result: "ignored", reason: `status ${event.status}` };
    }
    try {
      const res = await markPaid(payment.id, {
        paidCents: event.paidCents,
        source: "webhook",
        at: event.paidAt,
        method: "QR",
      });
      return { result: "processed", paymentId: payment.id, applied: res.applied };
    } catch (err) {
      if (!(err instanceof AmountMismatch)) throw err;
      await db.paymentWebhookEvent.update({
        where: { id: row.id },
        data: { status: "FAILED", error: err.message },
      });
      await flagIssue({
        kind: "AMOUNT_MISMATCH",
        paymentId: payment.id,
        providerRef: event.providerRef,
        expectedCents: err.expectedCents,
        actualCents: err.actualCents,
        detail: "El webhook reporta un monto pagado distinto al del QR. El pago quedó pendiente.",
      });
      await notifyAdmins(
        "PAYMENT",
        "Pago con monto distinto ⚠️",
        `Un QR se pagó con ${formatBOB(err.actualCents)} en vez de ${formatBOB(err.expectedCents)}. Revísalo en Pagos → Conciliación.`,
        "payments"
      );
      return { result: "ignored", reason: "amount mismatch" };
    }
  } catch (err) {
    // Not handled: forget the event so the provider's retry is processed.
    await db.paymentWebhookEvent.delete({ where: { id: row.id } }).catch(() => undefined);
    throw err;
  }
}

export { WebhookRejected };

// ---------------------------------------------------------------------
// Refunds (disputes, cancellations)
// ---------------------------------------------------------------------

/**
 * Return `cents` of a payment to the owner.
 *  - HELD walk payment: from platform:held.
 *  - RELEASED walk payment: clawed back from the walker's wallet.
 *  - PLAN walk (not consumed yet): the walk simply goes back to the plan.
 * Provider-backed payments are refunded through the provider; when it has
 * no refund API an ops task (MANUAL_REFUND) is opened instead.
 */
export async function refundPayment(
  payment: Payment,
  cents: number,
  ctx: { refType: string; refId: string; dogName: string; at?: Date }
): Promise<Payment> {
  const at = ctx.at ?? new Date();
  const available = payment.amountCents - payment.refundedCents;
  if (!Number.isInteger(cents) || cents <= 0) throw new ApiError(400, "El monto de reembolso es inválido.");
  if (cents > available) {
    throw new ApiError(400, `El reembolso supera lo pagado (disponible: ${formatBOB(available)}).`);
  }

  if (payment.method === "PLAN") {
    if (payment.status !== "HELD") {
      throw new ApiError(400, "Este paseo del plan ya fue consumido; usa un crédito en su lugar.");
    }
    return db.payment.update({
      where: { id: payment.id },
      data: { status: "REFUNDED", refundedCents: payment.amountCents },
    });
  }

  const bs = formatBOB(cents);
  let source: string;
  if ((payment.method === "QR" || payment.method === "TRANSFER") && payment.status === "HELD") {
    source = "platform:held";
  } else if (payment.status === "RELEASED" && payment.walkerId) {
    source = `walker:${payment.walkerId}`;
  } else {
    throw new ApiError(400, "El pago de esta reserva no permite reembolso en este estado.");
  }

  const refunded = payment.refundedCents + cents;
  const updated = await db.$transaction(async (tx) => {
    const moved = await tx.payment.updateMany({
      where: { id: payment.id, refundedCents: payment.refundedCents, status: payment.status },
      data: {
        refundedCents: refunded,
        ...(payment.status === "HELD" && refunded === payment.amountCents ? { status: "REFUNDED" as const } : {}),
      },
    });
    if (moved.count === 0) throw new ApiError(409, "El pago cambió mientras procesábamos el reembolso. Intenta de nuevo.");
    await postTxn(
      [
        {
          account: source,
          debit: cents,
          memo: source.startsWith("walker:") ? `Reversión por reembolso — ${ctx.dogName}` : `Reembolso — ${ctx.dogName}`,
        },
        { account: `owner:${payment.ownerId}`, credit: cents, memo: `Reembolso de ${bs}` },
      ],
      ctx.refType,
      ctx.refId,
      at,
      tx
    );
    return tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
  });

  await sendRefund(updated, cents);
  return updated;
}

/** Push a refund to the provider, or queue it for ops when that is not possible. */
export async function sendRefund(payment: Payment, cents: number): Promise<void> {
  let done = false;
  if (payment.providerRef && payment.provider) {
    try {
      done = (await getPaymentProvider(payment.provider).refund(payment.providerRef, cents)) !== null;
    } catch (err) {
      log.error("payments.refund_failed", { err, paymentId: payment.id });
    }
  }
  if (!done) {
    await flagIssue({
      kind: "MANUAL_REFUND",
      paymentId: payment.id,
      providerRef: payment.providerRef,
      expectedCents: cents,
      detail: `Devolver ${formatBOB(cents)} al dueño por transferencia (el proveedor no lo hizo automáticamente).`,
    });
  }
}
