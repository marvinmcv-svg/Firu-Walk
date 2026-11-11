// POST /api/group-slots/[id]/join {dogId, paymentMethod: QR|TRANSFER|CASH, notes?} → BookingDTO
// An owner adds one dog to a group walk: a CONFIRMED one-off booking at the
// group price per dog (+ owner service fee), paid like any other walk.

import { z } from "zod";
import { db } from "@/lib/db";
import { joinSlot } from "@/lib/server/groupWalks";
import { ApiError, ok, readJson, run } from "@/lib/server/http";
import { bookingInclude, bookingOf } from "@/lib/server/serialize";
import { requireUser } from "@/lib/server/session";

const JoinInput = z.object({
  dogId: z.string().min(1, "Selecciona la mascota para el paseo."),
  paymentMethod: z.enum(["QR", "TRANSFER", "CASH"]),
  notes: z.string().max(500).nullish(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const user = await requireUser(req);
    if (user.role !== "OWNER") throw new ApiError(403, "Solo los dueños pueden unirse a un paseo grupal.");
    const parsed = JoinInput.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Datos inválidos.");
    const bookingId = await joinSlot(user, id, parsed.data);
    const full = await db.booking.findUniqueOrThrow({ where: { id: bookingId }, include: bookingInclude });
    const zone = await db.zone.findUnique({ where: { id: full.zoneId }, select: { id: true, name: true, key: true } });
    return ok(bookingOf(full, zone), { status: 201 });
  });
}
