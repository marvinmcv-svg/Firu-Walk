// Phase 3 content: "Firu del mes" and walker spotlights.
//
// Consent is the rule: an owner's dog and walk photos are only used when the
// owner opted in (User.mediaConsent), a walker only when they opted in
// (WalkerProfile.spotlightConsent) and are ACTIVE. Every read re-checks it, so
// revoking consent takes a feature off the landing page immediately.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { parseJson } from "@/lib/server/serialize";
import { ApiError } from "@/lib/server/http";
import { BO_OFFSET_MS } from "@/lib/server/botime";
import type { ContentOverviewDTO, FeatureDTO, PublicFeaturedDTO } from "@/lib/firu/types";

/** How many months back the landing keeps showing a feature. */
const SHOW_MONTHS = 3;
const MEDIA_DAYS = 60;
const MAX_PHOTOS = 12;

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Bolivia-local "YYYY-MM" of `d`, shifted by `offsetMonths`. */
export function boMonth(d: Date = new Date(), offsetMonths = 0): string {
  const b = new Date(d.getTime() - BO_OFFSET_MS);
  const m = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + offsetMonths, 1));
  return m.toISOString().slice(0, 7);
}

/** "María Fernanda Rojas" → "María Fernanda R." (public pages never show full names). */
export function publicName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? "";
  const last = parts.pop()!;
  return `${parts.join(" ")} ${last.charAt(0).toUpperCase()}.`;
}

const live = {
  firu: { dog: { owner: { mediaConsent: true } } },
  spotlight: { walker: { walker: { is: { spotlightConsent: true, status: "ACTIVE" } } } },
} satisfies Record<string, Prisma.FeatureWhereInput>;

const featureInclude = {
  dog: { include: { owner: { include: { zone: true } } } },
  walker: { include: { walker: { include: { zone: true } } } },
} satisfies Prisma.FeatureInclude;
type FullFeature = Prisma.FeatureGetPayload<{ include: typeof featureInclude }>;

function isLive(f: FullFeature): boolean {
  if (!f.published) return false;
  if (f.kind === "FIRU_OF_MONTH") return !!f.dog?.owner.mediaConsent;
  return !!f.walker?.walker?.spotlightConsent && f.walker.walker.status === "ACTIVE";
}

export function featureOf(f: FullFeature): FeatureDTO {
  const firu = f.kind === "FIRU_OF_MONTH";
  return {
    id: f.id,
    kind: f.kind,
    month: f.month,
    headline: f.headline,
    blurb: f.blurb,
    photoUrl: f.photoUrl,
    published: f.published,
    live: isLive(f),
    subjectName: (firu ? f.dog?.name : f.walker?.name) ?? "—",
    ownerName: firu ? (f.dog?.owner.name ?? null) : null,
    consent: firu ? !!f.dog?.owner.mediaConsent : !!f.walker?.walker?.spotlightConsent,
    createdAt: f.createdAt.toISOString(),
  };
}

export async function loadFeature(id: string): Promise<FullFeature> {
  const f = await db.feature.findUnique({ where: { id }, include: featureInclude });
  if (!f) throw new ApiError(404, "Contenido no encontrado.");
  return f;
}

