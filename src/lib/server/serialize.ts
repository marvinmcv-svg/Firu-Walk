// DB row → DTO serializers. Output shapes MUST match src/lib/firu/types.ts.
// All *Json fields are parsed here; dates become ISO strings.

import type { Prisma } from "@prisma/client";
import type {
  BookingDTO,
  DogDTO,
  DisputeDTO,
  LedgerEntryDTO,
  NotificationDTO,
  PartyDTO,
  PaymentDTO,
  PayoutDTO,
  ReconIssueDTO,
  ReconRunDTO,
  ReportCardDTO,
  ReviewDTO,
  ScheduleItem,
  SessionUserDTO,
  WalkerCardDTO,
  WalkerDetailDTO,
  WalkerProfileDTO,
  WalkDTO,
  ZoneDTO,
} from "@/lib/firu/types";

// ---------------------------------------------------------------------
// Includes (Prisma payload types shared by routes + serializers)
// ---------------------------------------------------------------------

export const bookingInclude = {
  owner: true,
  walker: true,
  dog: true,
  walks: { include: { dog: true, report: true } },
  payments: true,
  reviews: { include: { owner: true } },
} satisfies Prisma.BookingInclude;

export type FullBooking = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

export const walkInclude = {
  dog: true,
  report: true,
  booking: { include: { owner: true, walker: true, dog: true } },
} satisfies Prisma.WalkInclude;

export type FullWalk = Prisma.WalkGetPayload<{ include: typeof walkInclude }>;

// NOTE: Booking/Walk have a plain `zoneId` but NO Prisma relation to Zone —
// zones are always fetched separately and passed into the serializers.
export type ZoneLite = { id: string; name: string; key: string };

/** Batch-fetch ZoneLite rows by id (walk/booking context serialization). */
export async function zonesById(zoneIds: string[]): Promise<Map<string, ZoneLite>> {
  const { db } = await import("@/lib/db");
  const zones = await db.zone.findMany({
    where: { id: { in: [...new Set(zoneIds)] } },
  });
  return new Map(zones.map((z) => [z.id, { id: z.id, name: z.name, key: z.key }]));
}

/** Compact booking context attached to walk payloads (per API contract route 18). */
export function bookingContextOf(
  b: Prisma.BookingGetPayload<{
    include: { owner: true; walker: true; dog: true };
  }>,
  zone: ZoneLite | null
): {
  id: string;
  status: string;
  type: string;
  owner: PartyDTO | null;
  walker: PartyDTO | null;
  dog: DogDTO;
  zone: { id: string; name: string; key: string };
  pricePerWalkCents: number;
  durationMin: number;
  notes: string | null;
} {
  return {
    id: b.id,
    status: b.status,
    type: b.type,
    owner: partyOf(b.owner),
    walker: partyOf(b.walker),
    dog: dogOf(b.dog),
    zone: zone ?? { id: b.zoneId, name: "", key: "" },
    pricePerWalkCents: b.pricePerWalkCents,
    durationMin: b.durationMin,
    notes: b.notes,
  };
}

export const disputeInclude = {
  booking: { include: { owner: true, walker: true, dog: true } },
} satisfies Prisma.DisputeInclude;

export type FullDispute = Prisma.DisputeGetPayload<{ include: typeof disputeInclude }>;

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed === null || parsed === undefined ? fallback : parsed) as T;
  } catch {
    return fallback;
  }
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export function zoneOf(z: { id: string; key: string; name: string; city: string; centerLat: number; centerLng: number; active: boolean }): ZoneDTO {
  return {
    id: z.id,
    key: z.key,
    name: z.name,
    city: z.city,
    centerLat: z.centerLat,
    centerLng: z.centerLng,
    active: z.active,
  };
}

/**
 * The other party of a booking/walk/dispute. No phone number: owners and
 * walkers talk through the in-app chat (anti-disintermediation). Admin views
 * add phones explicitly (withPhones).
 */
export function partyOf(u: { id: string; name: string; avatarUrl: string | null } | null): PartyDTO | null {
  if (!u) return null;
  return { id: u.id, name: u.name, avatarUrl: u.avatarUrl };
}

/** Admin only: add both parties' phone numbers to serialized bookings. */
export function withPhones<T extends { owner?: PartyDTO | null; walker?: PartyDTO | null }>(
  dtos: T[],
  users: { id: string; phone: string }[]
): T[] {
  const phones = new Map(users.map((u) => [u.id, u.phone]));
  const add = (p: PartyDTO | null | undefined) => (p ? { ...p, phone: phones.get(p.id) } : p);
  return dtos.map((d) => ({ ...d, owner: add(d.owner), walker: add(d.walker) }));
}

