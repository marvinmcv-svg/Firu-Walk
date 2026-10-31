// FiruWalk shared API types — THE contract between frontend and backend.
// API routes must serialize to these exact shapes.

export type Role = "OWNER" | "WALKER" | "ADMIN";

export type PaymentMethod = "QR" | "TRANSFER" | "CASH";

// ---------------------------------------------------------------
// Config (server-truth, loaded from Config table)
// ---------------------------------------------------------------

export interface AppConfig {
  platform: {
    name: string;
    city: string;
    supportWhatsApp: string; // "+59170000000"
    guaranteeText: string;
  };
  fees: {
    commissionPct: number; // walker-side take (e.g., 12)
    ownerFeePct: number; // 0 at launch
    tipPassThroughPct: number; // 100
  };
  pricing: {
    price30Cents: number;
    price45Cents: number;
    price60Cents: number;
  };
  policy: {
    cancellationFreeHours: number; // free cancel if > this many hours before
    lateCancelWalkerSharePct: number; // % of price paid to walker on late cancel
    acceptTimeoutMinutes: number; // real-world accept window
    trialWalks: number;
    noShowCreditCents: number; // owner credit if walker no-shows
  };
  /** True when the server runs with DEMO_MODE (one-click demo accounts). */
  demoMode?: boolean;
  demo: {
    otpCode: string; // demo login code — empty unless demo mode is on
    acceptTimeoutSeconds: number; // demo-fast fallback window
  };
  payouts: {
    cycle: string; // "weekly"
    minPayoutCents: number;
  };
  tracking: {
    geofenceMeters: number; // start/end must be this close to the owner's address
    maxSpeedKmh: number; // faster between two GPS points → rejected
    maxJumpMeters: number; // longer jump between two points → rejected (teleport)
    maxAccuracyMeters: number; // fixes less precise than this are ignored
  };
}

// ---------------------------------------------------------------
// Core entities
// ---------------------------------------------------------------

export interface ZoneDTO {
  id: string;
  key: string;
  name: string;
  city: string;
  centerLat: number;
  centerLng: number;
  active: boolean;
}

export interface WalkerProfileDTO {
  id: string;
  userId: string;
  status: "PENDING" | "ACTIVE" | "SUSPENDED" | "REJECTED";
  bio: string;
  experienceYears: number;
  price30Cents: number;
  price45Cents: number;
  price60Cents: number;
  rating: number;
  ratingCount: number;
  totalWalks: number;
  repeatOwners: number;
  responseMinutes: number;
  trialDone: boolean;
  strikes: number;
  zoneId: string;
  zoneName?: string;
  appliedAt: string;
  approvedAt?: string | null;
  // vetting artifacts (admin queue)
  selfieUrl?: string | null;
  idPhotoUrl?: string | null;
  videoIntroUrl?: string | null;
  referencesText?: string | null;
  idDocNumber?: string | null;
  suspendedReason?: string | null;
}

export interface SessionUserDTO {
  id: string;
  phone: string;
  name: string;
  role: Role;
  avatarUrl?: string | null;
  zoneId?: string | null;
  zoneName?: string | null;
  addressNote?: string | null;
  addressLat?: number | null;
  addressLng?: number | null;
  /** ISO timestamp — additive; used by the admin users table. */
  createdAt?: string;
  walker?: WalkerProfileDTO | null;
}

export interface DogDTO {
  id: string;
  ownerId: string;
  name: string;
  breed: string;
  size: "S" | "M" | "L";
  ageYears: number;
  temperament: "CALM" | "ENERGETIC" | "ANXIOUS";
  notes?: string | null;
  tags: string[];
  photoUrl?: string | null;
  vetPhone?: string | null;
}

// ---------------------------------------------------------------
// Walkers list/detail
// ---------------------------------------------------------------

export interface WalkerCardDTO {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  walkerId: string;
  bio: string;
  rating: number;
  ratingCount: number;
  totalWalks: number;
  repeatOwners: number;
  price30Cents: number;
  price45Cents: number;
  price60Cents: number;
  zoneId: string;
  zoneName: string;
  responseMinutes: number;
  trialDone: boolean;
  isFavorite?: boolean;
}

export interface WalkerDetailDTO extends WalkerCardDTO {
  experienceYears: number;
  availability: { dayOfWeek: number; startMinute: number; endMinute: number }[];
  reviews: {
    id: string;
    rating: number;
    comment?: string | null;
    createdAt: string;
    ownerName: string;
    ownerAvatarUrl?: string | null;
  }[];
}

// ---------------------------------------------------------------
// Bookings & walks
// ---------------------------------------------------------------

export type BookingStatus =
  | "REQUESTED"
  | "CONFIRMED"
  | "COMPLETED"
  | "CANCELLED"
  | "DECLINED";

