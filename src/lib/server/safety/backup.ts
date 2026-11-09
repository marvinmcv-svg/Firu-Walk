// Late-start detection and the backup-walker chain (Milestone 8).
//
// A SCHEDULED walk not started `safety.lateStartMinutes` after its time:
//   → IncidentLog(LATE), the owner gets `walk_late`, the walker an in-app
//     nudge, ops an alert, and the walk is offered to backup walkers one at a
//     time (booking candidate chain first, then fresh same-zone matches), each
//     with `safety.backupOfferMinutes` to take it.
//   → A backup who accepts becomes the walk's walker (originalWalkerId keeps
//     who was late, for the leaderboard). The booking itself stays with the
//     original walker.
//   → The original walker starting the walk meanwhile cancels the offer.
//   → Chain exhausted: the owner gets `backup_none`, ops an alert.
// All steps are idempotent (conditional updates) so the worker can retry.

import { db } from "@/lib/db";
import type { AppConfig } from "@/lib/firu/types";
import { log } from "../log";
import { notify, notifyEvent } from "../notify";
import { parseJson } from "../serialize";
import { boDayOfWeek, BO_OFFSET_MS } from "../botime";
import { matchWalkers } from "../bookingEngine";
import { debtBlockedWalkers } from "../payments/debt";
import { ApiError } from "../http";
import { sendOpsAlert } from "./opsAlerts";

/** Late walks older than this are left alone (stale data, not an emergency). */
export const LATE_LOOKBACK_MS = 6 * 60 * 60 * 1000;
/** A walker with another walk this close to the late one is not offered it. */
const BUSY_MARGIN_MS = 30 * 60 * 1000;

const walkCtx = {
  dog: { select: { name: true } },
  walker: { select: { id: true, name: true, phone: true } },
} as const;

async function zoneName(zoneId: string): Promise<string> {
  return (await db.zone.findUnique({ where: { id: zoneId }, select: { name: true } }))?.name ?? "";
}

/** BO-local minute of the day. */
function boMinute(d: Date): number {
  const bo = new Date(d.getTime() - BO_OFFSET_MS);
  return bo.getUTCHours() * 60 + bo.getUTCMinutes();
}

/** Booking chain first (minus the late walker), then fresh same-zone matches. */
export async function buildBackupCandidates(walk: {
  bookingId: string;
  walkerId: string;
  zoneId: string;
  durationMin: number;
  scheduledStart: Date;
}): Promise<string[]> {
  const booking = await db.booking.findUnique({
    where: { id: walk.bookingId },
    select: { candidatesJson: true },
  });
  const chain = parseJson<string[]>(booking?.candidatesJson ?? "[]", []);
  let fresh: string[] = [];
  try {
    const matches = await matchWalkers({
      zoneId: walk.zoneId,
      durationMin: walk.durationMin,
      schedule: [{ day: boDayOfWeek(walk.scheduledStart), minute: boMinute(walk.scheduledStart) }],
      excludeWalkerUserIds: [walk.walkerId],
    });
    fresh = matches.map((m) => m.userId);
  } catch (err) {
    log.warn("backup.match_failed", { err });
  }
  return [...new Set([...chain, ...fresh])].filter((id) => id !== walk.walkerId).slice(0, 8);
}

/** Can this walker take the walk right now? (ACTIVE, not debt-blocked, free.) */
async function eligible(userId: string, walk: { id: string; scheduledStart: Date; durationMin: number }, cfg: AppConfig): Promise<boolean> {
  const profile = await db.walkerProfile.findUnique({ where: { userId }, select: { status: true } });
  if (profile?.status !== "ACTIVE") return false;
  if ((await debtBlockedWalkers([userId], cfg)).has(userId)) return false;
  const from = new Date(walk.scheduledStart.getTime() - BUSY_MARGIN_MS - 60 * 60 * 1000);
  const to = new Date(walk.scheduledStart.getTime() + walk.durationMin * 60_000 + BUSY_MARGIN_MS);
  const busy = await db.walk.count({
    where: {
      id: { not: walk.id },
      walkerId: userId,
      OR: [
        { status: "IN_PROGRESS" },
        { status: "SCHEDULED", scheduledStart: { gte: from, lte: to } },
      ],
    },
  });
  return busy === 0;
}

/**
 * Offer the walk to the next eligible backup after `backupIdx`. Returns the
 * offered walker's id, or null when the chain is exhausted (owner + ops told).
 */
