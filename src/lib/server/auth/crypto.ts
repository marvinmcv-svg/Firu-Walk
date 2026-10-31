// Keyed hashing for secrets we must compare but never store in clear
// (session tokens, login codes). HMAC-SHA256 with SESSION_SECRET.

import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

// Development/test fallback only — env.ts makes SESSION_SECRET mandatory in production.
const DEV_SECRET = "firuwalk-dev-only-secret-do-not-use-in-production";

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is not configured");
  }
  return DEV_SECRET;
}

/** HMAC-SHA256(value) as hex. `purpose` domain-separates token vs code hashes. */
export function keyedHash(purpose: string, value: string): string {
  return createHmac("sha256", secret()).update(`${purpose}:${value}`).digest("hex");
}

/** Constant-time comparison of two hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** 32 random bytes, base64url — the session cookie value. */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Uniformly random 6-digit login code. */
export function newOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}
