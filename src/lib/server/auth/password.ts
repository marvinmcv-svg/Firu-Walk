// Password hashing for the admin username/password sign-in.
// Format: "scrypt$<N>$<saltHex>$<hashHex>" — salted, memory-hard, and the
// plain password never touches the repo or the database.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const N = 16384;
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N, r: 8, p: 1 });
  return `scrypt$${N}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** Constant-time check of `password` against a hashPassword() string. */
export function verifyPassword(password: string, stored: string): boolean {
  const [alg, nStr, saltHex, hashHex] = stored.split("$");
  if (alg !== "scrypt" || !nStr || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, {
    N: Number(nStr),
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
