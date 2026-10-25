// POST /api/reviews {bookingId, walkId?, rating, comment?, tipCents}
//
// Owner reviews a COMPLETED booking (one review per booking). Optional tip
// moves money tip.pass-style (owner → walker, 100% to the walker — mirrors
// the seed convention). Walker rating aggregate is updated incrementally so
// seeded demo numbers stay consistent. The walker gets a notification.

import { db } from "@/lib/db";
import { ApiError, ok, optStr, readJson, run, reqNum } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { notify } from "@/lib/server/notify";
import { postTxn } from "@/lib/server/ledger";
import { reviewOf } from "@/lib/server/serialize";
import { formatBOB } from "@/lib/firu/money";

export async function POST(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    if (user.role !== "OWNER") {
      throw new ApiError(403, "Solo los dueños pueden dejar reseñas.");
    }
    const body = await readJson(req);

    const bookingId = optStr(body, "bookingId");
    if (!bookingId) throw new ApiError(400, "Indica la reserva a reseñar.");
    const rating = reqNum(body, "rating", "La calificación", { min: 1, max: 5, int: true });
    const comment = optStr(body, "comment", { max: 500 }) ?? null;
    const tipCents = body.tipCents === undefined || body.tipCents === null ? 0 : reqNum(body, "tipCents", "La propina", { min: 0, int: true });
    if (tipCents > 20000) {
      throw new ApiError(400, "La propina no puede ser mayor a Bs 200.");
    }

    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      include: { dog: true, owner: true },
    });
    if (!booking) throw new ApiError(404, "Reserva no encontrada.");
    if (booking.ownerId !== user.id) {
      throw new ApiError(403, "Solo puedes reseñar tus propias reservas.");
    }
    if (booking.status !== "COMPLETED") {
      throw new ApiError(400, "Podrás dejar la reseña cuando la reserva esté completada.");
    }
    if (!booking.walkerId) {
      throw new ApiError(400, "Esta reserva no tiene paseador asignado.");
    }

    const existing = await db.review.findFirst({ where: { bookingId } });
    if (existing) {
      throw new ApiError(400, "Ya dejaste una reseña para esta reserva. ¡Gracias! 💚");
    }

    // Optional walkId: must belong to this booking when provided.
    let walkId: string | null = null;
    const rawWalkId = optStr(body, "walkId");
    if (rawWalkId) {
      const walk = await db.walk.findUnique({ where: { id: rawWalkId } });
      if (!walk || walk.bookingId !== booking.id) {
        throw new ApiError(400, "El paseo indicado no pertenece a esta reserva.");
      }
      walkId = walk.id;
    }

    const review = await db.review.create({
      data: {
        bookingId: booking.id,
        walkId,
        ownerId: user.id,
        walkerId: booking.walkerId,
        rating,
        comment,
        tipCents,
      },
      include: { owner: true },
    });

    // Tip moves owner → walker, 100% to the walker (seed "Propina" convention).
    if (tipCents > 0) {
      const walkerUser = await db.user.findUnique({ where: { id: booking.walkerId } });
      await postTxn(
        [
          {
            account: `owner:${user.id}`,
            debit: tipCents,
            memo: `Propina para ${walkerUser?.name ?? "el paseador"} (100% al paseador)`,
          },
          {
            account: `walker:${booking.walkerId}`,
            credit: tipCents,
            memo: `Propina recibida — paseo de ${booking.dog?.name ?? "tu perrito"}`,
          },
        ],
        "tip",
        review.id
      );
    }

    // Incremental rating aggregate (keeps seeded demo numbers consistent).
    const profile = await db.walkerProfile.findUnique({
      where: { userId: booking.walkerId },
    });
    if (profile) {
      const ratingCount = profile.ratingCount + 1;
      const avg = Math.round(((profile.rating * profile.ratingCount + rating) / ratingCount) * 10) / 10;
      await db.walkerProfile.update({
        where: { id: profile.id },
        data: { rating: avg, ratingCount },
      });
    }

    const stars = "⭐".repeat(rating);
    await notify(
      booking.walkerId,
      "REVIEW",
      `Nueva reseña ${stars}`,
      `${user.name} te calificó con ${rating}/5 por los paseos de ${booking.dog?.name ?? "su perrito"}.${tipCents > 0 ? ` Incluye una propina de ${formatBOB(tipCents)} 💚` : ""}`,
      "profile"
    );

    return ok(reviewOf(review), { status: 201 });
  });
}
