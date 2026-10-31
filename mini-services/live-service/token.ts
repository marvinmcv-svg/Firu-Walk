// token.ts — verify the short-lived HS256 tokens minted by the Next.js API
// (src/lib/server/realtime.ts). Kept dependency-free on purpose; the format
// is a plain JWT so either side can be swapped for a library later.
//
// Token kinds (claim `typ`):
//   conn     — socket handshake: who the user is          { sub, name, role }
//   room     — permission to join one room                { sub, room, cap, st? }
//   internal — the API publishing an event to a room      {}

import { createHmac, timingSafeEqual } from "node:crypto";

export type Role = "OWNER" | "WALKER" | "ADMIN";
/** What a room ticket allows: watch, act as the assigned walker, or admin. */
export type Cap = "view" | "walker" | "admin";

export interface ConnClaims {
  typ: "conn";
  sub: string;
  name: string;
  role: Role;
  exp: number;
}

export interface RoomClaims {
  typ: "room";
  sub: string;
  room: string;
  cap: Cap;
  /** Walk status at issue time (walk rooms only). */
  st?: string;
  exp: number;
}

export interface InternalClaims {
  typ: "internal";
  exp: number;
}

type Claims = ConnClaims | RoomClaims | InternalClaims;

/** Development fallback — must match src/lib/server/realtime.ts. */
export const DEV_REALTIME_SECRET = "firuwalk-dev-only-realtime-secret-do-not-use";

const b64url = (buf: Buffer): string => buf.toString("base64url");

/** Returns the claims when the signature is valid, `typ` matches and it has not expired. */
export function verifyToken<T extends Claims["typ"]>(
  token: unknown,
  secret: string,
  typ: T,
): Extract<Claims, { typ: T }> | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;

  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  try {
    const h = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
    if (h?.alg !== "HS256") return null;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (claims?.typ !== typ) return null;
    if (typeof claims.exp !== "number" || claims.exp * 1_000 <= Date.now()) return null;
    return claims as Extract<Claims, { typ: T }>;
  } catch {
    return null;
  }
}

/** Test helper / reference implementation of the signer. */
export function signToken(claims: Record<string, unknown>, secret: string): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64url(Buffer.from(JSON.stringify(claims)));
  const sig = b64url(createHmac("sha256", secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}
