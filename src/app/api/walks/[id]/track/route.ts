// POST /api/walks/[id]/track {points:[{seq,lat,lng,ts,acc?,mock?}]}
//   → {accepted, rejected:[{seq,reason}], duplicates, distanceMeters, lastSeq}
// The assigned walker's app uploads buffered GPS fixes in batches. Idempotent
// by (walk, seq): a retried batch is acknowledged without double counting.
// Fixes are validated server-side (src/lib/server/tracking.ts); distance is
// computed here from accepted fixes only and pushed to the owner's live view.

import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, ok, run } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { getAppConfig } from "@/lib/server/config";
import { publishRealtime } from "@/lib/server/realtime";
import { log } from "@/lib/server/log";
import { parseJson } from "@/lib/server/serialize";
import {
  REANCHOR_STREAK,
  streakOf,
  validateTrackBatch,
  type Fix,
  type TrackRules,
  type TrackState,
} from "@/lib/server/tracking";

export const MAX_BATCH = 200;
/** Live-service publish bodies are capped at 16 KB. */
const MAX_PUBLISHED_POINTS = 100;

const FixSchema = z.object({
  seq: z.number().int().min(0).max(10_000_000),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  ts: z.number().int().positive(),
  acc: z.number().min(0).max(100_000).nullish(),
  mock: z.boolean().optional(),
});
const BodySchema = z.object({ points: z.array(FixSchema).min(1).max(MAX_BATCH) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const user = await requireUser(req);
    const walk = await db.walk.findUnique({ where: { id }, select: { walkerId: true } });
    if (!walk) throw new ApiError(404, "Paseo no encontrado.");
    if (walk.walkerId !== user.id) {
      throw new ApiError(403, "Solo el paseador asignado puede enviar puntos GPS.");
    }
    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, "Los puntos GPS son inválidos.");
    const rules = (await getAppConfig()).tracking;

    const result = await db.$transaction(async (tx) => {
      // Serialize uploads per walk (retries can overlap a slow request).
      await tx.$queryRaw`SELECT id FROM "Walk" WHERE id = ${id} FOR UPDATE`;
      const w = await tx.walk.findUniqueOrThrow({ where: { id } });
      if (w.status !== "IN_PROGRESS") {
        throw new ApiError(409, "Solo se puede rastrear un paseo en curso.");
      }

      // Idempotency: drop seqs already stored (and repeats inside the batch).
      const seqs = [...new Set(parsed.data.points.map((p) => p.seq))];
      const stored = await tx.walkTrackPoint.findMany({
        where: { walkId: id, seq: { in: seqs } },
        select: { seq: true },
      });
      const seen = new Set(stored.map((s) => s.seq));
      const fresh: Fix[] = [];
      for (const p of parsed.data.points) {
        if (seen.has(p.seq)) continue;
        seen.add(p.seq);
        fresh.push(p);
      }
      const duplicates = parsed.data.points.length - fresh.length;

      const state = await loadState(tx, w, rules);
      const { results, state: next } = validateTrackBatch(state, fresh, rules, {
        startedAt: (w.startedAt ?? w.createdAt).getTime(),
        now: Date.now(),
      });

      const accepted = results.filter((r) => !r.rejectReason);
      const rejected = results.filter((r) => r.rejectReason);
      const addMeters = accepted.reduce((sum, r) => sum + r.addMeters, 0);
      const mocked = results.some((r) => r.mock);

      if (results.length > 0) {
        await tx.walkTrackPoint.createMany({
          data: results.map((r) => ({
            walkId: id,
            seq: r.seq,
            lat: r.lat,
            lng: r.lng,
            accuracyM: r.acc ?? null,
            mocked: r.mock === true,
            rejectReason: r.rejectReason,
            recordedAt: new Date(r.ts),
          })),
        });
      }
      const track = parseJson<[number, number][]>(w.trackJson, []);
      const updated = await tx.walk.update({
        where: { id },
        data: {
          ...(accepted.length
            ? { trackJson: JSON.stringify([...track, ...accepted.map((r) => [r.lat, r.lng])]) }
            : {}),
          distanceMeters: { increment: addMeters },
          rejectedPoints: { increment: rejected.length },
          ...(mocked ? { mockLocation: true } : {}),
        },
      });
      return { accepted, rejected, duplicates, mocked, firstMock: mocked && !w.mockLocation, walk: updated, maxSeq: next.maxSeq };
    });

    const distanceMeters = Math.round(result.walk.distanceMeters);
    if (result.accepted.length > 0) {
      await publishRealtime(`walk:${id}`, "walk:points", {
        walkId: id,
        points: result.accepted
          .slice(-MAX_PUBLISHED_POINTS)
          .map((r) => ({ seq: r.seq, lat: r.lat, lng: r.lng, ts: r.ts })),
        distMeters: distanceMeters,
      });
    }
    if (result.rejected.length > 0) {
      log.info("walk.track_rejected", {
        walkId: id,
        reasons: result.rejected.map((r) => r.rejectReason),
      });
    }
    if (result.firstMock) {
      log.warn("walk.mock_location", { walkId: id, walkerId: user.id });
      await db.auditLog.create({
        data: {
          actorId: user.id,
          action: "WALK_MOCK_LOCATION",
          entity: "walk",
          entityId: id,
          detail: "El dispositivo del paseador reportó una ubicación simulada.",
        },
      });
    }

    return ok({
      accepted: result.accepted.length,
      rejected: result.rejected.map((r) => ({ seq: r.seq, reason: r.rejectReason })),
      duplicates: result.duplicates,
      distanceMeters,
      lastSeq: result.maxSeq,
    });
  });
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/** Rebuild the validator state from stored fixes. */
async function loadState(
  tx: Tx,
  w: { id: string; startLat: number | null; startLng: number | null; startedAt: Date | null; createdAt: Date },
  rules: TrackRules
): Promise<TrackState> {
  const toFix = (p: { seq: number; lat: number; lng: number; recordedAt: Date; accuracyM: number | null }): Fix => ({
    seq: p.seq,
    lat: p.lat,
    lng: p.lng,
    ts: p.recordedAt.getTime(),
    acc: p.accuracyM,
  });
  const [last, top] = await Promise.all([
    tx.walkTrackPoint.findFirst({
      where: { walkId: w.id, rejectReason: null },
      orderBy: { seq: "desc" },
    }),
    tx.walkTrackPoint.findFirst({ where: { walkId: w.id }, orderBy: { seq: "desc" }, select: { seq: true } }),
  ]);
  const anchor: Fix | null = last
    ? toFix(last)
    : w.startLat !== null && w.startLng !== null
      ? { seq: -1, lat: w.startLat, lng: w.startLng, ts: (w.startedAt ?? w.createdAt).getTime() }
      : null;

  // Trailing motion-rejected fixes since the anchor, replayed for consistency.
  const after = await tx.walkTrackPoint.findMany({
    where: { walkId: w.id, seq: { gt: anchor?.seq ?? -1 }, rejectReason: { in: ["too_fast", "teleport"] } },
    orderBy: { seq: "desc" },
    take: REANCHOR_STREAK - 1,
  });
  return { anchor, streak: streakOf(after.reverse().map(toFix), rules), maxSeq: top?.seq ?? -1 };
}