export function dogOf(d: {
  id: string;
  ownerId: string;
  name: string;
  breed: string;
  size: string;
  ageYears: number;
  temperament: string;
  notes: string | null;
  tagsJson: string;
  photoUrl: string | null;
  vetPhone: string | null;
}): DogDTO {
  return {
    id: d.id,
    ownerId: d.ownerId,
    name: d.name,
    breed: d.breed,
    size: (["S", "M", "L"].includes(d.size) ? d.size : "M") as DogDTO["size"],
    ageYears: d.ageYears,
    temperament: (["CALM", "ENERGETIC", "ANXIOUS"].includes(d.temperament)
      ? d.temperament
      : "CALM") as DogDTO["temperament"],
    notes: d.notes,
    tags: parseJson<string[]>(d.tagsJson, []),
    photoUrl: d.photoUrl,
    vetPhone: d.vetPhone,
  };
}

export function paymentOf(p: {
  id: string;
  purpose: string;
  method: string;
  status: string;
  amountCents: number;
  ownerFeeCents: number;
  refundedCents: number;
  qrRef: string | null;
  qrImage: string | null;
  qrExpiresAt: Date | null;
  confirmedAt: Date | null;
  confirmSource: string | null;
  createdAt: Date;
}): PaymentDTO {
  const pending = p.status === "PENDING";
  return {
    id: p.id,
    purpose: p.purpose as PaymentDTO["purpose"],
    method: p.method as PaymentDTO["method"],
    status: p.status as PaymentDTO["status"],
    amountCents: p.amountCents,
    ownerFeeCents: p.ownerFeeCents,
    refundedCents: p.refundedCents,
    qrRef: p.qrRef,
    // The QR only matters while it can still be paid.
    qrImage: pending ? p.qrImage : null,
    qrExpiresAt: pending ? iso(p.qrExpiresAt) : null,
    confirmedAt: iso(p.confirmedAt),
    confirmSource: p.confirmSource,
    createdAt: p.createdAt.toISOString(),
  };
}

export function reportOf(r: {
  note: string | null;
  pee: boolean;
  poo: boolean;
  water: boolean;
  photosJson: string;
  createdAt: Date;
} | null): ReportCardDTO | null {
  if (!r) return null;
  return {
    note: r.note,
    pee: r.pee,
    poo: r.poo,
    water: r.water,
    photos: parseJson<string[]>(r.photosJson, []),
    createdAt: r.createdAt.toISOString(),
  };
}

/** Walk row → WalkDTO (hasTrack from trackJson; `track` only added by walkDetailOf). */
export function walkOf(
  w: Prisma.WalkGetPayload<{ include: { dog: true; report: true } }>,
  fallbackDog?: Prisma.DogGetPayload<Record<never, never>>
): WalkDTO {
  const track = parseJson<[number, number][]>(w.trackJson, []);
  return {
    id: w.id,
    bookingId: w.bookingId,
    status: w.status as WalkDTO["status"],
    scheduledStart: w.scheduledStart.toISOString(),
    durationMin: w.durationMin,
    startedAt: iso(w.startedAt),
    onTheWayAt: iso(w.onTheWayAt),
    endedAt: iso(w.endedAt),
    distanceMeters: Math.round(w.distanceMeters),
    hasTrack: track.length > 0,
    dog: dogOf((w.dog ?? fallbackDog) as Prisma.DogGetPayload<Record<never, never>>),
    report: reportOf(w.report),
  };
}

/** Walk detail adds the parsed polyline + start/end coordinates (map view). */
export function walkDetailOf(w: FullWalk): WalkDTO & {
  track: [number, number][];
  startLat: number | null;
  startLng: number | null;
  endLat: number | null;
  endLng: number | null;
  cancelReason: string | null;
} {
  const track = parseJson<[number, number][]>(w.trackJson, []);
  return {
    ...walkOf(w),
    track,
    startLat: w.startLat,
    startLng: w.startLng,
    endLat: w.endLat,
    endLng: w.endLng,
    cancelReason: w.cancelReason,
  };
}

export function reviewOf(
  r: Prisma.ReviewGetPayload<{ include: { owner: true } }>
): ReviewDTO {
  return {
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    tipCents: r.tipCents,
    createdAt: r.createdAt.toISOString(),
    ownerName: r.owner?.name,
    ownerAvatarUrl: r.owner?.avatarUrl ?? null,
  };
}

