// GET  /api/disputes → DisputeDTO[] (admin: all; owner/walker: own with booking summary)
// POST /api/disputes {bookingId, walkId?, reason, description} → DisputeDTO

import { db } from "@/lib/db";
import { ApiError, ok, oneOf, optStr, readJson, reqStr, run } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { notifyAdmins } from "@/lib/server/notify";
import { disputeInclude, disputeOf, partiesFor } from "@/lib/server/serialize";

export async function GET(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    const disputes =
      user.role === "ADMIN"
        ? await db.dispute.findMany({ include: disputeInclude, orderBy: { createdAt: "desc" } })
        : await db.dispute.findMany({
            where: { OR: [{ openedById: user.id }, { againstUserId: user.id }] },
            include: disputeInclude,
            orderBy: { createdAt: "desc" },
          });

    const partyIds = disputes.flatMap((d) => [d.openedById, d.againstUserId]);
    const parties = await partiesFor(partyIds);
    return ok(await Promise.all(disputes.map((d) => disputeOf(d, parties))));
  });
}

export async function POST(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    if (user.role === "ADMIN") {
      throw new ApiError(403, "Las disputas las abre el dueño o el paseador.");
    }
    const body = await readJson(req);

    const bookingId = optStr(body, "bookingId");
    if (!bookingId) throw new ApiError(400, "La reserva es obligatoria.");
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      include: { dog: true, owner: true },
    });
    if (!booking) throw new ApiError(404, "Reserva no encontrada.");

    const isOwner = booking.ownerId === user.id;
    const isWalker = booking.walkerId === user.id;
    if (!isOwner && !isWalker) {
      throw new ApiError(403, "Solo los participantes de la reserva pueden abrir una disputa.");
    }

    const reason = oneOf(
      body.reason,
      ["LATE", "NO_SHOW", "QUALITY", "SAFETY", "BILLING", "OTHER"] as const,
      "El motivo"
    );
    const description = reqStr(body, "description", "La descripción", { max: 1500 });
    const walkId = optStr(body, "walkId") ?? null;
    if (walkId) {
      const walk = await db.walk.findUnique({ where: { id: walkId } });
      if (!walk || walk.bookingId !== booking.id) {
        throw new ApiError(400, "El paseo indicado no pertenece a esta reserva.");
      }
    }

    const againstUserId = isOwner ? booking.walkerId! : booking.ownerId;
    const dispute = await db.dispute.create({
      data: {
        bookingId,
        walkId,
        openedById: user.id,
        againstUserId,
        reason,
        description,
        status: "OPEN",
      },
      include: disputeInclude,
    });

    await notifyAdmins(
      "DISPUTE",
      "Disputa abierta ⚠️",
      `${user.name} abrió una disputa por el paseo de ${booking.dog?.name ?? "una mascota"} (motivo: ${reason}). Revísala en la cola de disputas.`,
      "disputes"
    );
    return ok(await disputeOf(dispute), { status: 201 });
  });
}
