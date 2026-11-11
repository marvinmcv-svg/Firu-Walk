// GET  /api/group-slots[?zoneId=] → GroupSlotDTO[]
//   owner:  open upcoming slots in the zone (default: the owner's zone) + slots they joined
//   walker: their own slots (upcoming and the last 7 days)
//   admin:  every upcoming slot
// POST /api/group-slots {date, minute, capacity, sizes?, note?} → GroupSlotDTO (walker)

import { z } from "zod";
import { db } from "@/lib/db";
import { getAppConfig } from "@/lib/server/config";
import { createSlot, slotInclude, slotsOf } from "@/lib/server/groupWalks";
import { ApiError, ok, readJson, run } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

const CreateInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha es inválida."),
  minute: z.number().int().min(0).max(1439),
  capacity: z.number().int(),
  sizes: z.array(z.enum(["S", "M", "L"])).max(3).optional(),
  note: z.string().max(300).nullish(),
});

export async function GET(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    const cfg = await getAppConfig();
    const now = new Date();
    let where;
    if (user.role === "WALKER") {
      where = { walkerId: user.id, startsAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } };
    } else if (user.role === "ADMIN") {
      where = { startsAt: { gte: now } };
    } else {
      const zoneId = new URL(req.url).searchParams.get("zoneId") || user.zoneId;
      where = {
        startsAt: { gte: now },
        OR: [
          ...(zoneId ? [{ zoneId, status: "OPEN" as const }] : []),
          { bookings: { some: { ownerId: user.id } } },
        ],
      };
    }
    const slots = await db.groupSlot.findMany({ where, include: slotInclude, orderBy: { startsAt: "asc" }, take: 100 });
    return ok(await slotsOf(slots, cfg, user));
  });
}

export async function POST(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    if (user.role !== "WALKER") throw new ApiError(403, "Solo los paseadores pueden ofrecer paseos grupales.");
    const parsed = CreateInput.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Datos del paseo grupal inválidos.");
    const slot = await createSlot(user, parsed.data);
    const full = await db.groupSlot.findUniqueOrThrow({ where: { id: slot.id }, include: slotInclude });
    return ok((await slotsOf([full], await getAppConfig(), user))[0], { status: 201 });
  });
}
