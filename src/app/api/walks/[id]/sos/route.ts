// POST /api/walks/[id]/sos {lat?, lng?, acc?, note?} — the assigned walker,
// walk IN_PROGRESS. Logs an SOS incident, alerts the owner (WhatsApp
// template + live link) and ops (admins + ops phones, map link), and returns
// the nearest vets. A repeat within 10 min does not alert again.

import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, ok, readJson, run } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { getAppConfig } from "@/lib/server/config";
import { triggerSos } from "@/lib/server/safety/sos";
import type { SosResponseDTO } from "@/lib/firu/types";

const Body = z.object({
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  acc: z.number().min(0).max(100_000).nullish(),
  note: z.string().trim().max(500).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const user = await requireUser(req);
    const parsed = Body.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, "Los datos del SOS son inválidos.");
    const { lat, lng, note } = parsed.data;

    const walk = await db.walk.findUnique({
      where: { id },
      select: { id: true, ownerId: true, walkerId: true, status: true, zoneId: true, dog: { select: { name: true } } },
    });
    if (!walk) throw new ApiError(404, "Paseo no encontrado.");
    if (walk.walkerId !== user.id) throw new ApiError(403, "Solo el paseador asignado puede activar el SOS.");
    if (walk.status !== "IN_PROGRESS") {
      throw new ApiError(400, "El SOS está disponible durante un paseo en curso. Si es urgente, escríbenos por WhatsApp.");
    }

    const cfg = await getAppConfig();
    const zone = await db.zone.findUnique({ where: { id: walk.zoneId }, select: { name: true } });
    const res = await triggerSos({
      walk: {
        id: walk.id,
        ownerId: walk.ownerId,
        walkerId: walk.walkerId,
        dogName: walk.dog?.name ?? "el perrito",
        zoneName: zone?.name ?? "",
      },
      walker: { id: user.id, name: user.name, phone: user.phone },
      pos: lat !== undefined && lng !== undefined ? { lat, lng } : null,
      note: note ?? null,
      cfg,
    });
    const body: SosResponseDTO = {
      incidentId: res.incident.id,
      repeated: res.repeated,
      position: res.position,
      vets: res.vets,
      supportWhatsApp: cfg.platform.supportWhatsApp,
    };
    return ok(body, { status: res.repeated ? 200 : 201 });
  });
}