/** Recurring: {day:0-6, minute}. One-off: {date:"YYYY-MM-DD", minute} */
export interface ScheduleItem {
  day?: number;
  date?: string;
  minute: number;
}

export interface ReportCardDTO {
  note?: string | null;
  pee: boolean;
  poo: boolean;
  water: boolean;
  photos: string[];
  createdAt: string;
}

export interface WalkDTO {
  id: string;
  bookingId: string;
  status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
  scheduledStart: string;
  durationMin: number;
  startedAt?: string | null;
  endedAt?: string | null;
  distanceMeters: number;
  hasTrack: boolean;
  dog: DogDTO;
  report?: ReportCardDTO | null;
}

export interface PaymentDTO {
  id: string;
  method: PaymentMethod;
  status: "PENDING" | "HELD" | "RELEASED" | "REFUNDED" | "CASH_SETTLED";
  amountCents: number;
  qrRef?: string | null;
  confirmedAt?: string | null;
  createdAt: string;
}

export interface ReviewDTO {
  id: string;
  rating: number;
  comment?: string | null;
  tipCents: number;
  createdAt: string;
  ownerName?: string;
  ownerAvatarUrl?: string | null;
}

export interface PartyDTO {
  id: string;
  name: string;
  avatarUrl?: string | null;
  phone: string;
}

export interface BookingDTO {
  id: string;
  status: BookingStatus;
  type: "ONE_OFF" | "RECURRING";
  schedule: ScheduleItem[];
  durationMin: number;
  pricePerWalkCents: number;
  notes?: string | null;
  requestedAt: string;
  expiresAt?: string | null;
  acceptedAt?: string | null;
  cancelledBy?: "OWNER" | "WALKER" | "ADMIN" | null;
  cancelReason?: string | null;
  owner: PartyDTO;
  walker?: PartyDTO | null;
  dog: DogDTO;
  zone: { id: string; name: string; key: string };
  payment?: PaymentDTO | null;
  walks: WalkDTO[];
  nextWalkAt?: string | null;
  review?: ReviewDTO | null;
}

// ---------------------------------------------------------------
// Money / wallet / payouts
// ---------------------------------------------------------------

export interface LedgerEntryDTO {
  id: string;
  txnId: string;
  account: string;
  debitCents: number;
  creditCents: number;
  memo: string;
  refType?: string | null;
  refId?: string | null;
  createdAt: string;
}

export interface WalletDTO {
  balanceCents: number; // may be negative if cash-walk fees accrued
  pendingPayoutCents: number;
  lifetimeEarnedCents: number;
  entries: LedgerEntryDTO[];
}

export interface PayoutDTO {
  id: string;
  amountCents: number;
  method: string;
  status: "REQUESTED" | "PAID" | "CANCELLED";
  requestedAt: string;
  paidAt?: string | null;
}

// ---------------------------------------------------------------
// Disputes / notifications / admin
// ---------------------------------------------------------------

export interface DisputeDTO {
  id: string;
  bookingId: string;
  walkId?: string | null;
  reason: string;
  description: string;
  status: "OPEN" | "RESOLVED_OWNER" | "RESOLVED_WALKER" | "DISMISSED";
  resolution?: string | null;
  refundCents: number;
  creditCents: number;
  createdAt: string;
  resolvedAt?: string | null;
  booking?: {
    id: string;
    ownerName: string;
    walkerName?: string | null;
    dogName: string;
    pricePerWalkCents: number;
  } | null;
  openedBy: PartyDTO;
  against: PartyDTO;
}

export interface NotificationDTO {
  id: string;
  type: string;
  title: string;
  body: string;
  link?: string | null;
  read: boolean;
  createdAt: string;
}

export interface AdminMetricsDTO {
  totals: {
    owners: number;
    walkers: number;
    pendingWalkers: number;
    dogs: number;
    bookings: number;
    completedWalks: number;
    gmvMonthCents: number;
    revenueMonthCents: number;
    avgRating: number;
  };
  quality: {
    completionPct: number;
    noShowPct: number;
    cancelByOwnerPct: number;
    cancelByWalkerPct: number;
    disputeRatePct: number;
    avgRating: number;
  };
  retention: {
    ownersWithRepeatBooking: number;
    recurringSharePct: number;
  };
  supplyPerZone: {
    zoneId: string;
    zoneName: string;
    walkers: number;
    demandWalks: number;
  }[];
  bookingsTrend: { date: string; count: number }[];
  recentDisputes: number;
}

// ---------------------------------------------------------------
// Auth
// ---------------------------------------------------------------

export interface OtpRequestResponse {
  channel: "whatsapp" | "sms" | "console" | "demo";
  resendInSeconds: number;
  demo: boolean;
}

export interface LoginResponse {
  user: SessionUserDTO;
  isNew: boolean;
}

export interface DemoAccountDTO {
  id: string;
  name: string;
  role: Role;
  phone: string;
  avatarUrl?: string | null;
  subtitle: string;
}
