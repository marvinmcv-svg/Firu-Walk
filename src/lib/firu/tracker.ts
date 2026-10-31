"use client";

// Walker GPS tracker (Milestone 4). One walk at a time, independent of which
// screen is open: fixes keep flowing while the walker browses other views or
// the phone is locked (native app).
//
//   source  → throttle (~10 s or 15 m) → seq → local buffer (localStorage)
//           → batch upload POST /api/walks/[id]/track (idempotent by seq)
//           → retry with exponential backoff while offline / on 5xx
//
// Location sources, in order:
//   · native  — Capacitor app with @capacitor-community/background-geolocation
//               (foreground service, works with the screen locked; reports
//               Android mock locations as `simulated`)
//   · sim     — NEXT_PUBLIC_GPS_SIM=true (development / e2e only): a walk
//               around the pickup that goes through the same upload pipeline
//   · browser — navigator.geolocation (PWA; foreground only)

import { Capacitor, CapacitorHttp, registerPlugin } from "@capacitor/core";
import type { BackgroundGeolocationPlugin, Location } from "@capacitor-community/background-geolocation";
import { create } from "zustand";
import { ApiError } from "./api";
import { useFiruSession } from "./session";

export interface Fix {
  lat: number;
  lng: number;
  ts: number;
  acc?: number | null;
  mock?: boolean;
}
type SeqFix = Fix & { seq: number };

export type GpsSource = "native" | "sim" | "browser";
export type GpsError = "permission" | "unavailable" | null;

const MIN_INTERVAL_MS = 10_000;
const MIN_DISTANCE_M = 15;
const UPLOAD_EVERY_MS = 15_000;
const UPLOAD_AT_POINTS = 20;
const MAX_BATCH = 200;
const BACKOFF_MIN_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;
const FIX_FRESH_MS = 30_000;
const FIX_TIMEOUT_MS = 15_000;
const SIM_TICK_MS = 3_000;

const SIM_ENABLED = process.env.NEXT_PUBLIC_GPS_SIM === "true";

export interface TrackerState {
  walkId: string | null;
  source: GpsSource | null;
  /** Fixes recorded on this device for the current walk (display only). */
  points: { seq: number; lat: number; lng: number }[];
  /** Recorded but not yet acknowledged by the server. */
  pending: number;
  /** Authoritative distance from the last upload response. */
  serverDistance: number | null;
  lastSyncAt: number | null;
  /** Last upload failed for a network/server reason (retrying). */
  offline: boolean;
  error: GpsError;
}

export const useTracker = create<TrackerState>(() => ({
  walkId: null,
  source: null,
  points: [],
  pending: 0,
  serverDistance: null,
  lastSyncAt: null,
  offline: false,
  error: null,
}));

/* ------------------------------------------------------------ helpers */

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function gpsSource(): GpsSource {
  if (Capacitor.isNativePlatform()) return "native";
  if (SIM_ENABLED) return "sim";
  return "browser";
}

const BgGeo = registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");

function fromNative(l: Location): Fix {
  return {
    lat: l.latitude,
    lng: l.longitude,
    ts: l.time ?? Date.now(),
    acc: l.accuracy,
    mock: l.simulated === true,
  };
}

function fromBrowser(p: GeolocationPosition): Fix {
  return { lat: p.coords.latitude, lng: p.coords.longitude, ts: p.timestamp, acc: p.coords.accuracy };
}

/* ------------------------------------------------------- local buffer */

interface Stored {
  nextSeq: number;
  points: SeqFix[];
}
const storageKey = (walkId: string) => `fw:track:${walkId}`;

function loadStored(walkId: string): Stored {
  try {
    const raw = localStorage.getItem(storageKey(walkId));
    if (raw) {
      const s = JSON.parse(raw) as Stored;
      if (typeof s.nextSeq === "number" && Array.isArray(s.points)) return s;
    }
  } catch {
    // unavailable storage → memory only
  }
  return { nextSeq: 0, points: [] };
}

