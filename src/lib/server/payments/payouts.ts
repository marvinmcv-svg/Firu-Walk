// Weekly walker payouts.
//
//   build (cron Monday / admin) → DRAFT batch: one payout per walker whose
//     wallet ≥ payouts.minPayoutCents (full balance, walker → payout:{id}),
//     plus any payout walkers requested themselves
//   approve (admin)            → APPROVED; CSV export for the bank
//   paid (admin, bank ref)     → PAID; payout:{id} → platform:cash
// Walkers with cash debt (negative wallet) are simply not included: their
// next earnings pay the debt down first.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { formatBOB } from "@/lib/firu/money";
import type { AppConfig, PayoutBatchDTO } from "@/lib/firu/types";
import { getAppConfig } from "../config";
import { ApiError } from "../http";
import { postTxn, walletBalance } from "../ledger";
import { notify, notifyEvent } from "../notify";
import { payoutOf } from "../serialize";

export const batchInclude = { payouts: { orderBy: { amountCents: "desc" } } } satisfies Prisma.PayoutBatchInclude;
type FullBatch = Prisma.PayoutBatchGetPayload<{ include: typeof batchInclude }>;

export async function batchOf(b: FullBatch): Promise<PayoutBatchDTO> {
  const walkers = await db.user.findMany({
    where: { id: { in: b.payouts.map((p) => p.walkerId) } },
    select: { id: true, name: true },
  });
  const names = new Map(walkers.map((w) => [w.id, w.name]));
  return {
    id: b.id,
    status: b.status,
    periodStart: b.periodStart.toISOString(),
    periodEnd: b.periodEnd.toISOString(),
    totalCents: b.totalCents,
    reference: b.reference,
    approvedAt: b.approvedAt?.toISOString() ?? null,
    paidAt: b.paidAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
    payouts: b.payouts.map((p) => payoutOf(p, names.get(p.walkerId) ?? null)),
  };
}

/** "BNB · 1234567 · Ana Pérez" — the destination snapshot stored on the payout. */
export function destinationOf(w: {
  payoutMethod: string | null;
  payoutBank: string | null;
  payoutAccount: string | null;
  payoutHolder: string | null;
}): string | null {
  if (!w.payoutAccount) return null;
  return [w.payoutMethod === "QR" ? "QR" : w.payoutBank, w.payoutAccount, w.payoutHolder]
    .filter(Boolean)
    .join(" · ");
}

/** Create a payout for `amount` out of the walker's wallet (ledger + row). */
export async function createPayout(
  walkerId: string,
  amount: number,
  opts: { method: "QR" | "BANK"; destRef?: string | null; batchId?: string | null; memo: string }
) {
  return db.$transaction(async (tx) => {
    const balance = await walletBalance(walkerId, tx);
    if (amount > balance) {
      throw new ApiError(400, `No tienes saldo suficiente (disponible: ${formatBOB(balance)}).`);
    }
    const payout = await tx.payout.create({
      data: {
        walkerId,
        amountCents: amount,
        method: opts.method,
        status: "REQUESTED",
        destRef: opts.destRef ?? null,
        batchId: opts.batchId ?? null,
      },
    });
    await postTxn(
      [
        { account: `walker:${walkerId}`, debit: amount, memo: opts.memo },
        { account: `payout:${payout.id}`, credit: amount, memo: "En proceso de pago" },
      ],
      "payout",
      payout.id,
      new Date(),
      tx
    );
    return payout;
  });
}

async function refreshTotal(batchId: string): Promise<void> {
  const agg = await db.payout.aggregate({
    where: { batchId, status: { not: "CANCELLED" } },
    _sum: { amountCents: true },
  });
  await db.payoutBatch.update({ where: { id: batchId }, data: { totalCents: agg._sum.amountCents ?? 0 } });
}

/**
 * Build this week's DRAFT batch (or return the open one). Sweeps every
 * walker wallet ≥ the minimum into a payout and attaches loose requests.
 */
