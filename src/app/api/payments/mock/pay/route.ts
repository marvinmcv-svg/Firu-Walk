// POST /api/payments/mock/pay {paymentId} — DEVELOPMENT/TEST ONLY.
// Plays the bank: "pays" the payment's mock QR and delivers the signed
// webhook to the real webhook handler, exactly like the provider would.
// 404 unless the mock provider is active outside production.

import { db } from "@/lib/db";
import { ApiError, ok, readJson, reqStr, run } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { paymentOf } from "@/lib/server/serialize";
import { mockPaymentsAllowed } from "@/lib/server/payments";
import { MOCK_SIGNATURE_HEADER, MockProvider } from "@/lib/server/payments/mockProvider";
import { ensureQr, handleWebhook } from "@/lib/server/payments/service";

export async function POST(req: Request) {
  return run(async () => {
    if (!mockPaymentsAllowed()) throw new ApiError(404, "No encontrado.");
    const user = await requireUser(req);
    const body = await readJson(req);
    const paymentId = reqStr(body, "paymentId", "El pago");
    const payment = await db.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new ApiError(404, "Pago no encontrado.");
    if (payment.ownerId !== user.id && user.role !== "ADMIN") {
      throw new ApiError(403, "Este pago no es tuyo.");
    }
    if (payment.status !== "PENDING") return ok(paymentOf(payment));

    const withQr = payment.provider === "mock" && payment.providerRef ? payment : await ensureQr(payment.id);
    const { rawBody, signature } = await new MockProvider().pay(withQr.providerRef!);
    await handleWebhook("mock", rawBody, new Headers({ [MOCK_SIGNATURE_HEADER]: signature }));
    return ok(paymentOf(await db.payment.findUniqueOrThrow({ where: { id: payment.id } })));
  });
}
