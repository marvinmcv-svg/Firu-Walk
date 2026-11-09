// Development/test stand-in for presigned storage URLs (STORAGE_PROVIDER=mock).
// PUT /api/storage/mock?key&exp&sig  — upload bytes (Content-Type must match the signature)
// GET /api/storage/mock?key&exp&sig  — download
// Disabled whenever the mock provider is not the active backend.

import { NextResponse } from "next/server";
import { storageProviderName } from "@/lib/server/storage";
import { MockStorageProvider, verifyMockToken } from "@/lib/server/storage/mockProvider";

const MAX_BYTES = 64 * 1024 * 1024;

function parse(req: Request) {
  const u = new URL(req.url);
  return { key: u.searchParams.get("key") ?? "", exp: Number(u.searchParams.get("exp")), sig: u.searchParams.get("sig") ?? "" };
}

function enabled(): boolean {
  return storageProviderName() === "mock" && process.env.VERCEL_ENV !== "production";
}

export async function PUT(req: Request) {
  if (!enabled()) return new NextResponse(null, { status: 404 });
  const { key, exp, sig } = parse(req);
  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!verifyMockToken("put", key, exp, sig, contentType)) return new NextResponse("Forbidden", { status: 403 });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) return new NextResponse("Too large", { status: 413 });
  await new MockStorageProvider().write(key, bytes, contentType);
  return new NextResponse(null, { status: 200 });
}

export async function GET(req: Request) {
  if (!enabled()) return new NextResponse(null, { status: 404 });
  const { key, exp, sig } = parse(req);
  if (!verifyMockToken("get", key, exp, sig)) return new NextResponse("Forbidden", { status: 403 });
  const obj = await new MockStorageProvider().read(key);
  if (!obj) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(obj.bytes), {
    headers: {
      "content-type": obj.contentType,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
    },
  });
}
