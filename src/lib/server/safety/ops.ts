// Admin → Operaciones read models (Milestone 8): live map of in-progress
// walks, late walks with their backup state, incident queue, walker
// leaderboard and scheduled-job health.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type {
  AppConfig,
  IncidentDTO,
  JobStatusDTO,
  LeaderboardRowDTO,
  OpsLiveDTO,
} from "@/lib/firu/types";
import { parseJson } from "../serialize";
import { mapsLink } from "./opsAlerts";
import { LATE_LOOKBACK_MS } from "./backup";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
/** Walks left unstarted this long after their time count as no-shows. */
export const UNSTARTED_NO_SHOW_MS = 2 * 60 * 60 * 1000;
const TRACK_TAIL = 300;

async function zoneNames(ids: string[]): Promise<Map<string, string>> {
  const zones = await db.zone.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
  return new Map(zones.map((z) => [z.id, z.name]));
}

export async function jobStatuses(): Promise<JobStatusDTO[]> {
  const jobs = ["minute", "daily", "payouts"];
  const [locks, runs] = await Promise.all([
    db.jobLock.findMany(),
    Promise.all(jobs.map((job) => db.jobRun.findFirst({ where: { job }, orderBy: { startedAt: "desc" } }))),
  ]);
  return jobs.map((job, i) => {
    const lock = locks.find((l) => l.job === job);
    const last = runs[i];
    return {
      job,
      lastRunAt: iso(lock?.lastRunAt),
      lastOkAt: iso(lock?.lastOkAt),
      lastError: last?.ok === false ? last.error : null,
      lastTrigger: last?.trigger ?? null,
    };
  });
}

export async function opsLive(cfg: AppConfig, now = new Date()): Promise<OpsLiveDTO> {
  const people = { select: { name: true, phone: true } } as const;
  const [inProgress, late, openIncidents, jobs] = await Promise.all([
    db.walk.findMany({
      where: { status: "IN_PROGRESS" },
      include: { dog: { select: { name: true } }, walker: people, owner: people },
      orderBy: { startedAt: "asc" },
      take: 200,
    }),
    db.walk.findMany({
      where: {
        status: "SCHEDULED",
        scheduledStart: {
          lt: new Date(now.getTime() - cfg.safety.lateStartMinutes * 60_000),
          gt: new Date(now.getTime() - LATE_LOOKBACK_MS),
        },
      },
      include: { dog: { select: { name: true } }, walker: people, owner: people },
      orderBy: { scheduledStart: "asc" },
      take: 100,
    }),
    db.incidentLog.count({ where: { status: "OPEN" } }),
    jobStatuses(),
  ]);

  const ids = [...inProgress, ...late].map((w) => w.zoneId);
  const zones = await zoneNames(ids);
  const sosWalks = new Set(
    (
      await db.incidentLog.findMany({
        where: { status: "OPEN", type: "SOS", walkId: { in: inProgress.map((w) => w.id) } },
        select: { walkId: true },
      })
    ).map((i) => i.walkId)
  );
  const lastFixes = await Promise.all(
    inProgress.map((w) =>
      db.walkTrackPoint.findFirst({
        where: { walkId: w.id, rejectReason: null },
        orderBy: { seq: "desc" },
        select: { lat: true, lng: true, recordedAt: true },
      })
    )
  );
  const backupIds = late.map((w) => w.backupWalkerId).filter((x): x is string => !!x);
  const backups = new Map(
    (await db.user.findMany({ where: { id: { in: backupIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name])
  );

  return {
    inProgress: inProgress.map((w, i) => {
      const track = parseJson<[number, number][]>(w.trackJson, []);
      const fix = lastFixes[i];
      return {
        walkId: w.id,
        dogName: w.dog?.name ?? "",
        walkerName: w.walker.name,
        walkerPhone: w.walker.phone,
        ownerName: w.owner.name,
        zoneName: zones.get(w.zoneId) ?? "",
        startedAt: iso(w.startedAt),
        durationMin: w.durationMin,
        last: fix ? [fix.lat, fix.lng] : track.length ? track[track.length - 1] : null,
        lastFixAt: iso(fix?.recordedAt),
        track: track.slice(-TRACK_TAIL),
        openSos: sosWalks.has(w.id),
        mockLocation: w.mockLocation,
      };
    }),
    late: late.map((w) => ({
      walkId: w.id,
      dogName: w.dog?.name ?? "",
      walkerName: w.walker.name,
      walkerPhone: w.walker.phone,
      ownerName: w.owner.name,
      ownerPhone: w.owner.phone,
      zoneName: zones.get(w.zoneId) ?? "",
      scheduledStart: w.scheduledStart.toISOString(),
      minutesLate: Math.round((now.getTime() - w.scheduledStart.getTime()) / 60_000),
      backupWalkerName: w.backupWalkerId ? (backups.get(w.backupWalkerId) ?? null) : null,
      backupExpiresAt: iso(w.backupExpiresAt),
      backupExhausted:
        w.lateAlertedAt !== null && !w.backupWalkerId && w.backupIdx >= parseJson<string[]>(w.backupCandidatesJson, []).length,
    })),
    openIncidents,
    jobs,
  };
}

const incidentInclude = {
  walk: {
    include: {
      dog: { select: { name: true } },
      walker: { select: { name: true, phone: true } },
      owner: { select: { name: true, phone: true } },
    },
  },
} satisfies Prisma.IncidentLogInclude;

export async function listIncidents(status: "OPEN" | "RESOLVED" | "ALL"): Promise<IncidentDTO[]> {
  const rows = await db.incidentLog.findMany({
    where: status === "ALL" ? {} : { status },
    include: incidentInclude,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  // SOS first while open, then newest.
  if (status === "OPEN") rows.sort((a, b) => Number(b.type === "SOS") - Number(a.type === "SOS"));
  const zones = await zoneNames(rows.map((r) => r.walk?.zoneId ?? "").filter(Boolean));
  const reporters = new Map(
    (
      await db.user.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.reportedBy))] } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name])
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    note: r.note,
    lat: r.lat,
    lng: r.lng,
    mapsUrl: r.lat != null && r.lng != null ? mapsLink({ lat: r.lat, lng: r.lng }) : null,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: iso(r.resolvedAt),
    resolution: r.resolution,
    reporterName: r.reportedBy === "system" ? "Sistema" : (reporters.get(r.reportedBy) ?? "—"),
    walk: r.walk
      ? {
          id: r.walk.id,
          status: r.walk.status,
          scheduledStart: r.walk.scheduledStart.toISOString(),
          dogName: r.walk.dog?.name ?? "",
          zoneName: zones.get(r.walk.zoneId) ?? "",
          walkerName: r.walk.walker.name,
          walkerPhone: r.walk.walker.phone,
          ownerName: r.walk.owner.name,
          ownerPhone: r.walk.owner.phone,
        }
      : null,
  }));
}

