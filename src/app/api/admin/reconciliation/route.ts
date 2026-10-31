// GET  /api/admin/reconciliation → { runs, issues, ledger } for Admin → Pagos
// POST /api/admin/reconciliation {day?: "YYYY-MM-DD"} → run reconciliation for
//      that Bolivian day (default: yesterday) now.

import { db } from "@/lib/db";
import { ApiError, ok, optStr, readJson, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { ledgerTotals } from "@/lib/server/ledger";
import { boDayWindow, runReconciliation } from "@/lib/server/payments/reconcile";
import { paymentProviderName } from "@/lib/server/payments";
import { reconIssueOf, reconRunOf } from "@/lib/server/serialize";

export async function GET(req: Request) {
  return run(async () => {
    await requireAdmin(req);
    const [runs, open, resolved, totals] = await Promise.all([
      db.reconciliationRun.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
      db.reconciliationIssue.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 200 }),
      db.reconciliationIssue.findMany({ where: { status: "RESOLVED" }, orderBy: { resolvedAt: "desc" }, take: 20 }),
      ledgerTotals(),
    ]);
    return ok({
      provider: paymentProviderName(),
      runs: runs.map(reconRunOf),
      issues: [...open, ...resolved].map(reconIssueOf),
      ledger: {
        debitCents: totals.debitCents,
        creditCents: totals.creditCents,
        balanced: totals.debitCents === totals.creditCents && totals.unbalancedTxns.length === 0,
      },
    });
  });
}

export async function POST(req: Request) {
  return run(async () => {
    const admin = await requireAdmin(req);
    const body = await readJson(req);
    const day = optStr(body, "day");
    let window = boDayWindow(1);
    if (day) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new ApiError(400, "La fecha es inválida (AAAA-MM-DD).");
      const from = new Date(`${day}T04:00:00.000Z`); // 00:00 in Bolivia
      if (Number.isNaN(from.getTime()) || from.getTime() > Date.now()) {
        throw new ApiError(400, "La fecha es inválida.");
      }
      window = { from, to: new Date(from.getTime() + 86_400_000) };
    }
    const result = await runReconciliation({ ...window, triggeredBy: admin.id });
    await db.auditLog.create({
      data: {
        actorId: admin.id,
        action: "RECONCILIATION_RUN",
        entity: "reconciliationRun",
        entityId: result.runId,
        detail: `${window.from.toISOString()} → ${window.to.toISOString()}: ${result.issues} diferencias`,
      },
    });
    return ok(result);
  });
}
