// sim.ts — server-side GPS walk simulation for FiruWalk live walks.
//
// Simulates a dog walker wandering around Santa Cruz de la Sierra:
//   · heading random-walks ±35° per tick (jittered, so the path looks organic)
//   · speed ~1.35 m/s → ≈3.4 m per 2.5 s tick (STEP_METERS)
//   · after ~55% of the 30-minute budget (720 points max) the heading is
//     biased back toward the origin so the route loops home
//   · at 720 points the simulation stops ("budget" end reason)
//
// Pure math, no I/O — the server (index.ts) wires callbacks to socket rooms.

export interface LivePoint {
  seq: number;
  lat: number;
  lng: number;
  ts: number;
  distMeters: number;
}

/** Default origin: Santa Cruz de la Sierra, Bolivia. */
export const SANTA_CRUZ = { lat: -17.7931, lng: -63.1998 } as const;

/** One simulated GPS point every 2.5 seconds. */
export const TICK_MS = 2_500;

/** Walking speed ~1.35 m/s (≈4.86 km/h, brisk dog walk). */
const SPEED_MPS = 1.35;

/** Ground covered per tick: 1.35 m/s × 2.5 s ≈ 3.4 m between points. */
export const STEP_METERS = SPEED_MPS * (TICK_MS / 1_000);

/** 30-minute budget at one point per 2.5 s. */
export const MAX_POINTS = 720;

/** Heading random-walk amplitude per tick (±35°). */
const HEADING_JITTER_DEG = 35;

/** After this fraction of the budget, start steering back home. */
const RETURN_BIAS_FROM = 0.55;

const EARTH_R_M = 6_371_000;
const M_PER_DEG_LAT = 111_320;

export type SimEndReason = "budget" | "stopped" | "idle" | "shutdown";

export interface WalkSimOptions {
  walkId: string;
  startLat?: number;
  startLng?: number;
  /** Called for every new simulated GPS point (seq increments from 1). */
  onPoint: (point: LivePoint) => void;
  /** Called exactly once when the simulation finishes. */
  onEnd: (reason: SimEndReason) => void;
}

interface LatLng {
  lat: number;
  lng: number;
}

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;
/** Round to ~1e-6 deg (≈0.11 m) to keep payloads compact. */
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** Great-circle distance between two coordinates, in meters. */
function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing (degrees, 0 = north) from `from` to `to`. */
function bearingTo(from: LatLng, to: LatLng): number {
  const f1 = toRad(from.lat);
  const l1 = toRad(from.lng);
  const f2 = toRad(to.lat);
  const l2 = toRad(to.lng);
  const y = Math.sin(l2 - l1) * Math.cos(f2);
  const x =
    Math.cos(f1) * Math.sin(f2) -
    Math.sin(f1) * Math.cos(f2) * Math.cos(l2 - l1);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Move `meters` from `from` along `headingDeg` (local flat-earth step). */
function stepBy(from: LatLng, headingDeg: number, meters: number): LatLng {
  const brng = toRad(headingDeg);
  const lat = from.lat + (meters * Math.cos(brng)) / M_PER_DEG_LAT;
  const lng =
    from.lng +
    (meters * Math.sin(brng)) / (M_PER_DEG_LAT * Math.cos(toRad(from.lat)));
  return { lat, lng };
}

/** Blend angle `a` toward angle `b` with weight 0..1 (shortest arc). */
function mixAngles(a: number, b: number, weightB: number): number {
  const diff = (((b - a + 540) % 360) - 180) as number; // signed shortest delta
  return (a + diff * weightB + 360) % 360;
}

export class WalkSim {
  readonly walkId: string;
  readonly origin: LatLng;
  /** All points emitted so far (kept so rejoiners can catch up). */
  readonly points: LivePoint[] = [];

  private pos: LatLng;
  private heading: number;
  private seq = 0;
  private dist = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ended = false;
  private readonly onPoint: (point: LivePoint) => void;
  private readonly onEnd: (reason: SimEndReason) => void;

  constructor(opts: WalkSimOptions) {
    this.walkId = opts.walkId;
    this.origin = {
      lat: opts.startLat ?? SANTA_CRUZ.lat,
      lng: opts.startLng ?? SANTA_CRUZ.lng,
    };
    this.pos = { ...this.origin };
    this.heading = Math.random() * 360; // random initial direction
    this.onPoint = opts.onPoint;
    this.onEnd = opts.onEnd;
  }

  /** Cumulative walked distance in meters (haversine sum). */
  get distanceMeters(): number {
    return this.dist;
  }

  get isRunning(): boolean {
    return this.timer !== null && !this.ended;
  }

  start(): void {
    if (this.timer !== null || this.ended) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** Stop the simulation. `onEnd` fires exactly once (no-op if already ended). */
  stop(reason: SimEndReason = "stopped"): void {
    if (this.ended) return;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.ended = true;
    this.onEnd(reason);
  }

  private tick(): void {
    this.seq += 1;

    // Heading random-walk: ±35° jitter each tick.
    const jitter = (Math.random() * 2 - 1) * HEADING_JITTER_DEG;
    const returnFrom = Math.floor(MAX_POINTS * RETURN_BIAS_FROM); // ≈ point 396

    if (this.seq > returnFrom) {
      // Past ~55% of the budget: bias the heading back toward the origin so
      // the path loops home. The pull strengthens as the budget runs out.
      const progress =
        (this.seq - returnFrom) / Math.max(1, MAX_POINTS - returnFrom); // 0→1
      const home = bearingTo(this.pos, this.origin);
      const weight = 0.25 + 0.6 * Math.min(1, Math.max(0, progress));
      this.heading = mixAngles(this.heading + jitter, home, weight);
    } else {
      this.heading = (this.heading + jitter + 360) % 360;
    }

    const next = stepBy(this.pos, this.heading, STEP_METERS);
    this.dist += haversineM(this.pos, next);
    this.pos = next;

    const point: LivePoint = {
      seq: this.seq,
      lat: round6(next.lat),
      lng: round6(next.lng),
      ts: Date.now(),
      distMeters: Math.round(this.dist * 10) / 10,
    };
    this.points.push(point);
    this.onPoint(point);

    if (this.seq >= MAX_POINTS) {
      this.stop("budget");
    }
  }
}