/** Walker leaderboard over the last `days` days. */
export async function leaderboard(cfg: AppConfig, days: number, now = new Date()): Promise<LeaderboardRowDTO[]> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const lateMs = cfg.safety.lateStartMinutes * 60_000;
  const [profiles, started, reassigned, unstarted, sos] = await Promise.all([
    db.walkerProfile.findMany({
      where: { status: { in: ["ACTIVE", "SUSPENDED"] } },
      include: { user: { select: { id: true, name: true, avatarUrl: true } }, zone: { select: { name: true } } },
    }),
    db.walk.findMany({
      where: { startedAt: { gte: since } },
      select: { walkerId: true, startedAt: true, scheduledStart: true },
    }),
    db.walk.groupBy({
      by: ["originalWalkerId"],
      where: { originalWalkerId: { not: null }, reassignedAt: { gte: since } },
      _count: { _all: true },
    }),
    db.walk.groupBy({
      by: ["walkerId"],
      where: {
        status: "SCHEDULED",
        scheduledStart: { gte: since, lt: new Date(now.getTime() - UNSTARTED_NO_SHOW_MS) },
      },
      _count: { _all: true },
    }),
    db.incidentLog.groupBy({
      by: ["subjectUserId"],
      where: { type: "SOS", createdAt: { gte: since }, subjectUserId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const stats = new Map<string, { started: number; onTime: number }>();
  for (const w of started) {
    const s = stats.get(w.walkerId) ?? { started: 0, onTime: 0 };
    s.started++;
    if (w.startedAt && w.startedAt.getTime() <= w.scheduledStart.getTime() + lateMs) s.onTime++;
    stats.set(w.walkerId, s);
  }
  const count = (rows: { _count: { _all: number } }[], key: (r: never) => string | null) =>
    new Map(rows.map((r) => [key(r as never), r._count._all]));
  const reassignedBy = count(reassigned, (r: { originalWalkerId: string | null }) => r.originalWalkerId);
  const unstartedBy = count(unstarted, (r: { walkerId: string }) => r.walkerId);
  const sosBy = count(sos, (r: { subjectUserId: string | null }) => r.subjectUserId);

  const rows: LeaderboardRowDTO[] = profiles.map((p) => {
    const s = stats.get(p.userId);
    return {
      userId: p.userId,
      name: p.user.name,
      avatarUrl: p.user.avatarUrl,
      zoneName: p.zone?.name ?? "",
      status: p.status,
      rating: Math.round(p.rating * 100) / 100,
      ratingCount: p.ratingCount,
      walksStarted: s?.started ?? 0,
      onTimePct: s && s.started > 0 ? Math.round((s.onTime / s.started) * 1000) / 10 : null,
      noShows: (reassignedBy.get(p.userId) ?? 0) + (unstartedBy.get(p.userId) ?? 0),
      sosCount: sosBy.get(p.userId) ?? 0,
    };
  });
  rows.sort(
    (a, b) =>
      (b.onTimePct ?? -1) - (a.onTimePct ?? -1) ||
      a.noShows - b.noShows ||
      b.rating - a.rating ||
      b.walksStarted - a.walksStarted
  );
  return rows;
}
