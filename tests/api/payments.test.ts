/// <reference types="bun-types" />
// Milestone 5 — payments with the MockProvider end to end: QR → signed
// webhook (idempotent) / status poll → HELD, owner service fee, settlement,
// refund via dispute, monthly plans, reconciliation, weekly payout batch,
// cash-debt block — and the ledger balances after all of it.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import * as bookingsRoute from "@/app/api/bookings/route";
import * as bookingRoute from "@/app/api/bookings/[id]/route";
import * as walkRoute from "@/app/api/walks/[id]/route";
import * as paymentsRoute from "@/app/api/payments/route";
import * as paymentRoute from "@/app/api/payments/[id]/route";
import * as qrRoute from "@/app/api/payments/[id]/qr/route";
import * as confirmRoute from "@/app/api/payments/[id]/confirm/route";
import * as webhookRoute from "@/app/api/payments/webhook/[provider]/route";
import * as mockPayRoute from "@/app/api/payments/mock/pay/route";
import * as disputesRoute from "@/app/api/disputes/route";
import * as disputeRoute from "@/app/api/disputes/[id]/route";
import * as subscriptionsRoute from "@/app/api/subscriptions/route";
import * as plansRoute from "@/app/api/plans/route";
import * as reconRoute from "@/app/api/admin/reconciliation/route";
import * as reconIssueRoute from "@/app/api/admin/reconciliation/[id]/route";
import * as batchesRoute from "@/app/api/admin/payout-batches/route";
import * as batchRoute from "@/app/api/admin/payout-batches/[id]/route";
import * as batchCsvRoute from "@/app/api/admin/payout-batches/[id]/csv/route";
import * as payoutsRoute from "@/app/api/payouts/route";
import * as walletRoute from "@/app/api/wallet/route";
import * as depositRoute from "@/app/api/admin/walkers/[id]/deposit/route";
import * as matchRoute from "@/app/api/walkers/match/route";
import * as cronDaily from "@/app/api/cron/daily/route";
import { updateConfigSection, getAppConfig } from "@/lib/server/config";
import { accountBalance, ledgerTotals, postTxn, walletBalance } from "@/lib/server/ledger";
import { MOCK_SIGNATURE_HEADER, MockProvider } from "@/lib/server/payments/mockProvider";
import { expireSubscriptions } from "@/lib/server/payments/plans";
import { runReconciliation } from "@/lib/server/payments/reconcile";
import { walkSplit } from "@/lib/server/payments/settle";
import { setRealtimePublisherForTests } from "@/lib/server/realtime";
import { call, cookieFor, PHONES, userId } from "./helpers";

type H = Parameters<typeof call>[0];
const mock = new MockProvider();
const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};
let originalFees: Awaited<ReturnType<typeof getAppConfig>>["fees"];
let originalPayouts: Awaited<ReturnType<typeof getAppConfig>>["payouts"];

const OWNER_FEE_PCT = 5;
const COMMISSION_PCT = 12;

/** A date YYYY-MM-DD `days` ahead (Bolivia), for one-off bookings. */
function dayAhead(days: number): string {
  return new Date(Date.now() - 4 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);
}

async function deliverWebhook(rawBody: string, signature: string) {
  return call(webhookRoute.POST as unknown as H, {
    method: "POST",
    params: { provider: "mock" },
    headers: { [MOCK_SIGNATURE_HEADER]: signature, "content-type": "application/json" },
    body: JSON.parse(rawBody),
  });
}

