// Walker vetting (Milestone 7): which documents exist, what is allowed, and
// whether an application can be approved. Shared by the walker, admin and
// approval routes so the rules live in one place.

import type { WalkerDocKind, WalkerDocument, WalkerProfile } from "@prisma/client";
import { db } from "@/lib/db";
import type { WalkerDocumentDTO, WalkerVettingDTO } from "@/lib/firu/types";
import { storageProviderName } from "./storage";

const MB = 1024 * 1024;
const IMAGES = ["image/jpeg", "image/png", "image/webp"];

export const DOC_RULES: Record<WalkerDocKind, { types: string[]; maxBytes: number; required: boolean }> = {
  CI_FRONT: { types: IMAGES, maxBytes: 8 * MB, required: true },
  CI_BACK: { types: IMAGES, maxBytes: 8 * MB, required: true },
  SELFIE: { types: IMAGES, maxBytes: 8 * MB, required: true },
  BACKGROUND_CERT: { types: [...IMAGES, "application/pdf"], maxBytes: 10 * MB, required: true },
  VIDEO_INTRO: { types: ["video/mp4", "video/webm", "video/quicktime"], maxBytes: 60 * MB, required: false },
};

export const DOC_KINDS = Object.keys(DOC_RULES) as WalkerDocKind[];
export const REQUIRED_KINDS = DOC_KINDS.filter((k) => DOC_RULES[k].required);

/** Upload tickets and admin view links are short-lived. */
export const UPLOAD_TTL_SEC = 10 * 60;
export const VIEW_TTL_SEC = 5 * 60;

/** Latest verified upload per kind. */
export function latestByKind(docs: WalkerDocument[]): Map<WalkerDocKind, WalkerDocument> {
  const out = new Map<WalkerDocKind, WalkerDocument>();
  for (const d of docs) {
    if (!d.uploadedAt) continue;
    const prev = out.get(d.kind);
    if (!prev || prev.uploadedAt! < d.uploadedAt) out.set(d.kind, d);
  }
  return out;
}

export function docDTO(d: WalkerDocument, viewUrl?: string): WalkerDocumentDTO {
  return {
    id: d.id,
    kind: d.kind,
    contentType: d.contentType,
    sizeBytes: d.sizeBytes,
    uploadedAt: d.uploadedAt!.toISOString(),
    ...(viewUrl ? { viewUrl } : {}),
  };
}

export function vettingOf(
  p: WalkerProfile,
  docs: WalkerDocument[],
  viewUrls?: Map<string, string>
): WalkerVettingDTO {
  const latest = latestByKind(docs);
  const missing = REQUIRED_KINDS.filter((k) => !latest.has(k));
  const documentsComplete = missing.length === 0 && !!p.idDocCipher;
  const checklist = p.reviewIdentityOk && p.reviewBackgroundOk && p.reviewInterviewDone && p.reviewTrialWalkDone;
  return {
    walkerId: p.id,
    status: p.status,
    idDocLast4: p.idDocLast4,
    documents: DOC_KINDS.filter((k) => latest.has(k)).map((k) => {
      const d = latest.get(k)!;
      return docDTO(d, viewUrls?.get(d.id));
    }),
    missing,
    review: {
      identityOk: p.reviewIdentityOk,
      backgroundOk: p.reviewBackgroundOk,
      interviewDone: p.reviewInterviewDone,
      trialWalkDone: p.reviewTrialWalkDone,
      notes: p.reviewNotes,
      reviewedAt: p.reviewedAt?.toISOString() ?? null,
    },
    documentsComplete,
    readyToApprove: documentsComplete && checklist,
    storageReady: storageProviderName() !== null,
  };
}

export async function loadVetting(walkerId: string) {
  const profile = await db.walkerProfile.findUnique({
    where: { id: walkerId },
    include: { documents: { where: { uploadedAt: { not: null } } } },
  });
  return profile;
}

/** Spanish reason why an application cannot be approved yet, or null. */
export function approvalBlocker(v: WalkerVettingDTO): string | null {
  if (v.missing.length) return "Faltan documentos obligatorios del paseador.";
  if (!v.idDocLast4) return "Falta el número de CI del paseador.";
  const r = v.review;
  if (!r.identityOk || !r.backgroundOk || !r.interviewDone || !r.trialWalkDone) {
    return "Completa el checklist de verificación (identidad, antecedentes, entrevista y paseo de prueba) antes de aprobar.";
  }
  return null;
}
