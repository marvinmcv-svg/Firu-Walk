// Structured logger — one JSON object per line in production (Vercel/Docker
// log drains can index the fields), readable single lines in development.
// Usage: log.info("booking.created", { bookingId }); log.error("api.unhandled", { err })

type Level = "debug" | "info" | "warn" | "error";

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel(): Level {
  const v = process.env.LOG_LEVEL;
  return v === "debug" || v === "info" || v === "warn" || v === "error" ? v : "info";
}

/** Errors don't JSON.stringify — flatten them into plain fields. */
function normalize(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] =
      v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v;
  }
  return out;
}

function emit(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  if (RANK[level] < RANK[minLevel()]) return;
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  const data = normalize(fields);
  if (process.env.NODE_ENV === "production") {
    sink(JSON.stringify({ ts: new Date().toISOString(), level, event, ...data }));
  } else {
    sink(`[${level}] ${event}`, Object.keys(data).length ? data : "");
  }
}

export const log = {
  debug: (event: string, fields?: Record<string, unknown>) => emit("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => emit("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit("error", event, fields),
};
