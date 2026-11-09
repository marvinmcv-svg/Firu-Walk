// Field-level encryption for sensitive identifiers (walker CI number).
// AES-256-GCM, random 96-bit IV per value, key from ID_ENCRYPTION_KEY.
// Stored format: "v1:<iv b64url>:<tag b64url>:<ciphertext b64url>" — the
// version prefix leaves room for key rotation.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Development/test fallback only — env.ts makes ID_ENCRYPTION_KEY mandatory in production.
const DEV_KEY = Buffer.alloc(32, "firuwalk-dev-only-id-key");

function key(): Buffer {
  const k = process.env.ID_ENCRYPTION_KEY;
  if (k) {
    const buf = Buffer.from(k, "base64");
    if (buf.length !== 32) throw new Error("ID_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
    return buf;
  }
  if (process.env.NODE_ENV === "production") throw new Error("ID_ENCRYPTION_KEY is not configured");
  return DEV_KEY;
}

export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(":");
}

/** Decrypts a value from encryptField(); throws if it was tampered with. */
export function decryptField(stored: string): string {
  const [v, iv, tag, ct] = stored.split(":");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unrecognized encrypted field format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

/** Normalize a Bolivian CI ("1234567 SC", "1234567-1A") to digits + extension. */
export function normalizeCi(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/** Last 4 digits for display ("•••• 4567"). */
export function ciLast4(normalized: string): string {
  const digits = normalized.replace(/\D/g, "");
  return digits.slice(-4);
}
