// Storage selection: STORAGE_PROVIDER=s3 (production: Cloudflare R2) | mock.
// Unset → mock outside production, "not configured" in production. The mock
// is refused in production so vetting documents never land on a function's
// ephemeral disk.

import { MockStorageProvider } from "./mockProvider";
import type { StorageProvider } from "./provider";
import { StorageUnavailable } from "./provider";
import { S3Provider } from "./s3Provider";

export { StorageUnavailable } from "./provider";
export type { PresignedPut, StorageProvider } from "./provider";

function isProduction(): boolean {
  return process.env.VERCEL_ENV === "production" || (process.env.NODE_ENV === "production" && !process.env.VERCEL_ENV);
}

export function storageProviderName(): string | null {
  const set = process.env.STORAGE_PROVIDER;
  if (set) return set;
  return isProduction() ? null : "mock";
}

export function getStorage(): StorageProvider {
  const name = storageProviderName();
  switch (name) {
    case "s3":
      return new S3Provider();
    case "mock":
      if (isProduction()) throw new StorageUnavailable("Mock storage cannot be used in production.");
      return new MockStorageProvider();
    default:
      throw new StorageUnavailable("Document storage is not configured yet.");
  }
}
