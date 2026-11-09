// GET /api/cron/daily (CRON_SECRET) — 05:00 in Bolivia:
//   1. reconcile yesterday's provider settlements against the ledger
//   2. close monthly plans whose period ended (unused-walk policy)
//   3. "plan expiring" reminders (plans.expiryReminderDays before the end)
//   4. delete FirulAI chats older than ai.retentionDays

import { ok, run } from "@/lib/server/http";
import { expireSubscriptions, remindExpiringSubscriptions } from "@/lib/server/payments/plans";
import { boDayWindow, runReconciliation } from "@/lib/server/payments/reconcile";
import { jobBody, runJob } from "@/lib/server/jobs";
import { getAppConfig } from "@/lib/server/config";
import { purgeOldConversations } from "@/lib/server/firulai/usage";
import { requireCron } from "../auth";

export async function GET(req: Request) {
  return run(async () => {
    requireCron(req);
    return ok(
      jobBody(await runJob("daily", "cron", async () => {
        const reconciliation = await runReconciliation({ ...boDayWindow(1), triggeredBy: "cron" });
        const plansClosed = await expireSubscriptions();
        const plansReminded = await remindExpiringSubscriptions();
        const firulaiChatsPurged = await purgeOldConversations(await getAppConfig());
        return { reconciliation, plansClosed, plansReminded, firulaiChatsPurged };
      }))
    );
  });
}
