// Date/time formatting — locale-aware (es-BO default / en), 12h clock.
// All display helpers live here and read the active language at call time
// through langCore, so they stay safe to import from API routes too.
//
// IMPORTANT: ES output is byte-identical to the original app (Playwright
// asserts it). Components that render dates must call useT() so they
// re-render when the language changes.

import { getLangCore, type Lang } from "./langCore";

const DAYS_ES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_SHORT_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const DAYS_SHORT_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Legacy constant exports (es) kept for compatibility — prefer daysShort(lang).
export const DAYS = DAYS_ES;
export const DAYS_SHORT = DAYS_SHORT_ES;

export function daysLong(lang: Lang = getLangCore()): string[] {
  return lang === "en" ? DAYS_EN : DAYS_ES;
}

export function daysShort(lang: Lang = getLangCore()): string[] {
  return lang === "en" ? DAYS_SHORT_EN : DAYS_SHORT_ES;
}

export function monthsShort(lang: Lang = getLangCore()): string[] {
  return lang === "en" ? MONTHS_EN : MONTHS_ES;
}

export function toDate(iso: string | Date | null | undefined): Date | null {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** es "lun 25 oct" · en "Mon 25 Oct" */
export function fmtDateShort(iso: string | Date | null | undefined): string {
  const d = toDate(iso);
  if (!d) return "—";
  const lang = getLangCore();
  return `${daysShort(lang)[d.getDay()]} ${d.getDate()} ${monthsShort(lang)[d.getMonth()]}`;
}

/** es "lunes 25 de octubre" · en "Monday, October 25" */
export function fmtDateLong(iso: string | Date | null | undefined): string {
  const d = toDate(iso);
  if (!d) return "—";
  const lang = getLangCore();
  if (lang === "en") {
    return `${DAYS_EN[d.getDay()]}, ${["January","February","March","April","May","June","July","August","September","October","November","December"][d.getMonth()]} ${d.getDate()}`;
  }
  return `${DAYS_ES[d.getDay()].toLowerCase()} ${d.getDate()} de ${MONTHS_ES[d.getMonth()]}`;
}

/** "7:30 am" (no leading zero, lowercase) — same in both languages */
export function fmtTime(iso: string | Date | null | undefined): string {
  const d = toDate(iso);
  if (!d) return "—";
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

/** "7:30" from minute-of-day (450 → "7:30") */
export function minuteOfDay(m: number): string {
  const h = Math.floor(m / 60);
  const mm = (m % 60).toString().padStart(2, "0");
  return `${h}:${mm}`;
}

/** es "hace 5 min" · en "5 min ago" */
export function fmtRelative(iso: string | Date | null | undefined): string {
  const d = toDate(iso);
  if (!d) return "—";
  const lang = getLangCore();
  const en = lang === "en";
  const diffMs = Date.now() - d.getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return en ? "just now" : "recién";
  if (min < 60) return en ? `${min} min ago` : `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return en ? `${h} h ago` : `hace ${h} h`;
  if (h < 48) return en ? "yesterday" : "ayer";
  const days = Math.round(h / 24);
  if (days < 30) return en ? `${days} days ago` : `hace ${days} días`;
  return fmtDateShort(d);
}

/** Recurring schedule → es "Lun · Mié · Vie 7:30 am" · en "Mon · Wed · Fri 7:30 am" */
export function fmtSchedule(
  schedule: { day?: number; date?: string; minute: number }[],
  type: "ONE_OFF" | "RECURRING"
): string {
  if (!schedule?.length) return "—";
  if (type === "RECURRING") {
    const short = daysShort();
    const days = [...schedule]
      .sort((a, b) => (a.day ?? 0) - (b.day ?? 0))
      .map((s) => short[s.day ?? 0]);
    const minute = schedule[0].minute;
    return `${days.join(" · ")} ${fmtTimeFromMinute(minute)}`;
  }
  const s = schedule[0];
  const dateStr = s.date
    ? fmtDateShort(new Date(`${s.date}T12:00:00`)
    )
    : "";
  return `${dateStr} ${fmtTimeFromMinute(s.minute)}`.trim();
}

function fmtTimeFromMinute(minute: number): string {
  const h24 = Math.floor(minute / 60);
  const m = (minute % 60).toString().padStart(2, "0");
  const ap = h24 >= 12 ? "pm" : "am";
  const h = h24 % 12 || 12;
  return `${h}:${m} ${ap}`;
}

/** es "en 2 días" · en "in 2 days" */
export function fmtUntil(iso: string | Date | null | undefined): string {
  const d = toDate(iso);
  if (!d) return "—";
  const en = getLangCore() === "en";
  const diffMs = d.getTime() - Date.now();
  if (diffMs < 0) return fmtRelative(d);
  const h = Math.round(diffMs / 3600000);
  if (h < 1) {
    const m = Math.max(1, Math.round(diffMs / 60000));
    return en ? `in ${m} min` : `en ${m} min`;
  }
  if (h < 24) return en ? `in ${h} h` : `en ${h} h`;
  const days = Math.round(h / 24);
  return en ? `in ${days} day${days > 1 ? "s" : ""}` : `en ${days} día${days > 1 ? "s" : ""}`;
}