export async function offerNextBackup(walkId: string, cfg: AppConfig): Promise<string | null> {
  const walk = await db.walk.findUnique({ where: { id: walkId }, include: walkCtx });
  if (!walk || walk.status !== "SCHEDULED") {
    if (walk?.backupWalkerId) {
      await db.walk.update({ where: { id: walkId }, data: { backupWalkerId: null, backupExpiresAt: null } });
    }
    return null;
  }
  const candidates = parseJson<string[]>(walk.backupCandidatesJson, []);
  let idx = walk.backupIdx + 1;
  while (idx < candidates.length && !(await eligible(candidates[idx], walk, cfg))) idx++;

  if (idx >= candidates.length) {
    const closed = await db.walk.updateMany({
      where: { id: walk.id, backupIdx: walk.backupIdx },
      data: { backupIdx: candidates.length, backupWalkerId: null, backupExpiresAt: null },
    });
    if (closed.count > 0 && walk.backupIdx < candidates.length) {
      const dogName = walk.dog?.name ?? "el perrito";
      await notifyEvent(walk.ownerId, "backup_none", { dogName, walkId: walk.id });
      await sendOpsAlert(
        {
          kind: "Sin respaldo",
          summary: `Nadie tomó el paseo de ${dogName} (${await zoneName(walk.zoneId)}). ${walk.walker.name} (${walk.walker.phone}) sigue sin iniciarlo: llama al dueño para reprogramar o acreditar.`,
          pos: null,
        },
        cfg
      );
    }
    return null;
  }

  const minutes = Math.max(1, cfg.safety.backupOfferMinutes);
  const offered = await db.walk.updateMany({
    where: { id: walk.id, status: "SCHEDULED", backupIdx: walk.backupIdx },
    data: {
      backupIdx: idx,
      backupWalkerId: candidates[idx],
      backupExpiresAt: new Date(Date.now() + minutes * 60_000),
    },
  });
  if (offered.count === 0) return null; // someone else advanced it
  await notifyEvent(candidates[idx], "backup_offer", {
    dogName: walk.dog?.name ?? "Un perrito",
    zoneName: await zoneName(walk.zoneId),
    startsAt: walk.scheduledStart,
    durationMin: walk.durationMin,
    minutesToAccept: minutes,
  });
  return candidates[idx];
}

/** Worker step: alert + start the backup chain for every newly-late walk. */
export async function detectLateWalks(cfg: AppConfig, now = new Date()): Promise<number> {
  const lateMs = Math.max(1, cfg.safety.lateStartMinutes) * 60_000;
  const late = await db.walk.findMany({
    where: {
      status: "SCHEDULED",
      lateAlertedAt: null,
      scheduledStart: { lt: new Date(now.getTime() - lateMs), gt: new Date(now.getTime() - LATE_LOOKBACK_MS) },
    },
    include: walkCtx,
    take: 50,
  });
  let alerted = 0;
  for (const walk of late) {
    const claimed = await db.walk.updateMany({
      where: { id: walk.id, status: "SCHEDULED", lateAlertedAt: null },
      data: { lateAlertedAt: now },
    });
    if (claimed.count === 0) continue;
    alerted++;
    const minutesLate = Math.round((now.getTime() - walk.scheduledStart.getTime()) / 60_000);
    const dogName = walk.dog?.name ?? "el perrito";
    const zone = await zoneName(walk.zoneId);

    await db.incidentLog.create({
      data: {
        walkId: walk.id,
        reportedBy: "system",
        subjectUserId: walk.walkerId,
        type: "LATE",
        note: `Paseo de ${dogName} sin iniciar ${minutesLate} min después de la hora programada.`,
      },
    });
    await notifyEvent(walk.ownerId, "walk_late", {
      walkerName: walk.walker.name,
      dogName,
      walkId: walk.id,
      minutesLate,
    });
    await notify(
      walk.walkerId,
      "WALK",
      "Llevas retraso en un paseo ⏱️",
      `El paseo de ${dogName} debía empezar hace ${minutesLate} min. Inícialo ya o escríbenos: si no, se lo ofreceremos a un paseador de respaldo.`,
      "home"
    );
    await sendOpsAlert(
      {
        kind: "Retraso",
        summary: `${walk.walker.name} (${walk.walker.phone}) no inició el paseo de ${dogName} en ${zone} (${minutesLate} min). Buscando respaldo.`,
        pos: null,
      },
      cfg
    );

    const candidates = await buildBackupCandidates(walk);
    await db.walk.update({
      where: { id: walk.id },
      data: { backupCandidatesJson: JSON.stringify(candidates), backupIdx: -1 },
    });
    await offerNextBackup(walk.id, cfg);
  }
  return alerted;
}

