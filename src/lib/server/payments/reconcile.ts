// Daily reconciliation: what the provider says it collected vs what our
// ledger recorded, for one window (default: yesterday in Bolivia). Every
// mismatch becomes an OPEN ReconciliationIssue in Admin → Pagos.

import { db } from "@/lib/db";
import { formatBOB } from "@/lib/firu/money";
import { ledgerTotals } from "../ledger";
import { log } from "../log";
import { notifyAdmins } from "../notify";
import { getPaymentProvider, paymentProviderName } from "./index";
import type { Settlement } from "./provider";
import { flagIssue } from "./service";

const BO_OFFSET_MS = 4 * 3_600_000; // America/La_Paz = UTC−4, no DST

/** [00:00, 24:00) of the Bolivian calendar day `daysAgo` days before `now`. */
export function boDayWindow(daysAgo: number, now: Date = new Date()): { from: Date; to: Date } {
  const local = new Date(now.getTime() - BO_OFFSET_MS);
  const midnightLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const from = new Date(midnightLocal + BO_OFFSET_MS - daysAgo * 86_400_000);
  return { from, to: new Date(from.getTime() + 86_400_000) };
}

export async function runReconciliation(opts: {
  from: Date;
  to: Date;
  triggeredBy: string;
}): Promise<{ runId: string; issues: number }> {
  const providerName = paymentProviderName();
  const run = await db.reconciliationRun.create({
    data: { provider: providerName, periodStart: opts.from, periodEnd: opts.to, triggeredBy: opts.triggeredBy },
  });
  let issues = 0;
  const flag = async (data: Parameters<typeof flagIssue>[0]) => {
    if (await flagIssue({ ...data, runId: run.id })) issues++;
  };

  // 1) Provider settlements → our payments.
  let settlements: Settlement[] = [];
  let providerOk = true;
  try {
    settlements = await getPaymentProvider(providerName).listSettlements(opts.from, opts.to);
  } catch (err) {
    providerOk = false;
    log.warn("reconcile.provider_unavailable", { err: err instanceof Error ? err.message : String(err) });
  }
  const payments = await db.payment.findMany({
    where: { providerRef: { in: settlements.map((s) => s.providerRef) } },
  });
  const byRef = new Map(payments.map((p) => [p.providerRef!, p]));
  const holds = await db.ledgerEntry.findMany({
    where: { refType: "payment", refId: { in: payments.map((p) => p.id) }, debitCents: { gt: 0 }, account: { startsWith: "owner:" } },
    select: { refId: true, debitCents: true },
  });
  const heldById = new Map<string, number>();
  for (const h of holds) heldById.set(h.refId!, (heldById.get(h.refId!) ?? 0) + h.debitCents);

  for (const s of settlements) {
    const p = byRef.get(s.providerRef);
    if (!p) {
      await flag({
        kind: "UNKNOWN_REFERENCE",
        providerRef: s.providerRef,
        actualCents: s.amountCents,
        detail: `El proveedor liquidó ${formatBOB(s.amountCents)} (ref. ${s.reference}) que no corresponde a ningún pago.`,
      });
      continue;
    }
    const recorded = heldById.get(p.id) ?? 0;
    if (recorded === 0) {
      await flag({
        kind: "SETTLED_NOT_RECORDED",
        paymentId: p.id,
        providerRef: s.providerRef,
        expectedCents: p.amountCents,
        actualCents: s.amountCents,
        detail: `El proveedor cobró ${formatBOB(s.amountCents)} pero el pago sigue ${p.status} en FiruWalk.`,
      });
    } else if (recorded !== s.amountCents) {
      await flag({
        kind: "AMOUNT_MISMATCH",
        paymentId: p.id,
        providerRef: s.providerRef,
        expectedCents: recorded,
        actualCents: s.amountCents,
        detail: `El libro registra ${formatBOB(recorded)} y el proveedor liquidó ${formatBOB(s.amountCents)}.`,
      });
    }
  }

  // 2) Our provider-backed payments confirmed in the window → settlements.
  const settledRefs = new Set(settlements.map((s) => s.providerRef));
  const recorded = await db.payment.findMany({
    where: {
      provider: providerName,
      providerRef: { not: null },
      confirmedAt: { gte: opts.from, lt: opts.to },
      status: { in: ["HELD", "RELEASED", "REFUNDED"] },
      method: "QR",
    },
  });
  if (providerOk) {
    for (const p of recorded) {
      if (settledRefs.has(p.providerRef!)) continue;
      await flag({
        kind: "RECORDED_NOT_SETTLED",
        paymentId: p.id,
        providerRef: p.providerRef,
        expectedCents: p.amountCents,
        detail: `FiruWalk registró ${formatBOB(p.amountCents)} (${p.confirmSource ?? "?"}) pero el proveedor no lo liquidó.`,
      });
    }
  }

  // 3) The ledger itself must balance.
  const totals = await ledgerTotals();
  if (totals.debitCents !== totals.creditCents || totals.unbalancedTxns.length > 0) {
    await flag({
      kind: "LEDGER_UNBALANCED",
      expectedCents: totals.debitCents,
      actualCents: totals.creditCents,
      detail: `Libro desbalanceado: Σdebe ${totals.debitCents} vs Σhaber ${totals.creditCents}; transacciones: ${totals.unbalancedTxns.slice(0, 5).join(", ") || "—"}.`,
    });
  }

  await db.reconciliationRun.update({
    where: { id: run.id },
    data: {
      settledCount: settlements.length,
      settledCents: settlements.reduce((s, x) => s + x.amountCents, 0),
      recordedCount: recorded.length,
      recordedCents: recorded.reduce((s, x) => s + x.amountCents, 0),
      issuesFound: issues,
    },
  });
  if (issues > 0) {
    await notifyAdmins(
      "PAYMENT",
      "Conciliación con diferencias ⚠️",
      `La conciliación de pagos encontró ${issues} diferencia${issues === 1 ? "" : "s"}. Revísalas en Pagos.`,
      "payments"
    );
  }
  log.info("reconcile.done", { runId: run.id, issues, settlements: settlements.length, recorded: recorded.length });
  return { runId: run.id, issues };
}