/** Booking row (with the standard include) → BookingDTO. Zone passed separately. */
export function bookingOf(b: FullBooking, zone: ZoneLite | null): BookingDTO {
  const schedule = parseJson<ScheduleItem[]>(b.scheduleJson, []);
  const walks = [...b.walks]
    .sort((a, c) => a.scheduledStart.getTime() - c.scheduledStart.getTime())
    .map((w) => walkOf(w, b.dog));
  const nextWalk =
    [...b.walks]
      .filter((w) => w.status === "SCHEDULED")
      .sort((a, c) => a.scheduledStart.getTime() - c.scheduledStart.getTime())[0] ?? null;
  const payment =
    [...b.payments].sort((a, c) => c.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  const review =
    [...b.reviews].sort((a, c) => c.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  return {
    id: b.id,
    status: b.status as BookingDTO["status"],
    type: b.type as BookingDTO["type"],
    schedule,
    durationMin: b.durationMin,
    pricePerWalkCents: b.pricePerWalkCents,
    notes: b.notes,
    requestedAt: b.requestedAt.toISOString(),
    expiresAt: iso(b.expiresAt),
    acceptedAt: iso(b.acceptedAt),
    cancelledBy: (b.cancelledBy as BookingDTO["cancelledBy"]) ?? null,
    cancelReason: b.cancelReason,
    owner: partyOf(b.owner)!,
    walker: partyOf(b.walker),
    dog: dogOf(b.dog),
    zone: zone ?? { id: b.zoneId, name: "", key: "" },
    payment: payment ? paymentOf(payment) : null,
    walks,
    nextWalkAt: nextWalk ? nextWalk.scheduledStart.toISOString() : null,
    review: review ? reviewOf(review) : null,
  };
}

/** Serialize one booking, fetching its zone. */
export async function bookingOfFull(b: FullBooking): Promise<BookingDTO> {
  const zones = await zonesById([b.zoneId]);
  return bookingOf(b, zones.get(b.zoneId) ?? null);
}

/** Serialize a booking list with one batched zone prefetch. */
export async function bookingList(bs: FullBooking[]): Promise<BookingDTO[]> {
  const zones = await zonesById(bs.map((b) => b.zoneId));
  return bs.map((b) => bookingOf(b, zones.get(b.zoneId) ?? null));
}

export function walkerProfileOf(
  p: Prisma.WalkerProfileGetPayload<Record<never, never>>,
  zoneName?: string | null
): WalkerProfileDTO {
  return {
    id: p.id,
    userId: p.userId,
    status: p.status as WalkerProfileDTO["status"],
    bio: p.bio,
    experienceYears: p.experienceYears,
    price30Cents: p.price30Cents,
    price45Cents: p.price45Cents,
    price60Cents: p.price60Cents,
    rating: p.rating,
    ratingCount: p.ratingCount,
    totalWalks: p.totalWalks,
    repeatOwners: p.repeatOwners,
    responseMinutes: p.responseMinutes,
    trialDone: p.trialDone,
    strikes: p.strikes,
    zoneId: p.zoneId,
    zoneName: zoneName ?? undefined,
    appliedAt: p.appliedAt.toISOString(),
    approvedAt: iso(p.approvedAt),
    selfieUrl: p.selfieUrl,
    idPhotoUrl: p.idPhotoUrl,
    videoIntroUrl: p.videoIntroUrl,
    referencesText: p.referencesText,
    idDocNumber: p.idDocNumber,
    suspendedReason: p.suspendedReason,
  };
}

export function sessionUserOf(
  u: Prisma.UserGetPayload<{ include: { walker: true; zone: true } }>
): SessionUserDTO {
  return {
    id: u.id,
    phone: u.phone,
    name: u.name,
    role: u.role as SessionUserDTO["role"],
    avatarUrl: u.avatarUrl,
    zoneId: u.zoneId,
    zoneName: u.zone?.name ?? null,
    addressNote: u.addressNote,
    addressLat: u.addressLat,
    addressLng: u.addressLng,
    createdAt: u.createdAt.toISOString(),
    walker: u.walker ? walkerProfileOf(u.walker, u.zone?.name) : null,
  };
}

/** User + WalkerProfile (+zone name) → marketplace card. */
export function walkerCardOf(
  u: { id: string; name: string; avatarUrl: string | null; zone?: { name: string } | null },
  p: Prisma.WalkerProfileGetPayload<Record<never, never>>,
  zoneName?: string | null
): WalkerCardDTO {
  return {
    userId: u.id,
    name: u.name,
    avatarUrl: u.avatarUrl,
    walkerId: p.id,
    bio: p.bio,
    rating: p.rating,
    ratingCount: p.ratingCount,
    totalWalks: p.totalWalks,
    repeatOwners: p.repeatOwners,
    price30Cents: p.price30Cents,
    price45Cents: p.price45Cents,
    price60Cents: p.price60Cents,
    zoneId: p.zoneId,
    zoneName: zoneName ?? u.zone?.name ?? "",
    responseMinutes: p.responseMinutes,
    trialDone: p.trialDone,
    isFavorite: false,
  };
}

/** Walker detail (public): card + experience + availability + latest 10 reviews. No phone. */
export function walkerDetailOf(
  u: Prisma.UserGetPayload<{ include: { walker: true; zone: true } }>,
  p: Prisma.WalkerProfileGetPayload<Record<never, never>>,
  slots: Prisma.AvailabilitySlotGetPayload<Record<never, never>>[],
  reviews: Prisma.ReviewGetPayload<{ include: { owner: true } }>[],
  zoneName: string
): WalkerDetailDTO {
  return {
    ...walkerCardOf(u, p, zoneName),
    experienceYears: p.experienceYears,
    availability: slots
      .map((s) => ({ dayOfWeek: s.dayOfWeek, startMinute: s.startMinute, endMinute: s.endMinute }))
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinute - b.startMinute),
    reviews: reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
      ownerName: r.owner?.name ?? "Cliente",
      ownerAvatarUrl: r.owner?.avatarUrl ?? null,
    })),
  };
}