/** Photos of this dog ops may use: its profile photo and its walk reports. */
export async function dogPhotos(dogIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>(dogIds.map((id) => [id, []]));
  if (dogIds.length === 0) return out;
  const [dogs, reports] = await Promise.all([
    db.dog.findMany({ where: { id: { in: dogIds } }, select: { id: true, photoUrl: true } }),
    db.reportCard.findMany({
      where: { photosJson: { not: "[]" }, walk: { dogId: { in: dogIds }, status: "COMPLETED" } },
      select: { photosJson: true, walk: { select: { dogId: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  ]);
  const add = (dogId: string, url: string | null | undefined) => {
    const list = out.get(dogId);
    if (url && list && !list.includes(url) && list.length < MAX_PHOTOS) list.push(url);
  };
  for (const d of dogs) add(d.id, d.photoUrl);
  for (const r of reports) for (const p of parseJson<string[]>(r.photosJson, [])) add(r.walk.dogId, p);
  return out;
}

/** The photo must be one of the subject's own photos (no arbitrary URLs on the public page). */
export async function assertPhotoAllowed(
  photoUrl: string | null | undefined,
  subject: { dogId?: string | null; walkerAvatar?: string | null }
): Promise<void> {
  if (!photoUrl) return;
  const allowed = subject.dogId
    ? ((await dogPhotos([subject.dogId])).get(subject.dogId) ?? [])
    : subject.walkerAvatar
      ? [subject.walkerAvatar]
      : [];
  if (!allowed.includes(photoUrl)) {
    throw new ApiError(400, "Elige una de las fotos propuestas.");
  }
}

/** A month has at most one published "Firu del mes". */
export async function assertFiruMonthFree(month: string, exceptId?: string): Promise<void> {
  const other = await db.feature.findFirst({
    where: { kind: "FIRU_OF_MONTH", month, published: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (other) throw new ApiError(400, "Ya hay un Firu del mes publicado para ese mes.");
}

/** GET /api/content/featured — landing page. */
export async function publicFeatured(now: Date = new Date()): Promise<PublicFeaturedDTO> {
  const current = boMonth(now);
  const since = boMonth(now, -(SHOW_MONTHS - 1));
  const window = { published: true, month: { gte: since, lte: current } };
  const [firu, spots] = await Promise.all([
    db.feature.findFirst({
      where: { kind: "FIRU_OF_MONTH", ...window, ...live.firu },
      include: featureInclude,
      orderBy: [{ month: "desc" }, { createdAt: "desc" }],
    }),
    db.feature.findMany({
      where: { kind: "WALKER_SPOTLIGHT", ...window, ...live.spotlight },
      include: featureInclude,
      orderBy: [{ month: "desc" }, { createdAt: "desc" }],
      take: 6,
    }),
  ]);
  const seen = new Set<string>();
  return {
    firu:
      firu?.dog
        ? {
            id: firu.id,
            month: firu.month,
            headline: firu.headline,
            blurb: firu.blurb,
            photoUrl: firu.photoUrl,
            dogName: firu.dog.name,
            breed: firu.dog.breed,
            zoneName: firu.dog.owner.zone?.name ?? null,
          }
        : null,
    spotlights: spots
      .filter((s) => s.walker?.walker && !seen.has(s.walker.id) && seen.add(s.walker.id))
      .slice(0, 3)
      .map((s) => {
        const p = s.walker!.walker!;
        return {
          id: s.id,
          month: s.month,
          headline: s.headline,
          blurb: s.blurb,
          photoUrl: s.photoUrl,
          walkerName: publicName(s.walker!.name),
          zoneName: p.zone?.name ?? null,
          rating: p.rating,
          ratingCount: p.ratingCount,
          totalWalks: p.totalWalks,
          experienceYears: p.experienceYears,
        };
      }),
  };
}

/** GET /api/admin/content — features, consented media and candidates. */
export async function contentOverview(now: Date = new Date()): Promise<ContentOverviewDTO> {
  const since = new Date(now.getTime() - MEDIA_DAYS * 86_400_000);
  const [features, walks, dogs, walkers, ownersConsent, ownersTotal, walkersTotal] = await Promise.all([
    db.feature.findMany({ include: featureInclude, orderBy: [{ month: "desc" }, { createdAt: "desc" }], take: 100 }),
    db.walk.findMany({
      where: {
        status: "COMPLETED",
        endedAt: { gte: since },
        owner: { mediaConsent: true },
        report: { is: { photosJson: { not: "[]" } } },
      },
      include: { report: true, dog: true, owner: true, walker: true },
      orderBy: { endedAt: "desc" },
      take: 50,
    }),
    db.dog.findMany({
      where: { owner: { mediaConsent: true } },
      include: { owner: true },
      orderBy: { name: "asc" },
      take: 200,
    }),
    db.walkerProfile.findMany({
      where: { status: "ACTIVE", spotlightConsent: true },
      include: { user: true, zone: true },
      orderBy: { totalWalks: "desc" },
      take: 100,
    }),
    db.user.count({ where: { role: "OWNER", mediaConsent: true } }),
    db.user.count({ where: { role: "OWNER" } }),
    db.walkerProfile.count({ where: { status: "ACTIVE" } }),
  ]);
  const zoneIds = [...new Set(walks.map((w) => w.zoneId))];
  const zones = new Map(
    (await db.zone.findMany({ where: { id: { in: zoneIds } }, select: { id: true, name: true } })).map((z) => [z.id, z.name])
  );
  const photos = await dogPhotos(dogs.map((d) => d.id));
  return {
    month: boMonth(now),
    features: features.map(featureOf),
    media: walks.map((w) => ({
      walkId: w.id,
      date: (w.endedAt ?? w.scheduledStart).toISOString(),
      dogId: w.dogId,
      dogName: w.dog.name,
      ownerName: w.owner.name,
      walkerName: w.walker.name,
      zoneName: zones.get(w.zoneId) ?? null,
      photos: parseJson<string[]>(w.report?.photosJson ?? "[]", []),
    })),
    dogs: dogs.map((d) => ({
      id: d.id,
      name: d.name,
      breed: d.breed,
      ownerName: d.owner.name,
      photos: photos.get(d.id) ?? [],
    })),
    walkers: walkers.map((p) => ({
      id: p.userId,
      name: p.user.name,
      zoneName: p.zone?.name ?? null,
      totalWalks: p.totalWalks,
      rating: p.rating,
      photos: p.user.avatarUrl ? [p.user.avatarUrl] : [],
    })),
    consentCounts: {
      owners: ownersConsent,
      ownersTotal,
      walkers: walkers.length,
      walkersTotal,
    },
  };
}
