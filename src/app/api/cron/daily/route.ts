// GET /api/cron/daily (CRON_SECRET) — 05:00 in Bolivia:
//   1. reconcile yesterday's provider settlements against the ledger
//   2. close monthly plans whose period ended (unused-walk policy)
//   3. "plan expiring" reminders (plans.expiryReminderDays before the end)

import { ok, run } from "@/lib/server/http";
import { expireSubscriptions, remindExpiringSubscriptions } from "@/lib/server/payments/plans";
import { boDayWindow, runReconciliation } from "@/lib/server/payments/reconcile";
import { requireCron } from "../auth";

export async function GET(req: Request) {
  return run(async () => {
    requireCron(req);
    const reconciliation = await runReconciliation({ ...boDayWindow(1), triggeredBy: "cron" });
    const plansClosed = await expireSubscriptions();
    const plansReminded = await remindExpiringSubscriptions();
    return ok({ reconciliation, plansClosed, plansReminded });
  });
}