/** Dispute row (with booking include) → DisputeDTO with booking summary + parties. */
export async function disputeOf(
  d: FullDispute,
  parties?: Map<string, PartyDTO>
): Promise<DisputeDTO> {
  const map = parties ?? (await partiesFor([d.openedById, d.againstUserId]));
  return {
    id: d.id,
    bookingId: d.bookingId,
    walkId: d.walkId,
    reason: d.reason,
    description: d.description,
    status: d.status as DisputeDTO["status"],
    resolution: d.resolution,
    refundCents: d.refundCents,
    creditCents: d.creditCents,
    createdAt: d.createdAt.toISOString(),
    resolvedAt: iso(d.resolvedAt),
    booking: d.booking
      ? {
          id: d.booking.id,
          ownerName: d.booking.owner?.name ?? "",
          walkerName: d.booking.walker?.name ?? null,
          dogName: d.booking.dog?.name ?? "",
          pricePerWalkCents: d.booking.pricePerWalkCents,
        }
      : null,
    openedBy: map.get(d.openedById)!,
    against: map.get(d.againstUserId)!,
  };
}

/** Batch-fetch PartyDTOs for a list of user ids (avoids N+1 in dispute lists). */
export async function partiesFor(userIds: string[]): Promise<Map<string, PartyDTO>> {
  const unique = [...new Set(userIds)];
  const { db } = await import("@/lib/db");
  const users = await db.user.findMany({ where: { id: { in: unique } } });
  const map = new Map<string, PartyDTO>();
  for (const u of users) map.set(u.id, partyOf(u)!);
  return map;
}

export function payoutOf(
  p: Prisma.PayoutGetPayload<Record<never, never>>,
  walkerName?: string | null
): PayoutDTO & { walkerId: string; walkerName: string | null } {
  return {
    id: p.id,
    amountCents: p.amountCents,
    method: p.method,
    status: p.status as PayoutDTO["status"],
    requestedAt: p.requestedAt.toISOString(),
    paidAt: iso(p.paidAt),
    reference: p.reference,
    batchId: p.batchId,
    destRef: p.destRef,
    // extras the UIs find handy (superset of the strict DTO)
    walkerId: p.walkerId,
    walkerName: walkerName ?? null,
  };
}

export function notificationOf(n: Prisma.NotificationGetPayload<Record<never, never>>): NotificationDTO {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    read: n.read,
    createdAt: n.createdAt.toISOString(),
  };
}

export function ledgerEntryOf(e: Prisma.LedgerEntryGetPayload<Record<never, never>>): LedgerEntryDTO {
  return {
    id: e.id,
    txnId: e.txnId,
    account: e.account,
    debitCents: e.debitCents,
    creditCents: e.creditCents,
    memo: e.memo,
    refType: e.refType,
    refId: e.refId,
    createdAt: e.createdAt.toISOString(),
  };
}

export function reconIssueOf(i: Prisma.ReconciliationIssueGetPayload<Record<never, never>>): ReconIssueDTO {
  return {
    id: i.id,
    kind: i.kind,
    status: i.status,
    paymentId: i.paymentId,
    providerRef: i.providerRef,
    expectedCents: i.expectedCents,
    actualCents: i.actualCents,
    detail: i.detail,
    resolution: i.resolution,
    resolvedAt: iso(i.resolvedAt),
    createdAt: i.createdAt.toISOString(),
  };
}

export function reconRunOf(r: Prisma.ReconciliationRunGetPayload<Record<never, never>>): ReconRunDTO {
  return {
    id: r.id,
    provider: r.provider,
    periodStart: r.periodStart.toISOString(),
    periodEnd: r.periodEnd.toISOString(),
    settledCount: r.settledCount,
    settledCents: r.settledCents,
    recordedCount: r.recordedCount,
    recordedCents: r.recordedCents,
    issuesFound: r.issuesFound,
    createdAt: r.createdAt.toISOString(),
  };
}
