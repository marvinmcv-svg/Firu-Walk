// GPS track validation (Milestone 4). Pure functions — no I/O — so the rules
// are unit-testable; the track route loads state, calls validateTrackBatch()
// and persists the result.
//
// Rules for each incoming fix, in device `seq` order:
//   · mock_location  — the device flagged it as a mock/simulated location
//   · inaccurate     — reported accuracy worse than maxAccuracyMeters
//   · out_of_order   — seq at or below one already processed, or timestamp
//                      not after the last accepted fix
//   · bad_timestamp  — before the walk started or in the future
//   · teleport       — farther than maxJumpMeters from the last accepted fix
//   · too_fast       — implied speed above maxSpeedKmh (GPS accuracy is
//                      subtracted from the distance first, capped)
// Distance only accumulates over accepted → accepted segments.
//
// Re-anchoring: if a single bad fix were ever accepted, every later real fix
// would look like a teleport. So after REANCHOR_STREAK consecutive
// motion-rejected fixes that are plausible *among themselves*, the last one
// becomes the new anchor. The jump itself never counts toward distance.

import type { AppConfig } from "@/lib/firu/types";

export interface Fix {
  seq: number;
  lat: number;
  lng: number;
  ts: number; // epoch ms (device clock)
  acc?: number | null; // meters
  mock?: boolean;
}

export type RejectReason =
  | "mock_location"
  | "inaccurate"
  | "out_of_order"
  | "bad_timestamp"
  | "teleport"
  | "too_fast";

const MOTION_REASONS: ReadonlySet<string> = new Set(["teleport", "too_fast"]);

/** Max GPS error subtracted from a segment before computing speed. */
const ACCURACY_SLACK_CAP_M = 30;
/** Device clocks drift; allow this much into the future. */
const FUTURE_SKEW_MS = 2 * 60_000;
/** Fixes may be recorded slightly before the server marked the walk started. */
const PRE_START_SKEW_MS = 2 * 60_000;
export const REANCHOR_STREAK = 3;

export type TrackRules = AppConfig["tracking"];

export interface TrackState {
  /** Last accepted fix (or the walk's start position, seq -1). */
  anchor: Fix | null;
  /** Motion-rejected fixes after the anchor, oldest first (≤ REANCHOR_STREAK-1). */
  streak: Fix[];
  /** Highest seq already stored (accepted or rejected); -1 when none. */
  maxSeq: number;
}

export interface ValidatedFix extends Fix {
  rejectReason: RejectReason | null;
  /** Meters added to the walk distance by this fix. */
  addMeters: number;
}

export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Why moving from `from` to `to` is implausible, or null when it is fine. */
function motionCheck(from: Fix, to: Fix, rules: TrackRules): RejectReason | null {
  const d = haversineMeters(from, to);
  if (d > rules.maxJumpMeters) return "teleport";
  const dt = (to.ts - from.ts) / 1_000;
  if (dt <= 0) return "out_of_order";
  const slack = Math.min(ACCURACY_SLACK_CAP_M, (from.acc ?? 0) + (to.acc ?? 0));
  const kmh = (Math.max(0, d - slack) / dt) * 3.6;
  return kmh > rules.maxSpeedKmh ? "too_fast" : null;
}

/**
 * Validate a batch of new fixes against the stored state. `fixes` must not
 * contain seqs already stored (the route filters duplicates first).
 * Returns per-fix verdicts and the state after the batch.
 */
export function validateTrackBatch(
  state: TrackState,
  fixes: Fix[],
  rules: TrackRules,
  window: { startedAt: number; now: number }
): { results: ValidatedFix[]; state: TrackState } {
  let { anchor, maxSeq } = state;
  let streak = [...state.streak];
  const results: ValidatedFix[] = [];

  for (const fix of [...fixes].sort((a, b) => a.seq - b.seq)) {
    let reason: RejectReason | null = null;
    let addMeters = 0;

    if (fix.mock) reason = "mock_location";
    else if (fix.acc != null && fix.acc > rules.maxAccuracyMeters) reason = "inaccurate";
    else if (fix.seq <= maxSeq) reason = "out_of_order";
    else if (fix.ts > window.now + FUTURE_SKEW_MS || fix.ts < window.startedAt - PRE_START_SKEW_MS) {
      reason = "bad_timestamp";
    } else if (anchor) {
      reason = motionCheck(anchor, fix, rules);
      if (reason === "out_of_order" && anchor.seq < 0) {
        // Anchored on the start position: only the clock matters, not order.
        reason = null;
      }
    }

    if (reason && MOTION_REASONS.has(reason)) {
      streak = extendStreak(streak, fix, rules);
      if (streak.length >= REANCHOR_STREAK) {
        // Sustained, self-consistent movement: trust it from here on (the
        // jump to it is not counted).
        anchor = fix;
        streak = [];
        reason = null;
      }
    } else if (!reason) {
      if (anchor && anchor.seq >= 0) addMeters = haversineMeters(anchor, fix);
      anchor = fix;
      streak = [];
    }

    maxSeq = Math.max(maxSeq, fix.seq);
    results.push({ ...fix, rejectReason: reason, addMeters });
  }
  return { results, state: { anchor, streak, maxSeq } };
}

/** Add a motion-rejected fix to the streak; an implausible step restarts it. */
function extendStreak(streak: Fix[], fix: Fix, rules: TrackRules): Fix[] {
  const prev = streak[streak.length - 1];
  return !prev || motionCheck(prev, fix, rules) === null ? [...streak, fix] : [fix];
}

/** Rebuild the streak from stored motion-rejected fixes (oldest first). */
export function streakOf(fixes: Fix[], rules: TrackRules): Fix[] {
  return fixes.reduce<Fix[]>((streak, f) => extendStreak(streak, f, rules), []);
}

/** Distance from a position to the pickup, minus (capped) GPS accuracy. */
export function geofenceDistance(
  pos: { lat: number; lng: number; acc?: number | null },
  pickup: { lat: number; lng: number }
): { meters: number; effective: number } {
  const meters = haversineMeters(pos, pickup);
  return { meters, effective: Math.max(0, meters - Math.min(50, pos.acc ?? 0)) };
}