function saveStored(walkId: string, s: Stored): void {
  try {
    localStorage.setItem(storageKey(walkId), JSON.stringify(s));
  } catch {
    // quota/private mode: keep going from memory
  }
}

function clearStored(walkId: string): void {
  try {
    localStorage.removeItem(storageKey(walkId));
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------ session */

interface Session {
  walkId: string;
  buf: Stored;
  lastKept: Fix | null;
  lastFix: Fix | null;
  stopSource: () => void;
  uploadTimer: ReturnType<typeof setInterval> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  backoff: number;
  uploading: Promise<void> | null;
  stopped: boolean;
}

let session: Session | null = null;

function publish(patch: Partial<TrackerState>) {
  useTracker.setState(patch);
}

function onFix(s: Session, fix: Fix) {
  if (s.stopped) return;
  s.lastFix = fix;
  if (useTracker.getState().error) publish({ error: null });
  const prev = s.lastKept;
  if (prev && fix.ts - prev.ts < MIN_INTERVAL_MS && distanceM(prev, fix) < MIN_DISTANCE_M) return;
  s.lastKept = fix;
  const seq = s.buf.nextSeq++;
  s.buf.points.push({ ...fix, seq });
  saveStored(s.walkId, s.buf);
  const points = useTracker.getState().points;
  publish({ points: [...points, { seq, lat: fix.lat, lng: fix.lng }], pending: s.buf.points.length });
  if (s.buf.points.length >= UPLOAD_AT_POINTS) void flush();
}

function onSourceError(err: GpsError) {
  publish({ error: err });
}

/** Start the location source; returns a stop function. */
function startSource(s: Session, origin: { lat: number; lng: number } | null): () => void {
  const source = gpsSource();
  publish({ source });

  if (source === "native") {
    let id: string | null = null;
    let cancelled = false;
    BgGeo.addWatcher(
      {
        backgroundTitle: "FiruWalk — paseo en curso",
        backgroundMessage: "Compartiendo tu recorrido con el dueño.",
        requestPermissions: true,
        stale: false,
        distanceFilter: MIN_DISTANCE_M,
      },
      (loc, err) => {
        if (err) return onSourceError(err.code === "NOT_AUTHORIZED" ? "permission" : "unavailable");
        if (loc) onFix(s, fromNative(loc));
      }
    )
      .then((watcherId) => {
        if (cancelled) void BgGeo.removeWatcher({ id: watcherId });
        else id = watcherId;
      })
      .catch(() => onSourceError("unavailable"));
    return () => {
      cancelled = true;
      if (id) void BgGeo.removeWatcher({ id });
    };
  }

  if (source === "sim") {
    let pos = s.lastFix ?? { lat: origin?.lat ?? -17.7931, lng: origin?.lng ?? -63.1998, ts: Date.now() };
    const home = origin ?? pos;
    let heading = Math.random() * 360;
    const step = () => {
      // ~1.3 m/s wander that turns back toward the pickup beyond ~90 m.
      const away = distanceM(home, pos);
      if (away > 90) {
        heading = (Math.atan2(home.lng - pos.lng, home.lat - pos.lat) * 180) / Math.PI;
      }
      heading += (Math.random() - 0.5) * 60;
      const meters = 1.3 * (SIM_TICK_MS / 1_000);
      const rad = (heading * Math.PI) / 180;
      pos = {
        lat: pos.lat + (meters * Math.cos(rad)) / 111_320,
        lng: pos.lng + (meters * Math.sin(rad)) / (111_320 * Math.cos((pos.lat * Math.PI) / 180)),
        ts: Date.now(),
      };
      onFix(s, { ...pos, acc: 5 });
    };
    step();
    const timer = setInterval(step, SIM_TICK_MS);
    return () => clearInterval(timer);
  }

  if (typeof navigator === "undefined" || !navigator.geolocation) {
    onSourceError("unavailable");
    return () => undefined;
  }
  const watchId = navigator.geolocation.watchPosition(
    (p) => onFix(s, fromBrowser(p)),
    (e) => onSourceError(e.code === e.PERMISSION_DENIED ? "permission" : "unavailable"),
    { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 }
  );
  return () => navigator.geolocation.clearWatch(watchId);
}

/* ------------------------------------------------------------- upload */

interface TrackResponse {
  accepted: number;
  rejected: { seq: number; reason: string }[];
  duplicates: number;
  distanceMeters: number;
  lastSeq: number;
}

/**
 * POST a batch. Native app: the native HTTP stack, because Android throttles
 * WebView requests after a few minutes in the background.
 */
async function postBatch(walkId: string, points: SeqFix[]): Promise<TrackResponse> {
  const path = `/api/walks/${walkId}/track`;
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.post({
      url: new URL(path, window.location.origin).toString(),
      headers: { "Content-Type": "application/json" },
      data: { points },
    });
    if (res.status >= 400) {
      throw new ApiError(res.status, (res.data as { error?: string })?.error ?? `HTTP ${res.status}`);
    }
    return res.data as TrackResponse;
  }
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ points }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`);
  return body as TrackResponse;
}

function scheduleRetry(s: Session) {
  if (s.retryTimer || s.stopped) return;
  s.retryTimer = setTimeout(() => {
    s.retryTimer = null;
    void flush();
  }, s.backoff);
  s.backoff = Math.min(BACKOFF_MAX_MS, s.backoff * 2);
}

async function uploadOnce(s: Session): Promise<boolean> {
  const batch = s.buf.points.slice(0, MAX_BATCH);
  if (batch.length === 0) return false;
  try {
    const res = await postBatch(s.walkId, batch);
    const sent = new Set(batch.map((p) => p.seq));
    s.buf.points = s.buf.points.filter((p) => !sent.has(p.seq));
    saveStored(s.walkId, s.buf);
    s.backoff = BACKOFF_MIN_MS;
    publish({
      pending: s.buf.points.length,
      serverDistance: res.distanceMeters,
      lastSyncAt: Date.now(),
      offline: false,
    });
    return s.buf.points.length > 0;
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 0;
    if (status === 400) {
      // The batch itself is unusable; drop it rather than retry forever.
      const sent = new Set(batch.map((p) => p.seq));
      s.buf.points = s.buf.points.filter((p) => !sent.has(p.seq));
      saveStored(s.walkId, s.buf);
      publish({ pending: s.buf.points.length });
      return s.buf.points.length > 0;
    }
    if (status === 401 || status === 403 || status === 404 || status === 409) {
      // Not our walk to track any more (finished elsewhere, logged out…).
      stopTracking({ clear: status !== 401 });
      return false;
    }
    publish({ offline: true });
    scheduleRetry(s);
    return false;
  }
}

/** Upload everything buffered (one request at a time). */
export function flush(): Promise<void> {
  const s = session;
  if (!s) return Promise.resolve();
  if (s.uploading) return s.uploading;
  s.uploading = (async () => {
    try {
      while (session === s && (await uploadOnce(s))) {
        // keep draining
      }
    } finally {
      s.uploading = null;
    }
  })();
  return s.uploading;
}

/** Flush before finishing; resolves true when nothing is left pending. */
export async function flushAll(timeoutMs = 10_000): Promise<boolean> {
  await Promise.race([flush(), new Promise((r) => setTimeout(r, timeoutMs))]);
  return (session?.buf.points.length ?? 0) === 0;
}

/* -------------------------------------------------------------- public */

/**
 * Begin (or resume) tracking `walkId`. `lastSeq` is the highest seq the
 * server already stored, so a reinstall/new device continues numbering.
 */
export function startTracking(opts: {
  walkId: string;
  lastSeq: number;
  origin?: { lat: number; lng: number } | null;
}): void {
  if (session?.walkId === opts.walkId && !session.stopped) return;
  if (session) stopTracking({ clear: false });

  const buf = loadStored(opts.walkId);
  buf.nextSeq = Math.max(buf.nextSeq, opts.lastSeq + 1);
  const s: Session = {
    walkId: opts.walkId,
    buf,
    lastKept: null,
    lastFix: null,
    stopSource: () => undefined,
    uploadTimer: null,
    retryTimer: null,
    backoff: BACKOFF_MIN_MS,
    uploading: null,
    stopped: false,
  };
  session = s;
  publish({
    walkId: opts.walkId,
    points: buf.points.map(({ seq, lat, lng }) => ({ seq, lat, lng })),
    pending: buf.points.length,
    serverDistance: null,
    lastSyncAt: null,
    offline: false,
    error: null,
  });
  s.stopSource = startSource(s, opts.origin ?? null);
  s.uploadTimer = setInterval(() => void flush(), UPLOAD_EVERY_MS);
  if (buf.points.length) void flush();
}

/** Stop the source and timers. `clear` also forgets the local buffer. */
export function stopTracking(opts: { clear: boolean }): void {
  const s = session;
  if (!s) return;
  s.stopped = true;
  s.stopSource();
  if (s.uploadTimer) clearInterval(s.uploadTimer);
  if (s.retryTimer) clearTimeout(s.retryTimer);
  if (opts.clear) clearStored(s.walkId);
  session = null;
  publish({ walkId: null, source: null, points: [], pending: 0, offline: false, error: null });
}

/**
 * One position for start/finish: the tracker's last fix if fresh, otherwise
 * a one-shot reading. Null when location is unavailable or denied.
 */
export async function currentFix(origin?: { lat: number; lng: number } | null): Promise<Fix | null> {
  const last = session?.lastFix;
  if (last && Date.now() - last.ts < FIX_FRESH_MS) return last;

  const source = gpsSource();
  if (source === "sim") {
    // Simulated arrival at the pickup (a few meters off).
    const o = origin ?? { lat: -17.7931, lng: -63.1998 };
    return { lat: o.lat + 0.00005, lng: o.lng - 0.00004, ts: Date.now(), acc: 6 };
  }
  if (source === "native") {
    return new Promise<Fix | null>((resolve) => {
      let id: string | null = null;
      let done = false;
      const finish = (fix: Fix | null, err?: GpsError) => {
        if (done) return;
        done = true;
        if (err) onSourceError(err);
        if (id) void BgGeo.removeWatcher({ id });
        resolve(fix);
      };
      setTimeout(() => finish(null, "unavailable"), FIX_TIMEOUT_MS);
      BgGeo.addWatcher({ requestPermissions: true, stale: false }, (loc, err) => {
        if (err) finish(null, err.code === "NOT_AUTHORIZED" ? "permission" : "unavailable");
        else if (loc) finish(fromNative(loc));
      })
        .then((watcherId) => {
          id = watcherId;
          if (done) void BgGeo.removeWatcher({ id: watcherId });
        })
        .catch(() => finish(null, "unavailable"));
    });
  }
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise<Fix | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(fromBrowser(p)),
      (e) => {
        onSourceError(e.code === e.PERMISSION_DENIED ? "permission" : "unavailable");
        resolve(null);
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: FIX_TIMEOUT_MS }
    );
  });
}

/** Native app: open the app's settings (location permission denied). */
export function openLocationSettings(): void {
  if (Capacitor.isNativePlatform()) void BgGeo.openSettings();
}

if (typeof window !== "undefined") {
  // Connectivity is back → upload what was buffered offline.
  window.addEventListener("online", () => void flush());
  // A different (or no) user must not keep tracking the previous walk.
  let userId = useFiruSession.getState().user?.id ?? null;
  useFiruSession.subscribe((st) => {
    const next = st.user?.id ?? null;
    if (next !== userId) {
      userId = next;
      stopTracking({ clear: false });
    }
  });
}
