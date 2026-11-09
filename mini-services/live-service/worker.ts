// worker.ts — FiruWalk scheduled-job worker (Milestone 8).
//
// Calls the app's GET /api/cron/minute every minute (accept timeouts,
// late-start alerts + backup walkers, reminders) with the cron secret. The
// app makes each run single-flight, so several workers are safe.
//
// Runs inside the live-service when WORKER_APP_URL and CRON_SECRET are set
// (the service is already a long-running container), or standalone:
//   WORKER_APP_URL=http://localhost:3000 CRON_SECRET=… bun run worker
//
// Env:
//   WORKER_APP_URL       base URL of the Next.js app (e.g. https://firu-walk.vercel.app)
//   CRON_SECRET          same value as on the app
//   WORKER_INTERVAL_MS   default 60000

export interface WorkerHandle {
  stop(): void;
}

export function startWorker(opts: {
  appUrl: string;
  secret: string;
  intervalMs?: number;
  log?: (msg: string) => void;
}): WorkerHandle {
  const url = `${opts.appUrl.replace(/\/$/, "")}/api/cron/minute?by=worker`;
  const interval = Math.max(15_000, opts.intervalMs ?? 60_000);
  const log = opts.log ?? ((m: string) => console.log(m));
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;

  const tick = async () => {
    const started = Date.now();
    try {
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${opts.secret}` },
        signal: AbortSignal.timeout(50_000),
      });
      const body = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      if (failures > 0) log(`[worker] recovered after ${failures} failed run(s)`);
      failures = 0;
      const data = JSON.parse(body) as Record<string, unknown>;
      const busy = Object.entries(data).filter(([k, v]) => k !== "runId" && typeof v === "number" && v > 0);
      if (busy.length) log(`[worker] minute: ${busy.map(([k, v]) => `${k}=${v}`).join(" ")}`);
    } catch (err) {
      failures++;
      log(`[worker] minute job failed (${failures}): ${(err as Error).message}`);
    }
    if (!stopped) timer = setTimeout(tick, Math.max(1_000, interval - (Date.now() - started)));
  };

  timer = setTimeout(tick, 2_000);
  log(`[worker] calling ${url} every ${Math.round(interval / 1000)} s`);
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

if (import.meta.main) {
  const appUrl = process.env.WORKER_APP_URL;
  const secret = process.env.CRON_SECRET;
  if (!appUrl || !secret) {
    console.error("[worker] set WORKER_APP_URL and CRON_SECRET");
    process.exit(1);
  }
  const w = startWorker({ appUrl, secret, intervalMs: Number(process.env.WORKER_INTERVAL_MS) || undefined });
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => (w.stop(), process.exit(0)));
}
