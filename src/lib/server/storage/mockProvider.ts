// Development/test storage: files on local disk, served only through
// /api/storage/mock with an HMAC-signed, expiring token — the same contract
// as real presigned URLs, so the app code and tests exercise the real flow.

import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PresignedPut, StorageProvider, StoredObjectInfo } from "./provider";

const ROOT = process.env.MOCK_STORAGE_DIR || path.join(tmpdir(), "firuwalk-mock-storage");
const DEV_SECRET = "firuwalk-dev-only-storage-secret";

function secret(): string {
  return process.env.SESSION_SECRET || DEV_SECRET;
}

export type MockOp = "put" | "get";

export function signMockToken(op: MockOp, key: string, exp: number, contentType = ""): string {
  return createHmac("sha256", secret()).update(`mockstore:${op}:${key}:${exp}:${contentType}`).digest("base64url");
}

export function verifyMockToken(op: MockOp, key: string, exp: number, sig: string, contentType = ""): boolean {
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const want = Buffer.from(signMockToken(op, key, exp, contentType));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Resolve a key inside ROOT, refusing any path traversal. */
export function mockPath(key: string): string {
  if (!/^[A-Za-z0-9/_.-]+$/.test(key) || key.includes("..")) throw new Error("Invalid storage key");
  return path.join(ROOT, key);
}

export class MockStorageProvider implements StorageProvider {
  readonly name = "mock";

  async presignPut(key: string, contentType: string, expiresSec: number): Promise<PresignedPut> {
    const exp = Math.floor(Date.now() / 1000) + expiresSec;
    const q = new URLSearchParams({ key, exp: String(exp), sig: signMockToken("put", key, exp, contentType) });
    return {
      url: `/api/storage/mock?${q}`, // same-origin: works on any host
      method: "PUT",
      headers: { "content-type": contentType },
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  async presignGet(key: string, expiresSec: number): Promise<string> {
    const exp = Math.floor(Date.now() / 1000) + expiresSec;
    const q = new URLSearchParams({ key, exp: String(exp), sig: signMockToken("get", key, exp) });
    return `/api/storage/mock?${q}`;
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    try {
      const st = await stat(mockPath(key));
      const meta = await readFile(`${mockPath(key)}.type`, "utf8").catch(() => null);
      return { sizeBytes: st.size, contentType: meta };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(mockPath(key), { force: true });
    await rm(`${mockPath(key)}.type`, { force: true });
  }

  /** Used by the mock route (and tests) to store bytes. */
  async write(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const p = mockPath(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, bytes);
    await writeFile(`${p}.type`, contentType);
  }

  async read(key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    try {
      const p = mockPath(key);
      return { bytes: await readFile(p), contentType: (await readFile(`${p}.type`, "utf8").catch(() => "")) || "application/octet-stream" };
    } catch {
      return null;
    }
  }
}