/** Create a one-off booking for `owner` with Luis, optionally from a plan. */
async function book(owner: "ana" | "carlos", body: Record<string, unknown>) {
  const ownerUser = await db.user.findUniqueOrThrow({ where: { phone: PHONES[owner] }, include: { dogs: true } });
  const r = await call(bookingsRoute.POST as H, {
    method: "POST",
    cookie: cookies[owner],
    body: {
      dogId: ownerUser.dogs[0].id,
      zoneId: ownerUser.zoneId,
      type: "ONE_OFF",
      durationMin: 30,
      schedule: [{ date: dayAhead(2), minute: 600 }],
      preferredWalkerUserId: ids.luis,
      ...body,
    },
  });
  expect(r.status).toBe(201);
  return r.json as { id: string; payment: { id: string; amountCents: number; ownerFeeCents: number; status: string; method: string } };
}

/** Luis accepts, starts (at the owner's door) and finishes the booking's walk. */
async function walkIt(bookingId: string) {
  const accept = await call(bookingRoute.PATCH as H, {
    method: "PATCH",
    params: { id: bookingId },
    cookie: cookies.luis,
    body: { action: "accept" },
  });
  expect(accept.status).toBe(200);
  const walk = await db.walk.findFirstOrThrow({ where: { bookingId, status: "SCHEDULED" } });
  await db.walk.update({ where: { id: walk.id }, data: { scheduledStart: new Date() } });
  const owner = await db.user.findUniqueOrThrow({ where: { id: walk.ownerId } });
  const pos = { lat: owner.addressLat!, lng: owner.addressLng!, acc: 5 };
  const start = await call(walkRoute.PATCH as H, {
    method: "PATCH",
    params: { id: walk.id },
    cookie: cookies.luis,
    body: { action: "start", ...pos },
  });
  expect(start.status).toBe(200);
  const finish = await call(walkRoute.PATCH as H, {
    method: "PATCH",
    params: { id: walk.id },
    cookie: cookies.luis,
    body: { action: "finish", ...pos, report: { note: "Todo bien", pee: true, poo: true } },
  });
  expect(finish.status).toBe(200);
  return walk.id;
}

async function expectLedgerBalanced() {
  const totals = await ledgerTotals();
  expect(totals.debitCents).toBe(totals.creditCents);
  expect(totals.unbalancedTxns).toEqual([]);
}

beforeAll(async () => {
  setRealtimePublisherForTests(async () => {});
  for (const k of ["admin", "ana", "carlos", "luis", "gabriela"] as const) {
    cookies[k] = await cookieFor(PHONES[k]);
    ids[k] = await userId(PHONES[k]);
  }
  const cfg = await getAppConfig();
  originalFees = cfg.fees;
  originalPayouts = cfg.payouts;
  await updateConfigSection("fees", { ownerFeePct: OWNER_FEE_PCT, commissionPct: COMMISSION_PCT });
});

