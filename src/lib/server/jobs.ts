// Scheduled jobs (Milestone 8). Jobs run from a scheduler — the worker
// (scripts/worker.ts, also embedded in the live-service) or Vercel Cron —
// through /api/cron/*, never as a side effect of user requests.
//
// runJob() makes each job single-flight across instances (JobLock row with a
// lease), records every run in JobRun (Admin → Operaciones shows them) and
// keeps a heartbeat (JobLock.lastRunAt).
//
// Safety net: while no scheduler has run the minute job for
// FALLBACK_STALE_MS (e.g. the worker is not deployed yet), busy API routes
// kick it once in the background with `after()`, so booking timeouts and
// late-start alerts still happen. A healthy worker makes this a no-op.

import { after } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { log } from "./log";
import { getAppConfig } from "./config";
import { sweepExpiredRequests } from "./bookingEngine";
import { detectLateWalks, sweepBackupOffers } from "./safety/backup";
import { sendWalkReminders } from "./safety/reminders";

export type JobName = "minute" | "daily" | "payouts";

const LEASE_MS: Record<JobName, number> = {
  minute: 2 * 60_000,
  daily: 15 * 60_000,
  payouts: 15 * 60_000,
};

export const FALLBACK_STALE_MS = 3 * 60_000;

async function acquire(job: JobName, now: Date): Promise<boolean> {
  const until = new Date(now.getTime() + LEASE_MS[job]);
  const res = await db.jobLock.updateMany({
    where: { job, lockedUntil: { lt: now } },
    data: { lockedUntil: until, lastRunAt: now },
  });
  if (res.count > 0) return true;
  // First run ever: create the row (a concurrent creator wins, we skip).
  const created = await db.jobLock.createMany({
    data: [{ job, lockedUntil: until, lastRunAt: now }],
    skipDuplicates: true,
  });
  return created.count > 0;
}

export type JobOutcome<T> = { skipped: true } | { skipped: false; runId: string; result: T };

/** Run `fn` as `job` unless another instance holds its lease. */
export async function runJob<T>(job: JobName, trigger: string, fn: () => Promise<T>): Promise<JobOutcome<T>> {
  const now = new Date();
  if (!(await acquire(job, now))) return { skipped: true };
  const run = await db.jobRun.create({ data: { job, trigger: trigger.slice(0, 40) } });
  try {
    const result = await fn();
    const done = new Date();
    await db.jobRun.update({
      where: { id: run.id },
      data: { finishedAt: done, ok: true, result: result as unknown as Prisma.InputJsonValue },
    });
    await db.jobLock.update({ where: { job }, data: { lockedUntil: done, lastOkAt: done } });
    return { skipped: false, runId: run.id, result };
  } catch (err) {
    await db.jobRun
      .update({
        where: { id: run.id },
        data: { finishedAt: new Date(), ok: false, error: String((err as Error)?.message ?? err).slice(0, 500) },
      })
      .catch(() => {});
    await db.jobLock.update({ where: { job }, data: { lockedUntil: new Date() } }).catch(() => {});
    throw err;
  }
}

/** HTTP body of a job run: the job's own result (+ runId), or {skipped:true}. */
export function jobBody<T extends object>(o: JobOutcome<T>): object {
  return o.skipped ? { skipped: true } : { runId: o.runId, ...o.result };
}

/** Every minute: accept timeouts, late starts + backup chain, reminders. */
export async function minuteJobs(): Promise<{
  requestsSwept: number;
  lateAlerted: number;
  backupOffersAdvanced: number;
  remindersSent: number;
}> {
  const cfg = await getAppConfig();
  const requestsSwept = await sweepExpiredRequests();
  const lateAlerted = await detectLateWalks(cfg);
  const backupOffersAdvanced = await sweepBackupOffers(cfg);
  const remindersSent = await sendWalkReminders(cfg);
  return { requestsSwept, lateAlerted, backupOffersAdvanced, remindersSent };
}

let lastFallbackCheck = 0;

/**
 * Safety net (see header): if no scheduler ran the minute job recently, run
 * it after this response. Checks the DB at most every 30 s per instance.
 */
export function kickMinuteJobsIfStale(): void {
  const nowMs = Date.now();
  if (nowMs - lastFallbackCheck < 30_000) return;
  lastFallbackCheck = nowMs;
  const task = async () => {
    try {
      const lock = await db.jobLock.findUnique({ where: { job: "minute" } });
      if (lock?.lastRunAt && Date.now() - lock.lastRunAt.getTime() < FALLBACK_STALE_MS) return;
      await runJob("minute", "fallback", minuteJobs);
    } catch (err) {
      log.warn("jobs.fallback_failed", { err });
    }
  };
  try {
    after(task);
  } catch {
    // Outside a request scope (tests/scripts): run detached.
    void task();
  }
}