export async function buildPayoutBatch(actorId: string | null, now: Date = new Date(), cfg?: AppConfig): Promise<FullBatch> {
  const config = cfg ?? (await getAppConfig());
  const open = await db.payoutBatch.findFirst({ where: { status: { in: ["DRAFT", "APPROVED"] } } });
  if (open) {
    throw new ApiError(409, "Ya hay un lote de pagos abierto. Págalo antes de crear otro.");
  }
  const batch = await db.payoutBatch.create({
    data: {
      periodStart: new Date(now.getTime() - 7 * 86_400_000),
      periodEnd: now,
      createdById: actorId,
    },
  });

  const walkers = await db.walkerProfile.findMany({
    where: { status: { in: ["ACTIVE", "SUSPENDED"] } },
    select: { userId: true, payoutMethod: true, payoutBank: true, payoutAccount: true, payoutHolder: true },
  });
  for (const w of walkers) {
    const balance = await walletBalance(w.userId);
    if (balance < config.payouts.minPayoutCents) continue;
    await createPayout(w.userId, balance, {
      method: w.payoutMethod ?? "BANK",
      destRef: destinationOf(w),
      batchId: batch.id,
      memo: "Pago semanal",
    });
  }

  // Requests walkers made themselves since the last batch.
  const loose = await db.payout.findMany({ where: { status: "REQUESTED", batchId: null } });
  for (const p of loose) {
    const w = walkers.find((x) => x.userId === p.walkerId);
    await db.payout.update({
      where: { id: p.id },
      data: { batchId: batch.id, destRef: p.destRef ?? (w ? destinationOf(w) : null) },
    });
  }
  await refreshTotal(batch.id);
  return db.payoutBatch.findUniqueOrThrow({ where: { id: batch.id }, include: batchInclude });
}

export async function approveBatch(batchId: string, adminId: string): Promise<FullBatch> {
  const moved = await db.payoutBatch.updateMany({
    where: { id: batchId, status: "DRAFT" },
    data: { status: "APPROVED", approvedById: adminId, approvedAt: new Date() },
  });
  if (moved.count === 0) throw new ApiError(400, "Solo se puede aprobar un lote en borrador.");
  await db.payout.updateMany({ where: { batchId, status: "REQUESTED" }, data: { status: "APPROVED" } });
  await refreshTotal(batchId);
  await db.auditLog.create({
    data: { actorId: adminId, action: "PAYOUT_BATCH_APPROVED", entity: "payoutBatch", entityId: batchId },
  });
  return db.payoutBatch.findUniqueOrThrow({ where: { id: batchId }, include: batchInclude });
}

/** Mark one payout PAID with the bank reference (ledger + notify). */
export async function markPayoutPaid(payoutId: string, reference: string, adminId: string, at: Date = new Date()) {
  const payout = await db.payout.findUnique({ where: { id: payoutId } });
  if (!payout) throw new ApiError(404, "Pago no encontrado.");
  if (payout.status !== "REQUESTED" && payout.status !== "APPROVED") {
    throw new ApiError(400, "Este pago ya fue procesado.");
  }
  const walker = await db.user.findUnique({ where: { id: payout.walkerId }, select: { name: true } });
  const updated = await db.$transaction(async (tx) => {
    const res = await tx.payout.updateMany({
      where: { id: payout.id, status: payout.status },
      data: { status: "PAID", paidAt: at, reference },
    });
    if (res.count === 0) throw new ApiError(409, "Este pago ya fue procesado.");
    await postTxn(
      [
        { account: `payout:${payout.id}`, debit: payout.amountCents, memo: `Pago enviado (${payout.method}) — ref. ${reference}` },
        { account: "platform:cash", credit: payout.amountCents, memo: `Salida a ${walker?.name ?? "paseador"}` },
      ],
      "payout",
      payout.id,
      at,
      tx
    );
    return tx.payout.findUniqueOrThrow({ where: { id: payout.id } });
  });
  await db.auditLog.create({
    data: {
      actorId: adminId,
      action: "PAYOUT_PAID",
      entity: "payout",
      entityId: payout.id,
      detail: `${formatBOB(payout.amountCents)} vía ${payout.method} — ref. ${reference}`,
    },
  });
  await notifyEvent(payout.walkerId, "payout_sent", {
    amountCents: payout.amountCents,
    method: payout.method,
    reference,
  });
  return updated;
}

