"use client";

// Walker document upload (Milestone 7).
// 1. Photos are compressed on the phone (≤1600 px JPEG) — walkers are on
//    prepaid data, and a 4 MB camera shot becomes ~300 KB.
// 2. The server hands out a short-lived presigned PUT; bytes go straight
//    to private storage, never through our API.
// 3. /complete asks the server to verify the object before it counts.

import { api } from "./api";
import type { DocumentUploadTicketDTO, WalkerDocKind, WalkerVettingDTO } from "./types";

const MAX_DIM = 1600;
const QUALITY = 0.82;

export async function compressImage(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file; // undecodable here (e.g. HEIC on some browsers) → send as-is
  }
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", QUALITY));
  if (!blob) return file;
  // Keep the original when compression doesn't help and its type is accepted.
  return blob.size < file.size || !/^image\/(jpeg|png|webp)$/.test(file.type) ? blob : file;
}

export async function uploadWalkerDocument(kind: WalkerDocKind, file: File): Promise<WalkerVettingDTO> {
  const body = file.type.startsWith("image/") ? await compressImage(file) : file;
  const contentType = body.type || file.type;
  const ticket = await api.post<DocumentUploadTicketDTO>("/api/walkers/me/documents", {
    kind,
    contentType,
    sizeBytes: body.size,
  });
  const res = await fetch(ticket.url, { method: ticket.method, headers: ticket.headers, body });
  if (!res.ok) throw new Error(`upload_failed_${res.status}`);
  return api.post<WalkerVettingDTO>(`/api/walkers/me/documents/${ticket.documentId}/complete`);
}