/** Worker step: offers that expired move to the next backup. */
export async function sweepBackupOffers(cfg: AppConfig, now = new Date()): Promise<number> {
  const expired = await db.walk.findMany({
    where: { backupWalkerId: { not: null }, backupExpiresAt: { lt: now } },
    select: { id: true },
    take: 50,
  });
  for (const w of expired) await offerNextBackup(w.id, cfg);
  return expired.length;
}

/** A backup walker takes the walk (conditional: only the current, unexpired offer). */
export async function acceptBackup(walkId: string, user: { id: string; name: string }, cfg: AppConfig): Promise<void> {
  const walk = await db.walk.findUnique({ where: { id: walkId }, include: walkCtx });
  if (!walk || walk.backupWalkerId !== user.id) {
    throw new ApiError(403, "Este paseo de respaldo no está ofrecido a ti.");
  }
  if (!walk.backupExpiresAt || walk.backupExpiresAt.getTime() <= Date.now() || walk.status !== "SCHEDULED") {
    throw new ApiError(400, "La oferta de respaldo ya expiró.");
  }
  if (!(await eligible(user.id, walk, cfg))) {
    throw new ApiError(400, "No puedes tomar este paseo ahora (tienes otro paseo cerca de esa hora o tu cuenta no está activa).");
  }
  const now = new Date();
  const taken = await db.walk.updateMany({
    where: { id: walk.id, status: "SCHEDULED", backupWalkerId: user.id, backupExpiresAt: { gt: now } },
    data: {
      walkerId: user.id,
      originalWalkerId: walk.walkerId,
      reassignedAt: now,
      backupWalkerId: null,
      backupExpiresAt: null,
      onTheWayAt: null,
    },
  });
  if (taken.count === 0) throw new ApiError(400, "La oferta de respaldo ya expiró.");

  const dogName = walk.dog?.name ?? "el perrito";
  await db.auditLog.create({
    data: {
      actorId: user.id,
      action: "WALK_REASSIGNED_BACKUP",
      entity: "walk",
      entityId: walk.id,
      detail: JSON.stringify({ from: walk.walkerId, to: user.id }),
    },
  });
  await db.incidentLog.updateMany({
    where: { walkId: walk.id, type: "LATE", status: "OPEN" },
    data: { note: `Paseo de ${dogName}: ${walk.walker.name} no lo inició; lo tomó ${user.name} como respaldo.` },
  });
  await notifyEvent(walk.ownerId, "walk_reassigned", { walkerName: user.name, dogName, walkId: walk.id });
  await notify(
    walk.walkerId,
    "WALK",
    "Paseo reasignado",
    `El paseo de ${dogName} lo tomó otro paseador porque no se inició a tiempo. Cuéntanos qué pasó por WhatsApp.`,
    "home"
  );
}

/** A backup walker passes: the next candidate gets the offer. */
export async function declineBackup(walkId: string, userId: string, cfg: AppConfig): Promise<void> {
  const walk = await db.walk.findUnique({ where: { id: walkId }, select: { backupWalkerId: true } });
  if (!walk || walk.backupWalkerId !== userId) {
    throw new ApiError(403, "Este paseo de respaldo no está ofrecido a ti.");
  }
  await offerNextBackup(walkId, cfg);
}

/** Walk started by its walker: drop any pending backup offer. */
export async function clearBackupOffer(walkId: string): Promise<void> {
  const walk = await db.walk.findUnique({
    where: { id: walkId },
    select: { backupWalkerId: true, dog: { select: { name: true } } },
  });
  if (!walk?.backupWalkerId) return;
  await db.walk.update({ where: { id: walkId }, data: { backupWalkerId: null, backupExpiresAt: null } });
  await notify(
    walk.backupWalkerId,
    "WALK",
    "Respaldo ya no necesario",
    `El paseador de ${walk.dog?.name ?? "el perrito"} ya inició el paseo. ¡Gracias por estar disponible!`,
    "home"
  );
}
