// S3-compatible storage (Cloudflare R2 in production; also AWS S3, Supabase
// Storage, MinIO). Presigning uses SigV4 query signing via aws4fetch, the
// client Cloudflare documents for R2. Path-style URLs: <endpoint>/<bucket>/<key>.

import { AwsClient } from "aws4fetch";
import type { PresignedPut, StorageProvider, StoredObjectInfo } from "./provider";
import { StorageUnavailable } from "./provider";

export class S3Provider implements StorageProvider {
  readonly name = "s3";
  private client: AwsClient;
  private base: string;

  constructor() {
    const { STORAGE_BUCKET, STORAGE_ENDPOINT, STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY } = process.env;
    if (!STORAGE_BUCKET || !STORAGE_ENDPOINT || !STORAGE_ACCESS_KEY_ID || !STORAGE_SECRET_ACCESS_KEY) {
      throw new StorageUnavailable("S3 storage is not fully configured.");
    }
    this.client = new AwsClient({
      accessKeyId: STORAGE_ACCESS_KEY_ID,
      secretAccessKey: STORAGE_SECRET_ACCESS_KEY,
      service: "s3",
      region: process.env.STORAGE_REGION || "auto",
    });
    this.base = `${STORAGE_ENDPOINT.replace(/\/+$/, "")}/${encodeURIComponent(STORAGE_BUCKET)}`;
  }

  private url(key: string, expiresSec?: number): string {
    const u = new URL(`${this.base}/${key.split("/").map(encodeURIComponent).join("/")}`);
    if (expiresSec) u.searchParams.set("X-Amz-Expires", String(expiresSec));
    return u.toString();
  }

  async presignPut(key: string, contentType: string, expiresSec: number): Promise<PresignedPut> {
    const signed = await this.client.sign(this.url(key, expiresSec), {
      method: "PUT",
      headers: { "content-type": contentType },
      aws: { signQuery: true },
    });
    return {
      url: signed.url,
      method: "PUT",
      headers: { "content-type": contentType },
      expiresAt: new Date(Date.now() + expiresSec * 1000).toISOString(),
    };
  }

  async presignGet(key: string, expiresSec: number): Promise<string> {
    const signed = await this.client.sign(this.url(key, expiresSec), {
      method: "GET",
      aws: { signQuery: true },
    });
    return signed.url;
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    const res = await this.client.fetch(this.url(key), { method: "HEAD" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Storage HEAD failed: ${res.status}`);
    return {
      sizeBytes: Number(res.headers.get("content-length") ?? 0),
      contentType: res.headers.get("content-type"),
    };
  }

  async delete(key: string): Promise<void> {
    const res = await this.client.fetch(this.url(key), { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`Storage DELETE failed: ${res.status}`);
  }
}
