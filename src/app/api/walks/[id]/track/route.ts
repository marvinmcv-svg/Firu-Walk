// POST /api/walks/[id]/track {points:[{lat,lng,ts?,dist?}]} → {ok:true}
// Walker appends a batch of GPS points (appends to trackJson + WalkTrackPoint rows).

import { db } from "@/lib/db";
import { ApiError, ok, readJson, run } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { parseJson } from "@/lib/server/serialize";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const user = await requireUser(req);
    const body = await readJson(req);

    const walk = await db.walk.findUnique({ where: { id } });
    if (!walk) throw new ApiError(404, "Paseo no encontrado.");
    if (walk.walkerId !== user.id) {
      throw new ApiError(403, "Solo el paseador asignado puede enviar puntos GPS.");
    }
    if (walk.status !== "IN_PROGRESS") {
      throw new ApiError(400, "Solo se puede rastrear un paseo en curso.");
    }
    if (!Array.isArray(body.points) || body.points.length === 0) {
      throw new ApiError(400, "No hay puntos para guardar.");
    }

    const points = (body.points as unknown[]).filter(
      (p): p is { lat: number; lng: number; ts?: number } =>
        typeof p === "object" &&
        p !== null &&
        typeof (p as { lat?: unknown }).lat === "number" &&
        typeof (p as { lng?: unknown }).lng === "number"
    );
    if (points.length === 0) throw new ApiError(400, "Los puntos GPS son inválidos.");

    const track = parseJson<[number, number][]>(walk.trackJson, []);
    const merged: [number, number][] = [
      ...track,
      ...points.map((p): [number, number] => [p.lat, p.lng]),
    ];

    const existing = await db.walkTrackPoint.count({ where: { walkId: walk.id } });
    const now = new Date();

    await db.walkTrackPoint.createMany({
      data: points.map((p, i) => ({
        walkId: walk.id,
        seq: existing + i,
        lat: p.lat,
        lng: p.lng,
        recordedAt: p.ts ? new Date(p.ts) : now,
      })),
    });
    await db.walk.update({
      where: { id: walk.id },
      data: { trackJson: JSON.stringify(merged) },
    });

    return ok({ ok: true, count: points.length, total: merged.length });
  });
}
