// MockProvider — a fake bank for development and tests. It issues real
// (scannable, meaningless) QR codes, keeps its "bank" state in MockCharge,
// signs webhooks with PAYMENT_WEBHOOK_SECRET like a real provider would, and
// can be told to "pay" a QR (POST /api/payments/mock/pay, non-production only).

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import type { ChargeState, CreatedQr, PaymentProvider, Settlement, WebhookEvent } from "./provider";
import { WebhookRejected } from "./provider";

const DEV_WEBHOOK_SECRET = "firuwalk-mock-webhook-secret-dev-only";
export const MOCK_SIGNATURE_HEADER = "x-mock-signature";

function webhookSecret(): string {
  return process.env.PAYMENT_WEBHOOK_SECRET || DEV_WEBHOOK_SECRET;
}

export function signMockWebhook(rawBody: string): string {
  return `sha256=${createHmac("sha256", webhookSecret()).update(rawBody).digest("hex")}`;
}

export interface MockWebhookBody {
  id: string;
  type: "charge.paid" | "charge.refunded";
  data: { ref: string; amount: number; paid_at: string };
}

export class MockProvider implements PaymentProvider {
  readonly name = "mock";

  async createQr(amountCents: number, reference: string, expiresAt: Date): Promise<CreatedQr> {
    const providerRef = `mock_${randomBytes(9).toString("hex")}`;
    await db.mockCharge.create({ data: { providerRef, reference, amountCents, expiresAt } });
    // Looks like an interoperable QR payload, but no bank will accept it.
    const payload = `FIRUWALK-MOCK|${providerRef}|${reference}|BOB|${(amountCents / 100).toFixed(2)}`;
    const qrImage = await QRCode.toDataURL(payload, { margin: 1, width: 240 });
    return { qrImage, providerRef, expiresAt };
  }

  async verifyWebhook(rawBody: string, headers: Headers): Promise<WebhookEvent> {
    const sig = headers.get(MOCK_SIGNATURE_HEADER) ?? "";
    const expected = signMockWebhook(rawBody);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new WebhookRejected("invalid signature");
    }
    let body: MockWebhookBody;
    try {
      body = JSON.parse(rawBody) as MockWebhookBody;
    } catch {
      throw new WebhookRejected("invalid JSON");
    }
    if (typeof body?.id !== "string" || typeof body?.data?.ref !== "string" || !Number.isInteger(body.data.amount)) {
      throw new WebhookRejected("malformed event");
    }
    return {
      eventId: body.id,
      providerRef: body.data.ref,
      status: body.type === "charge.paid" ? "PAID" : body.type === "charge.refunded" ? "REFUNDED" : "UNKNOWN",
      paidCents: body.data.amount,
      paidAt: new Date(body.data.paid_at),
      raw: body,
    };
  }

  async getStatus(providerRef: string): Promise<ChargeState> {
    const c = await db.mockCharge.findUnique({ where: { providerRef } });
    if (!c) return { providerRef, status: "UNKNOWN" };
    if (c.status === "PAID" || c.status === "REFUNDED") {
      return { providerRef, status: c.status, paidCents: c.paidCents, paidAt: c.paidAt ?? undefined };
    }
    return { providerRef, status: c.expiresAt < new Date() ? "EXPIRED" : "PENDING" };
  }

  async listSettlements(from: Date, to: Date): Promise<Settlement[]> {
    const rows = await db.mockCharge.findMany({
      where: { status: { in: ["PAID", "REFUNDED"] }, paidAt: { gte: from, lt: to } },
    });
    return rows.map((c) => ({
      providerRef: c.providerRef,
      reference: c.reference,
      amountCents: c.paidCents,
      paidAt: c.paidAt!,
    }));
  }

  async refund(providerRef: string, amountCents: number): Promise<{ refundRef: string } | null> {
    const c = await db.mockCharge.update({
      where: { providerRef },
      data: { refundedCents: { increment: amountCents } },
    });
    if (c.refundedCents >= c.paidCents) {
      await db.mockCharge.update({ where: { providerRef }, data: { status: "REFUNDED" } });
    }
    return { refundRef: `mockrf_${randomBytes(6).toString("hex")}` };
  }

  // ---- test/dev helpers (not part of PaymentProvider) ----

  /**
   * The payer scans and pays: mark the charge PAID in the mock bank and
   * build the signed webhook the bank would send. `amountCents` lets tests
   * simulate an under/over-payment.
   */
  async pay(providerRef: string, amountCents?: number): Promise<{ rawBody: string; signature: string }> {
    const c = await db.mockCharge.findUnique({ where: { providerRef } });
    if (!c) throw new Error("unknown mock charge");
    const paidAt = new Date();
    const paid = amountCents ?? c.amountCents;
    await db.mockCharge.update({
      where: { providerRef },
      data: { status: "PAID", paidCents: paid, paidAt },
    });
    const body: MockWebhookBody = {
      id: `evt_${randomBytes(9).toString("hex")}`,
      type: "charge.paid",
      data: { ref: providerRef, amount: paid, paid_at: paidAt.toISOString() },
    };
    const rawBody = JSON.stringify(body);
    return { rawBody, signature: signMockWebhook(rawBody) };
  }
}
