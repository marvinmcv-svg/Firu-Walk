// SOS during an active walk (Milestone 8):
//   1. IncidentLog(SOS) with the walker's position (or the last GPS fix),
//   2. the owner gets the `walk_sos` template with the live-map link,
//   3. ops phones + admins get an ops alert with a map link,
//   4. the walker gets the nearest vets (admin-managed).
// Pressing it again within SOS_DEDUP_MS returns the same open incident and
// does not alert everyone twice.

import type { IncidentLog } from "@prisma/client";
import { db } from "@/lib/db";
import type { AppConfig, VetDTO } from "@/lib/firu/types";
import { notifyEvent } from "../notify";
import { mapsLink, sendOpsAlert } from "./opsAlerts";
import { nearestVets } from "./vets";

export const SOS_DEDUP_MS = 10 * 60 * 1000;

export interface SosResult {
  incident: IncidentLog;
  repeated: boolean;
  vets: VetDTO[];
  position: { lat: number; lng: number } | null;
}

/** Last accepted GPS fix of the walk, if any. */
async function lastFix(walkId: string): Promise<{ lat: number; lng: number } | null> {
  const p = await db.walkTrackPoint.findFirst({
    where: { walkId, rejectReason: null },
    orderBy: { seq: "desc" },
    select: { lat: true, lng: true },
  });
  return p ?? null;
}

export async function triggerSos(input: {
  walk: { id: string; ownerId: string; walkerId: string; dogName: string; zoneName: string };
  walker: { id: string; name: string; phone: string };
  pos: { lat: number; lng: number } | null;
  note: string | null;
  cfg: AppConfig;
}): Promise<SosResult> {
  const { walk, walker, note, cfg } = input;
  const pos = input.pos ?? (await lastFix(walk.id));

  const recent = await db.incidentLog.findFirst({
    where: {
      walkId: walk.id,
      type: "SOS",
      status: "OPEN",
      createdAt: { gt: new Date(Date.now() - SOS_DEDUP_MS) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (recent) {
    // Keep the freshest position for ops, but don't alert everyone again.
    const incident =
      pos && input.pos
        ? await db.incidentLog.update({ where: { id: recent.id }, data: { lat: pos.lat, lng: pos.lng } })
        : recent;
    return { incident, repeated: true, vets: await nearestVets(pos), position: pos };
  }

  const incident = await db.incidentLog.create({
    data: {
      walkId: walk.id,
      reportedBy: walker.id,
      subjectUserId: walker.id,
      type: "SOS",
      note: note?.trim() || "SOS activado por el paseador",
      lat: pos?.lat ?? null,
      lng: pos?.lng ?? null,
    },
  });
  await db.auditLog.create({
    data: {
      actorId: walker.id,
      action: "SOS_TRIGGERED",
      entity: "walk",
      entityId: walk.id,
      detail: JSON.stringify({ incidentId: incident.id, pos, note }),
    },
  });

  await notifyEvent(walk.ownerId, "walk_sos", {
    walkerName: walker.name,
    dogName: walk.dogName,
    walkId: walk.id,
  });
  await sendOpsAlert(
    {
      kind: "SOS",
      summary: `${walker.name} (${walker.phone}) — paseo de ${walk.dogName} en ${walk.zoneName}${note ? `: "${note.trim().slice(0, 200)}"` : ""}`,
      pos,
      link: "ops",
    },
    cfg
  );

  return { incident, repeated: false, vets: await nearestVets(pos), position: pos };
}

export { mapsLink };
