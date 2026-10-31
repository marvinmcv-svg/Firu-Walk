// Bolivia (America/La_Paz) timezone helpers — UTC-4 year-round, no DST.
// The DB stores UTC Dates; "local" wall-clock semantics are computed here.
// Same conventions as prisma/seed.ts.

import type { ScheduleItem } from "@/lib/firu/types";

export const BO_OFFSET_MS = 4 * 60 * 60 * 1000;

/** Current time shifted so getUTC* reflect Bolivia wall clock. */
export function boNow(): Date {
  return new Date(Date.now() - BO_OFFSET_MS);
}

/** Bolivia-local day-of-week (0=Sun .. 6=Sat) of a UTC Date. */
export function boDayOfWeek(d: Date): number {
  return new Date(d.getTime() - BO_OFFSET_MS).getUTCDay();
}

/** Bolivia-local "YYYY-MM-DD" of a UTC Date. */
export function boDateKey(d: Date): string {
  return new Date(d.getTime() - BO_OFFSET_MS).toISOString().slice(0, 10);
}

/** Build UTC Date from Bolivia-local Y/M/D H:MM (ints). */
export function boLocal(y: number, m: number, d: number, hour = 0, minute = 0): Date {
  return new Date(Date.UTC(y, m, d, hour, minute, 0) + BO_OFFSET_MS);
}

/** Start of the Bolivia-local day containing `d` (defaults to today). */
export function boDayStart(d: Date = new Date()): Date {
  const b = new Date(d.getTime() - BO_OFFSET_MS);
  return boLocal(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
}

/** Start of the Bolivia-local day `offsetDays` from today. */
export function boDayStartOffset(offsetDays: number): Date {
  const b = boNow();
  return boLocal(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate() + offsetDays);
}

/**
 * Next `count` occurrences of a weekly slot: Bolivia-local weekday `dayOfWeek`
 * at `minute` (minutes from 00:00), strictly after `from` (defaults to now).
 */
export function nextOccurrences(dayOfWeek: number, minute: number, count: number, from: Date = new Date()): Date[] {
  const out: Date[] = [];
  const b = new Date(from.getTime() - BO_OFFSET_MS);
  // scan up to 8 weeks ahead
  for (let offset = 0; offset < 56 && out.length < count; offset++) {
    const d = boLocal(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate() + offset, Math.floor(minute / 60), minute % 60);
    if (d.getTime() > from.getTime() && boDayOfWeek(d) === dayOfWeek) out.push(d);
  }
  return out;
}

/**
 * "YYYY-MM-DD" + minute (minutes from 00:00 Bolivia local) → UTC Date.
 * Returns null for malformed dates.
 */
export function dateAtLocalMinute(dateStr: string, minute: number): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  const date = boLocal(y, mo, d, Math.floor(minute / 60), minute % 60);
  // reject impossible dates (e.g. Feb 31) that rolled over
  const check = new Date(date.getTime() - BO_OFFSET_MS);
  if (check.getUTCDate() !== d) return null;
  return date;
}

/** Spanish weekday abbreviations for summaries/notifications. */
export const DAY_ES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"] as const;
export const DAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * Human summary for notifications: "lun/mié/vie 07:30" or "25/10 17:00"
 * (English: "Mon/Wed/Fri 07:30" or "10/25 17:00").
 */
export function scheduleSummary(
  schedule: ScheduleItem[],
  type: "ONE_OFF" | "RECURRING",
  locale: "es" | "en" = "es"
): string {
  const dayNames = locale === "en" ? DAY_EN : DAY_ES;
  if (type === "RECURRING") {
    const byMinute = new Map<number, number[]>();
    for (const s of schedule) {
      if (typeof s.day !== "number") continue;
      const arr = byMinute.get(s.minute) ?? [];
      arr.push(s.day);
      byMinute.set(s.minute, arr);
    }
    return [...byMinute.entries()]
      .map(([minute, days]) => {
        const hh = `${Math.floor(minute / 60)}`.padStart(2, "0");
        const mm = `${minute % 60}`.padStart(2, "0");
        const dayStr = [...days].sort((a, b) => a - b).map((d) => dayNames[d]).join("/");
        return `${dayStr} ${hh}:${mm}`;
      })
      .join(" · ");
  }
  return schedule
    .map((s) => {
      const hh = `${Math.floor(s.minute / 60)}`.padStart(2, "0");
      const mm = `${s.minute % 60}`.padStart(2, "0");
      const [, mo = "", da = ""] = (s.date ?? "").split("-");
      return `${locale === "en" ? `${mo}/${da}` : `${da}/${mo}`} ${hh}:${mm}`;
    })
    .join(" · ");
}

