// GET  /api/payments[?status=PENDING] → role-scoped receipts (owner: own; walker: settlements;
//      admin: recent 50, or every payment in `status` for manual reconciliation)
// POST /api/payments {bookingId, method} → PaymentDTO (owner sets/changes method on PENDING payment)
//      The amount always comes from the booking + Config (walk price + owner service fee).

import { db } from "@/lib/db";
import { priceBreakdown } from "@/lib/firu/money";
import { getAppConfig } from "@/lib/server/config";
import { ApiError, ok, oneOf, optStr, readJson, run } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { paymentOf } from "@/lib/server/serialize";
import type { Prisma } from "@prisma/client";

type PaymentRow = Prisma.PaymentGetPayload<{
  include: { booking: { include: { dog: true; owner: true; walker: true } }; subscription: { include: { plan: true } } };
}>;

function receiptOf(p: PaymentRow) {
  return {
    ...paymentOf(p),
    bookingId: p.bookingId,
    dogName: p.booking?.dog?.name ?? null,
    ownerName: p.booking?.owner?.name ?? null,
    walkerName: p.booking?.walker?.name ?? null,
    planName: p.purpose === "PLAN" ? (p.subscription?.plan.name ?? null) : null,
  };
}

export async function GET(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    const status = new URL(req.url).searchParams.get("status");
    const where: Prisma.PaymentWhereInput =
      user.role === "OWNER"
        ? { ownerId: user.id }
        : user.role === "WALKER"
          ? { walkerId: user.id }
          : status === "PENDING"
            ? { status: "PENDING", method: { in: ["QR", "TRANSFER"] } }
            : {};
    const payments = await db.payment.findMany({
      where,
      include: {
        booking: { include: { dog: true, owner: true, walker: true } },
        subscription: { include: { plan: true } },
      },
      orderBy: { createdAt: "desc" },
      take: user.role === "ADMIN" ? (status ? 200 : 50) : 100,
    });
    return ok(payments.map(receiptOf));
  });
}

export async function POST(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    if (user.role !== "OWNER") {
      throw new ApiError(403, "Solo el dueño puede cambiar el método de pago.");
    }
    const body = await readJson(req);
    const bookingId = optStr(body, "bookingId");
    const method = oneOf(body.method, ["QR", "TRANSFER", "CASH"] as const, "El método de pago");
    if (!bookingId) throw new ApiError(400, "La reserva es obligatoria.");

    const booking = await db.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new ApiError(404, "Reserva no encontrada.");
    if (booking.ownerId !== user.id) throw new ApiError(403, "Esta reserva no es tuya.");
    if (!["REQUESTED", "CONFIRMED"].includes(booking.status)) {
      throw new ApiError(400, "Esta reserva ya no admite pagos.");
    }
    const cfg = await getAppConfig();
    const price = priceBreakdown(booking.pricePerWalkCents, cfg.fees.ownerFeePct);

    // Set/switch method on the open PENDING payment; else open a new one
    // (recurring bookings settle per walk → a fresh PENDING per cycle).
    let payment = await db.payment.findFirst({
      where: { bookingId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    if (payment) {
      // A plan walk that fell back to per-walk payment keeps its row.
      payment = await db.payment.update({ where: { id: payment.id }, data: { method } });
    } else {
      payment = await db.payment.create({
        data: {
          bookingId,
          ownerId: booking.ownerId,
          walkerId: booking.walkerId,
          method,
          amountCents: price.totalCents,
          ownerFeeCents: price.ownerFeeCents,
          status: "PENDING",
        },
      });
    }
    return ok(paymentOf(payment));
  });
}
