// Private object storage — the interface every backend implements.
// Objects are NEVER public: uploads go through a short-lived presigned PUT,
// reads through a short-lived presigned GET issued only to authorized users.

export interface PresignedPut {
  url: string;
  method: "PUT";
  /** Headers the client must send with the PUT (signed into the URL). */
  headers: Record<string, string>;
  expiresAt: string;
}

export interface StoredObjectInfo {
  sizeBytes: number;
  contentType: string | null;
}

export interface StorageProvider {
  readonly name: string;
  presignPut(key: string, contentType: string, expiresSec: number): Promise<PresignedPut>;
  presignGet(key: string, expiresSec: number): Promise<string>;
  /** null when the object does not exist. */
  head(key: string): Promise<StoredObjectInfo | null>;
  delete(key: string): Promise<void>;
}

/** Thrown when no storage backend is configured (routes answer 503). */
export class StorageUnavailable extends Error {}