/** Pay every APPROVED payout of a batch with one bank reference (or per-payout refs). */
export async function markBatchPaid(
  batchId: string,
  adminId: string,
  reference: string,
  perPayout: Record<string, string> = {}
): Promise<FullBatch> {
  const batch = await db.payoutBatch.findUnique({ where: { id: batchId }, include: batchInclude });
  if (!batch) throw new ApiError(404, "Lote no encontrado.");
  if (batch.status !== "APPROVED") throw new ApiError(400, "Primero aprueba el lote.");
  const now = new Date();
  for (const p of batch.payouts) {
    if (p.status !== "APPROVED") continue;
    await markPayoutPaid(p.id, perPayout[p.id]?.trim() || reference, adminId, now);
  }
  await db.payoutBatch.update({
    where: { id: batchId },
    data: { status: "PAID", paidAt: now, reference },
  });
  await db.auditLog.create({
    data: { actorId: adminId, action: "PAYOUT_BATCH_PAID", entity: "payoutBatch", entityId: batchId, detail: reference },
  });
  return db.payoutBatch.findUniqueOrThrow({ where: { id: batchId }, include: batchInclude });
}

/** Cancel an unpaid payout: money returns to the wallet; batch total updated. */
export async function cancelPayout(payoutId: string, adminId: string, reason?: string | null) {
  const payout = await db.payout.findUnique({ where: { id: payoutId }, include: { batch: true } });
  if (!payout) throw new ApiError(404, "Pago no encontrado.");
  if (payout.status !== "REQUESTED" && payout.status !== "APPROVED") {
    throw new ApiError(400, "Este pago ya fue procesado.");
  }
  const updated = await db.$transaction(async (tx) => {
    const res = await tx.payout.updateMany({
      where: { id: payout.id, status: payout.status },
      data: { status: "CANCELLED" },
    });
    if (res.count === 0) throw new ApiError(409, "Este pago ya fue procesado.");
    await postTxn(
      [
        { account: `payout:${payout.id}`, debit: payout.amountCents, memo: "Solicitud cancelada — devuelve a billetera" },
        { account: `walker:${payout.walkerId}`, credit: payout.amountCents, memo: "Retiro cancelado por el equipo — saldo restituido" },
      ],
      "payout",
      payout.id,
      new Date(),
      tx
    );
    return tx.payout.findUniqueOrThrow({ where: { id: payout.id } });
  });
  if (payout.batchId) await refreshTotal(payout.batchId);
  await db.auditLog.create({
    data: {
      actorId: adminId,
      action: "PAYOUT_CANCELLED",
      entity: "payout",
      entityId: payout.id,
      detail: `${formatBOB(payout.amountCents)}${reason ? ` — ${reason}` : ""}`,
    },
  });
  await notify(
    payout.walkerId,
    "PAYOUT",
    "Retiro cancelado",
    `Cancelamos tu pago de ${formatBOB(payout.amountCents)}${reason ? `: «${reason}»` : "."} El saldo volvió a tu billetera.`,
    "earnings"
  );
  return updated;
}

/** Bank-transfer CSV for a batch (one row per payout still to be paid). */
export async function batchCsv(batchId: string): Promise<string> {
  const batch = await db.payoutBatch.findUnique({ where: { id: batchId }, include: batchInclude });
  if (!batch) throw new ApiError(404, "Lote no encontrado.");
  const users = await db.user.findMany({
    where: { id: { in: batch.payouts.map((p) => p.walkerId) } },
    include: { walker: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Leading = + - @ would run as a formula in Excel/Sheets.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const rows = [
    ["payout_id", "paseador", "telefono", "metodo", "banco", "cuenta", "titular", "monto_bs", "estado", "referencia"],
  ];
  for (const p of batch.payouts) {
    if (p.status === "CANCELLED") continue;
    const u = byId.get(p.walkerId);
    rows.push([
      p.id,
      u?.name ?? "",
      u?.phone ?? "",
      p.method,
      u?.walker?.payoutBank ?? "",
      u?.walker?.payoutAccount ?? "",
      u?.walker?.payoutHolder ?? "",
      (p.amountCents / 100).toFixed(2),
      p.status,
      p.reference ?? "",
    ]);
  }
  return rows.map((r) => r.map(esc).join(",")).join("\n") + "\n";
}
