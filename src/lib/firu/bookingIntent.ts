// Booking links (Milestone 9): FirulAI's "Book now" button and shared links
// look like /?book=1&zone=<zoneKey>&duration=<30|45|60>.
//   owner signed in → the booking wizard, pre-filled
//   signed out      → the landing booking funnel, pre-filled
//   walker / admin  → ignored

import { useFiruSession, type BookingIntent } from "./session";

export function parseBookingParams(params: URLSearchParams): BookingIntent | null {
  if (params.get("book") !== "1") return null;
  const zone = params.get("zone");
  const duration = Number(params.get("duration"));
  return {
    ...(zone && /^[a-z0-9-]{2,40}$/.test(zone) ? { zoneKey: zone } : {}),
    ...([30, 45, 60].includes(duration) ? { durationMin: duration } : {}),
  };
}

/** Parse a full booking URL from FirulAI (same-origin only). */
export function bookingIntentFromUrl(url: string): BookingIntent | null {
  try {
    const u = new URL(url, window.location.origin);
    return parseBookingParams(u.searchParams);
  } catch {
    return null;
  }
}

/** Apply a booking intent in place (no reload). Returns false when it doesn't apply. */
export function openBookingIntent(intent: BookingIntent): boolean {
  const s = useFiruSession.getState();
  if (s.user?.role === "OWNER") {
    s.startBookingFlow({ zoneKey: intent.zoneKey, durationMin: intent.durationMin });
    return true;
  }
  if (!s.user) {
    s.setLandingBookingIntent({ ...intent, nonce: Date.now() });
    requestAnimationFrame(() =>
      document.getElementById("reservar")?.scrollIntoView({ behavior: "smooth", block: "start" })
    );
    return true;
  }
  return false;
}