afterAll(async () => {
  await updateConfigSection("fees", { ...originalFees });
  await updateConfigSection("payouts", { ...originalPayouts });
  setRealtimePublisherForTests(null);
  // This suite pays out every wallet and spends seeded state: restore the
  // demo seed so the other suites see what they expect, in any order.
  const r = Bun.spawnSync(["bun", "prisma/seed.ts"], { env: process.env, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`reseed failed:\n${r.stderr.toString()}`);
});

describe("ledger", () => {
  test("the seeded ledger balances: Σdebit = Σcredit, every txn balanced", async () => {
    await expectLedgerBalanced();
  });

  test("the split never creates or loses a centavo", () => {
    for (const amount of [1, 99, 1575, 2099, 34000]) {
      for (const fee of [0, 1, 79, 105]) {
        for (const refunded of [0, 1, 500]) {
          if (fee > amount || refunded > amount) continue;
          const s = walkSplit({ amountCents: amount, ownerFeeCents: fee, refundedCents: refunded }, 12.5);
          expect(s.netCents + s.platformCents).toBe(amount - refunded);
          expect(s.netCents).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

describe("QR payment confirmed by the provider", () => {
  test("booking shows the fee breakdown: walk price + owner service fee", async () => {
    const b = await book("ana", { paymentMethod: "QR" });
    ids.booking1 = b.id;
    ids.payment1 = b.payment.id;
    const booking = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
    const fee = Math.round((booking.pricePerWalkCents * OWNER_FEE_PCT) / 100);
    expect(b.payment.ownerFeeCents).toBe(fee);
    expect(b.payment.amountCents).toBe(booking.pricePerWalkCents + fee);
    expect(b.payment.status).toBe("PENDING");
  });

  test("the owner gets a provider QR for the server-side amount", async () => {
    const r = await call(qrRoute.POST as H, { method: "POST", params: { id: ids.payment1 }, cookie: cookies.ana, body: { amountCents: 1 } });
    expect(r.status).toBe(200);
    expect(r.json.qrImage).toStartWith("data:image/png;base64,");
    const p = await db.payment.findUniqueOrThrow({ where: { id: ids.payment1 } });
    expect(p.provider).toBe("mock");
    const charge = await db.mockCharge.findUniqueOrThrow({ where: { providerRef: p.providerRef! } });
    expect(charge.amountCents).toBe(p.amountCents);
    // Asking again keeps the same live QR.
    const again = await call(qrRoute.POST as H, { method: "POST", params: { id: ids.payment1 }, cookie: cookies.ana, body: {} });
    expect((await db.payment.findUniqueOrThrow({ where: { id: ids.payment1 } })).providerRef).toBe(p.providerRef);
    expect(again.json.qrImage).toBe(r.json.qrImage);
  });

  test("a webhook with a bad signature is rejected and changes nothing", async () => {
    const p = await db.payment.findUniqueOrThrow({ where: { id: ids.payment1 } });
    const body = JSON.stringify({ id: "evt_forged", type: "charge.paid", data: { ref: p.providerRef, amount: p.amountCents, paid_at: new Date().toISOString() } });
    const r = await deliverWebhook(body, "sha256=" + "0".repeat(64));
    expect(r.status).toBe(401);
    expect((await db.payment.findUniqueOrThrow({ where: { id: ids.payment1 } })).status).toBe("PENDING");
  });

  test("the signed webhook moves PENDING → HELD once, even when redelivered", async () => {
    const p = await db.payment.findUniqueOrThrow({ where: { id: ids.payment1 } });
    const heldBefore = await accountBalance("platform:held");
    const { rawBody, signature } = await mock.pay(p.providerRef!);
    const first = await deliverWebhook(rawBody, signature);
    expect(first.status).toBe(200);
    expect(first.json.result).toBe("processed");
    const second = await deliverWebhook(rawBody, signature);
    expect(second.status).toBe(200);
    expect(second.json.result).toBe("duplicate");

    const after = await db.payment.findUniqueOrThrow({ where: { id: ids.payment1 } });
    expect(after.status).toBe("HELD");
    expect(after.confirmSource).toBe("webhook");
    expect(await accountBalance("platform:held")).toBe(heldBefore + p.amountCents);
    const holds = await db.ledgerEntry.count({ where: { refType: "payment", refId: p.id } });
    expect(holds).toBe(2);
    await expectLedgerBalanced();
  });

  test("a lost webhook is recovered by the status poll", async () => {
    const b = await book("carlos", { paymentMethod: "QR" });
    ids.payment2 = b.payment.id;
    await call(qrRoute.POST as H, { method: "POST", params: { id: b.payment.id }, cookie: cookies.carlos, body: {} });
    const p = await db.payment.findUniqueOrThrow({ where: { id: b.payment.id } });
    await mock.pay(p.providerRef!); // bank paid, webhook never arrives
    const r = await call(paymentRoute.GET as H, { params: { id: p.id }, cookie: cookies.carlos });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("HELD");
    expect(r.json.confirmSource).toBe("poll");
    // cleanup: free this booking
    await call(bookingRoute.PATCH as H, { method: "PATCH", params: { id: b.id }, cookie: cookies.carlos, body: { action: "cancel" } });
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("REFUNDED");
  });

  test("an underpaid QR stays PENDING and is flagged for reconciliation", async () => {
    const b = await book("carlos", { paymentMethod: "QR" });
    ids.booking3 = b.id;
    ids.payment3 = b.payment.id;
    await call(qrRoute.POST as H, { method: "POST", params: { id: b.payment.id }, cookie: cookies.carlos, body: {} });
    const p = await db.payment.findUniqueOrThrow({ where: { id: b.payment.id } });
    const { rawBody, signature } = await mock.pay(p.providerRef!, p.amountCents - 100);
    const r = await deliverWebhook(rawBody, signature);
    expect(r.status).toBe(200);
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("PENDING");
    const issue = await db.reconciliationIssue.findFirstOrThrow({ where: { paymentId: p.id, kind: "AMOUNT_MISMATCH" } });
    expect(issue.actualCents).toBe(p.amountCents - 100);
  });

  test("a webhook for a QR we never issued is ignored and flagged", async () => {
    await db.mockCharge.create({
      data: { providerRef: "mock_stranger", reference: "nope", amountCents: 1500, expiresAt: new Date(Date.now() + 60_000) },
    });
    const { rawBody, signature } = await mock.pay("mock_stranger");
    const r = await deliverWebhook(rawBody, signature);
    expect(r.json.result).toBe("ignored");
    expect(await db.reconciliationIssue.count({ where: { providerRef: "mock_stranger", kind: "UNKNOWN_REFERENCE" } })).toBe(1);
  });

  test("owners can only change the method; amounts and status come from the server", async () => {
    const r = await call(paymentsRoute.POST as H, {
      method: "POST",
      cookie: cookies.carlos,
      body: { bookingId: ids.booking3, method: "PLAN" },
    });
    expect(r.status).toBe(400);
  });

  test("admin manual reconciliation needs a reason and is audit-logged", async () => {
    const noReason = await call(confirmRoute.POST as H, { method: "POST", params: { id: ids.payment3 }, cookie: cookies.admin, body: {} });
    expect(noReason.status).toBe(400);
    const r = await call(confirmRoute.POST as H, {
      method: "POST",
      params: { id: ids.payment3 },
      cookie: cookies.admin,
      body: { reason: "Extracto BNB: el dueño completó la diferencia por transferencia", reference: "BNB-778812" },
    });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("HELD");
    expect(r.json.confirmSource).toBe("admin");
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "PAYMENT_MANUAL_CONFIRM", entityId: ids.payment3 } });
    expect(audit.actorId).toBe(ids.admin);
    expect(audit.detail).toContain("Extracto BNB");
    await expectLedgerBalanced();
  });

  test("the dev-only mock pay endpoint plays the bank through the real webhook", async () => {
    const b = await book("carlos", { paymentMethod: "QR" });
    const r = await call(mockPayRoute.POST as H, { method: "POST", cookie: cookies.carlos, body: { paymentId: b.payment.id } });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("HELD");
    expect(r.json.confirmSource).toBe("webhook");
    await call(bookingRoute.PATCH as H, { method: "PATCH", params: { id: b.id }, cookie: cookies.carlos, body: { action: "cancel" } });
  });
});

describe("settlement and refund via dispute", () => {
  test("completing the walk releases held funds: walker net, platform commission + fee", async () => {
    const p = await db.payment.findUniqueOrThrow({ where: { id: ids.payment1 } });
    const walletBefore = await walletBalance(ids.luis);
    const revenueBefore = await accountBalance("platform:revenue");
    const heldBefore = await accountBalance("platform:held");
    ids.walk1 = await walkIt(ids.booking1);

    const base = p.amountCents - p.ownerFeeCents;
    const commission = Math.round((base * COMMISSION_PCT) / 100);
    expect(await walletBalance(ids.luis)).toBe(walletBefore + base - commission);
    expect(await accountBalance("platform:revenue")).toBe(revenueBefore + commission + p.ownerFeeCents);
    expect(await accountBalance("platform:held")).toBe(heldBefore - p.amountCents);
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("RELEASED");
    await expectLedgerBalanced();
  });

  test("a dispute refund claws back from the walker and refunds through the provider", async () => {
    const open = await call(disputesRoute.POST as H, {
      method: "POST",
      cookie: cookies.ana,
      body: { bookingId: ids.booking1, walkId: ids.walk1, reason: "QUALITY", description: "El paseo fue más corto de lo acordado." },
    });
    expect(open.status).toBe(201);
    const walletBefore = await walletBalance(ids.luis);
    const r = await call(disputeRoute.PATCH as H, {
      method: "PATCH",
      params: { id: open.json.id },
      cookie: cookies.admin,
      body: { action: "refund", refundCents: 500, resolution: "Reembolso parcial" },
    });
    expect(r.status).toBe(200);
    const p = await db.payment.findUniqueOrThrow({ where: { id: ids.payment1 } });
    expect(p.refundedCents).toBe(500);
    expect(await walletBalance(ids.luis)).toBe(walletBefore - 500);
    const charge = await db.mockCharge.findUniqueOrThrow({ where: { providerRef: p.providerRef! } });
    expect(charge.refundedCents).toBe(500);
    await expectLedgerBalanced();
  });
});

describe("monthly plans", () => {
  test("buying a plan: QR for price + fee; paid → ACTIVE with funds in plan:{id}", async () => {
    const plans = await call(plansRoute.GET as H, {});
    const plan = plans.json.find((p: { key: string }) => p.key === "plan-20x30");
    expect(plan.totalCents).toBe(plan.priceCents + Math.round((plan.priceCents * OWNER_FEE_PCT) / 100));

    const r = await call(subscriptionsRoute.POST as H, { method: "POST", cookie: cookies.carlos, body: { planId: plan.id } });
    expect(r.status).toBe(201);
    expect(r.json.status).toBe("PENDING_PAYMENT");
    expect(r.json.payment.amountCents).toBe(plan.totalCents);
    ids.sub = r.json.id;

    const revenueBefore = await accountBalance("platform:revenue");
    const paid = await call(mockPayRoute.POST as H, { method: "POST", cookie: cookies.carlos, body: { paymentId: r.json.payment.id } });
    expect(paid.json.status).toBe("HELD");
    const sub = await db.subscription.findUniqueOrThrow({ where: { id: ids.sub } });
    expect(sub.status).toBe("ACTIVE");
    expect(sub.periodEnd!.getTime()).toBeGreaterThan(Date.now());
    expect(await accountBalance(`plan:${ids.sub}`)).toBe(plan.priceCents);
    expect(await accountBalance("platform:revenue")).toBe(revenueBefore + plan.totalCents - plan.priceCents);
    await expectLedgerBalanced();
  });

  test("a plan booking is prepaid and each completed walk draws one walk from the plan", async () => {
    const wrongDuration = await call(bookingsRoute.POST as H, {
      method: "POST",
      cookie: cookies.carlos,
      body: { paymentMethod: "PLAN", subscriptionId: ids.sub, durationMin: 60, type: "ONE_OFF", schedule: [{ date: dayAhead(2), minute: 600 }] },
    });
    expect(wrongDuration.status).toBe(400);

    const b = await book("carlos", { paymentMethod: "PLAN", subscriptionId: ids.sub });
    expect(b.payment.method).toBe("PLAN");
    expect(b.payment.status).toBe("HELD");
    const walletBefore = await walletBalance(ids.luis);
    await walkIt(b.id);

    const sub = await db.subscription.findUniqueOrThrow({ where: { id: ids.sub } });
    expect(sub.walksUsed).toBe(1);
    const perWalk = Math.floor(sub.priceCents / sub.walksTotal);
    expect(await accountBalance(`plan:${ids.sub}`)).toBe(sub.priceCents - perWalk);
    const commission = Math.round((perWalk * COMMISSION_PCT) / 100);
    expect(await walletBalance(ids.luis)).toBe(walletBefore + perWalk - commission);
    await expectLedgerBalanced();
  });

  test("another owner cannot book on someone else's plan", async () => {
    const ana = await db.user.findUniqueOrThrow({ where: { phone: PHONES.ana }, include: { dogs: true } });
    const r = await call(bookingsRoute.POST as H, {
      method: "POST",
      cookie: cookies.ana,
      body: {
        dogId: ana.dogs[0].id,
        zoneId: ana.zoneId,
        type: "ONE_OFF",
        durationMin: 30,
        schedule: [{ date: dayAhead(3), minute: 600 }],
        preferredWalkerUserId: ids.luis,
        paymentMethod: "PLAN",
        subscriptionId: ids.sub,
      },
    });
    expect(r.status).toBe(404);
  });

  test("at period end unused walks follow the policy (forfeit → platform revenue)", async () => {
    await db.subscription.update({ where: { id: ids.sub }, data: { periodEnd: new Date(Date.now() - 1000) } });
    const remaining = await accountBalance(`plan:${ids.sub}`);
    const revenueBefore = await accountBalance("platform:revenue");
    expect(await expireSubscriptions()).toBeGreaterThanOrEqual(1);
    expect((await db.subscription.findUniqueOrThrow({ where: { id: ids.sub } })).status).toBe("EXPIRED");
    expect(await accountBalance(`plan:${ids.sub}`)).toBe(0);
    expect(await accountBalance("platform:revenue")).toBe(revenueBefore + remaining);
    await expectLedgerBalanced();
  });
});

describe("reconciliation", () => {
  test("flags settlements we did not record and records the provider did not settle", async () => {
    // A payment the admin confirmed by hand that the provider never settled.
    const p3 = await db.payment.findUniqueOrThrow({ where: { id: ids.payment3 } });
    // The provider settled a QR whose hold is missing in our books.
    const ghost = await book("ana", { paymentMethod: "QR", schedule: [{ date: dayAhead(4), minute: 600 }] });
    await call(qrRoute.POST as H, { method: "POST", params: { id: ghost.payment.id }, cookie: cookies.ana, body: {} });
    const g = await db.payment.findUniqueOrThrow({ where: { id: ghost.payment.id } });
    await mock.pay(g.providerRef!); // paid at the bank, never reached us

    const from = new Date(Date.now() - 3_600_000);
    const to = new Date(Date.now() + 60_000);
    const res = await runReconciliation({ from, to, triggeredBy: "test" });
    expect(res.issues).toBeGreaterThanOrEqual(1);
    const kinds = await db.reconciliationIssue.findMany({ where: { runId: res.runId } });
    expect(kinds.some((i) => i.kind === "SETTLED_NOT_RECORDED" && i.paymentId === g.id)).toBe(true);
    // p3 was underpaid at the provider: its settlement differs from the hold.
    // The webhook already opened that issue, so the run does not repeat it.
    expect(kinds.some((i) => i.paymentId === p3.id)).toBe(false);
    expect(await db.reconciliationIssue.count({ where: { paymentId: p3.id, kind: "AMOUNT_MISMATCH", status: "OPEN" } })).toBe(1);
    // Well-behaved payments produce no issue.
    expect(kinds.some((i) => i.paymentId === ids.payment1)).toBe(false);

    // Re-running does not duplicate open issues.
    const again = await runReconciliation({ from, to, triggeredBy: "test" });
    expect(again.issues).toBe(0);
  });

  test("admin sees the issues and resolves one with a note", async () => {
    const r = await call(reconRoute.GET as H, { cookie: cookies.admin });
    expect(r.status).toBe(200);
    expect(r.json.ledger.balanced).toBe(true);
    const open = r.json.issues.find((i: { status: string }) => i.status === "OPEN");
    const noNote = await call(reconIssueRoute.PATCH as H, { method: "PATCH", params: { id: open.id }, cookie: cookies.admin, body: {} });
    expect(noNote.status).toBe(400);
    const done = await call(reconIssueRoute.PATCH as H, {
      method: "PATCH",
      params: { id: open.id },
      cookie: cookies.admin,
      body: { resolution: "Revisado con el banco" },
    });
    expect(done.json.status).toBe("RESOLVED");
  });

  test("cron endpoints require CRON_SECRET", async () => {
    delete process.env.CRON_SECRET;
    expect((await call(cronDaily.GET as H, {})).status).toBe(503);
    process.env.CRON_SECRET = "cron-secret-for-tests-0123456789";
    expect((await call(cronDaily.GET as H, { headers: { authorization: "Bearer nope" } })).status).toBe(401);
    const ok = await call(cronDaily.GET as H, { headers: { authorization: "Bearer cron-secret-for-tests-0123456789" } });
    expect(ok.status).toBe(200);
    delete process.env.CRON_SECRET;
  });
});

describe("weekly payout batch", () => {
  test("build → approve → CSV → paid with the bank reference", async () => {
    const luisBalance = await walletBalance(ids.luis);
    expect(luisBalance).toBeGreaterThan(0);
    const built = await call(batchesRoute.POST as H, { method: "POST", cookie: cookies.admin });
    expect(built.status).toBe(201);
    const batch = built.json;
    expect(batch.status).toBe("DRAFT");
    const luisPayout = batch.payouts.find((p: { walkerId: string }) => p.walkerId === ids.luis);
    expect(luisPayout.amountCents).toBe(luisBalance);
    expect(luisPayout.destRef).toContain("Luis");
    expect(await walletBalance(ids.luis)).toBe(0);
    expect(batch.totalCents).toBe(batch.payouts.reduce((s: number, p: { amountCents: number }) => s + p.amountCents, 0));

    // A second open batch is refused.
    expect((await call(batchesRoute.POST as H, { method: "POST", cookie: cookies.admin })).status).toBe(409);
    // CSV only after approval.
    expect((await call(batchCsvRoute.GET as H, { params: { id: batch.id }, cookie: cookies.admin })).status).toBe(400);

    const approved = await call(batchRoute.PATCH as H, { method: "PATCH", params: { id: batch.id }, cookie: cookies.admin, body: { action: "approve" } });
    expect(approved.json.status).toBe("APPROVED");
    const csv = await call(batchCsvRoute.GET as H, { params: { id: batch.id }, cookie: cookies.admin });
    expect(csv.status).toBe(200);
    expect(csv.res.headers.get("content-type")).toContain("text/csv");
    expect(String(csv.json)).toContain(luisPayout.id);

    const noRef = await call(batchRoute.PATCH as H, { method: "PATCH", params: { id: batch.id }, cookie: cookies.admin, body: { action: "paid" } });
    expect(noRef.status).toBe(400);
    const paid = await call(batchRoute.PATCH as H, {
      method: "PATCH",
      params: { id: batch.id },
      cookie: cookies.admin,
      body: { action: "paid", reference: "BNB-LOTE-0001" },
    });
    expect(paid.json.status).toBe("PAID");
    expect(paid.json.payouts.every((p: { status: string }) => p.status === "PAID" || p.status === "CANCELLED")).toBe(true);
    for (const p of paid.json.payouts) expect(await accountBalance(`payout:${p.id}`)).toBe(0);

    // The walker sees it in their history with the reference.
    const mine = await call(payoutsRoute.GET as H, { cookie: cookies.luis });
    expect(mine.json.find((p: { id: string }) => p.id === luisPayout.id).reference).toBe("BNB-LOTE-0001");
    await expectLedgerBalanced();
  });

  test("walkers save where they get paid; requests need it", async () => {
    const bad = await call(walletRoute.PATCH as H, { method: "PATCH", cookie: cookies.luis, body: { payoutMethod: "BANK", payoutAccount: "12" } });
    expect(bad.status).toBe(400);
    const good = await call(walletRoute.PATCH as H, {
      method: "PATCH",
      cookie: cookies.luis,
      body: { payoutMethod: "BANK", payoutBank: "BNB", payoutAccount: "4501234567", payoutHolder: "Luis Quiroga" },
    });
    expect(good.status).toBe(200);
    const w = await call(walletRoute.GET as H, { cookie: cookies.luis });
    expect(w.json.destination.payoutAccount).toBe("4501234567");
  });
});

describe("cash debt limit", () => {
  test("a walker over the debt limit cannot accept and is not matched; a deposit unblocks", async () => {
    await updateConfigSection("payouts", { maxCashDebtCents: 5000 });
    const gab = await db.walkerProfile.findUniqueOrThrow({ where: { userId: ids.gabriela } });
    const matched = async () => {
      const m = await call(matchRoute.POST as H, {
        method: "POST",
        cookie: cookies.carlos,
        body: { zoneId: gab.zoneId, durationMin: 30, type: "RECURRING", schedule: [{ day: 1, minute: 480 }] },
      });
      expect(m.status).toBe(200);
      return (m.json.candidates as { userId: string }[]).some((c) => c.userId === ids.gabriela);
    };
    expect(await matched()).toBe(true);
    const debt = 6000 + (await walletBalance(ids.gabriela));
    await postTxn(
      [
        { account: `walker:${ids.gabriela}`, debit: debt, memo: "test: comisiones de paseos en efectivo" },
        { account: "platform:revenue", credit: debt, memo: "test" },
      ],
      "test",
      "cash-debt"
    );
    expect(await walletBalance(ids.gabriela)).toBe(-6000);
    const wallet = await call(walletRoute.GET as H, { cookie: cookies.gabriela });
    expect(wallet.json.blockedForDebt).toBe(true);

    // Preferred booking with her is refused.
    const carlos = await db.user.findUniqueOrThrow({ where: { phone: PHONES.carlos }, include: { dogs: true } });
    const r = await call(bookingsRoute.POST as H, {
      method: "POST",
      cookie: cookies.carlos,
      body: {
        dogId: carlos.dogs[0].id,
        zoneId: gab.zoneId,
        type: "ONE_OFF",
        durationMin: 30,
        schedule: [{ date: dayAhead(5), minute: 480 }],
        preferredWalkerUserId: ids.gabriela,
        paymentMethod: "CASH",
      },
    });
    expect(r.status).toBe(400);

    // Not offered by the matcher.
    expect(await matched()).toBe(false);

    // Deposit recorded by the admin clears it.
    const tooMuch = await call(depositRoute.POST as H, {
      method: "POST",
      params: { id: gab.id },
      cookie: cookies.admin,
      body: { amountCents: 7000, reference: "DEP-1" },
    });
    expect(tooMuch.status).toBe(400);
    const dep = await call(depositRoute.POST as H, {
      method: "POST",
      params: { id: gab.id },
      cookie: cookies.admin,
      body: { amountCents: 6000, reference: "DEP-0042" },
    });
    expect(dep.status).toBe(200);
    expect(dep.json.balanceCents).toBe(0);
    expect((await call(walletRoute.GET as H, { cookie: cookies.gabriela })).json.blockedForDebt).toBe(false);
    expect(await matched()).toBe(true);
    await expectLedgerBalanced();
  });
});

describe("the whole ledger", () => {
  test("after every flow above: Σdebits = Σcredits and every txn balances", async () => {
    await expectLedgerBalanced();
    const totals = await ledgerTotals();
    expect(totals.debitCents).toBeGreaterThan(0);
  });
});
