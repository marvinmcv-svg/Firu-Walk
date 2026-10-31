// GET  /api/subscriptions → SubscriptionDTO[] (owner: own; admin: latest 100)
// POST /api/subscriptions {planId} → SubscriptionDTO (owner) — starts a plan
//      purchase: PENDING_PAYMENT subscription + PENDING QR payment. The plan
//      activates when the provider confirms the payment.

import { db } from "@/lib/db";
import { ApiError, ok, readJson, reqStr, run } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { getAppConfig } from "@/lib/server/config";
import { startPlanPurchase, subscriptionInclude, subscriptionOf } from "@/lib/server/payments/plans";

export async function GET(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    if (user.role === "WALKER") throw new ApiError(403, "Los planes son para dueños.");
    const cfg = await getAppConfig();
    const subs = await db.subscription.findMany({
      where: user.role === "ADMIN" ? {} : { ownerId: user.id, status: { not: "CANCELLED" } },
      include: subscriptionInclude,
      orderBy: { createdAt: "desc" },
      take: user.role === "ADMIN" ? 100 : 20,
    });
    return ok(subs.map((s) => subscriptionOf(s, cfg)));
  });
}

export async function POST(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    if (user.role !== "OWNER") throw new ApiError(403, "Solo los dueños pueden comprar planes.");
    const body = await readJson(req);
    const planId = reqStr(body, "planId", "El plan");
    const sub = await startPlanPurchase(user.id, planId);
    return ok(subscriptionOf(sub, await getAppConfig()), { status: 201 });
  });
}
