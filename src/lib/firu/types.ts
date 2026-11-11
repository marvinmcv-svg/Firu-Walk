// FiruWalk shared API types — THE contract between frontend and backend.
// API routes must serialize to these exact shapes.

export type Role = "OWNER" | "WALKER" | "ADMIN";

export type PaymentMethod = "QR" | "TRANSFER" | "CASH" | "PLAN";

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
  /** True when payments run on the mock provider (dev): UI may simulate paying. */
  paymentsMock?: boolean;
  demo: {
    otpCode: string; // demo login code — empty unless demo mode is on
    acceptTimeoutSeconds: number; // demo-fast fallback window
  };
  payouts: {
    cycle: string; // "weekly"
    minPayoutCents: number;
    maxCashDebtCents: number; // walkers owing more (cash-walk fees) get no new bookings
  };
  plans: {
    unusedWalkPolicy: "forfeit" | "credit"; // at period end: platform keeps it / owner credit
    expiryReminderDays: number; // "plan expiring" reminder this many days before the end (0 = off)
  };
  payments: {
    qrExpiryMinutes: number; // lifetime of a generated QR
  };
  safety: {
    lateStartMinutes: number; // walk not started this long after its time → late alert + backup chain
    backupOfferMinutes: number; // each backup walker has this long to take the walk
    reminderMinutesBefore: number; // walker reminder before the walk (0 = off)
    opsWhatsApp: string; // ops phone numbers for SOS / late alerts, comma-separated ("" = none)
  };
  ai: {
    enabled: number; // 1 = FirulAI answers with the LLM, 0 = canned reply + WhatsApp
    dailyMessagesPerIp: number; // FirulAI replies per visitor IP per day
    dailyCostCentsPerIp: number; // model spend cap per IP per day, US cents
    dailyCostCentsTotal: number; // model spend cap for everyone per day, US cents
    retentionDays: number; // saved FirulAI chats are deleted after this many days
  };
  /** Company details shown in the legal pages ("" = not set yet; the brand name is used). */
  legal: {
    companyName: string; // registered name (SEPREC), e.g. "FiruWalk S.R.L."
    nit: string; // tax ID
    address: string;
    email: string;
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
  // vetting (Milestone 7) — never the full CI number, never document URLs
  referencesText?: string | null;
  idDocLast4?: string | null;
  review: WalkerReviewDTO;
  suspendedReason?: string | null;
}

export type WalkerDocKind = "CI_FRONT" | "CI_BACK" | "SELFIE" | "BACKGROUND_CERT" | "VIDEO_INTRO";

export interface WalkerReviewDTO {
  identityOk: boolean;
  backgroundOk: boolean;
  interviewDone: boolean;
  trialWalkDone: boolean;
  notes?: string | null;
  reviewedAt?: string | null;
}

export interface WalkerDocumentDTO {
  id: string;
  kind: WalkerDocKind;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
  /** Admin view only: short-lived signed URL (expires in minutes). */
  viewUrl?: string;
}

/** GET /api/walkers/me/vetting and /api/admin/walkers/[id]/vetting */
export interface WalkerVettingDTO {
  walkerId: string;
  status: WalkerProfileDTO["status"];
  idDocLast4: string | null;
  documents: WalkerDocumentDTO[];
  /** Required kinds still missing. */
  missing: WalkerDocKind[];
  review: WalkerReviewDTO;
  /** Documents complete + CI number on file. */
  documentsComplete: boolean;
  /** documentsComplete + all four checklist items → approvable. */
  readyToApprove: boolean;
  storageReady: boolean;
}

export interface DocumentUploadTicketDTO {
  documentId: string;
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
  maxBytes: number;
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
  onTheWayAt?: string | null;
  endedAt?: string | null;
  distanceMeters: number;
  hasTrack: boolean;
  dog: DogDTO;
  report?: ReportCardDTO | null;
}

export interface PaymentDTO {
  id: string;
  purpose: "WALK" | "PLAN";
  method: PaymentMethod;
  status: "PENDING" | "HELD" | "RELEASED" | "REFUNDED" | "CASH_SETTLED";
  amountCents: number; // total the owner pays
  ownerFeeCents: number; // service fee included in amountCents
  refundedCents: number;
  qrRef?: string | null;
  /** Provider QR (data: URI) while the payment is pending. */
  qrImage?: string | null;
  qrExpiresAt?: string | null;
  confirmedAt?: string | null;
  confirmSource?: string | null;
  createdAt: string;
}

/** Breakdown shown before paying. */
export interface PriceBreakdown {
  baseCents: number;
  ownerFeeCents: number;
  totalCents: number;
}

export interface PlanDTO {
  id: string;
  key: string;
  name: string;
  walks: number;
  durationMin: number;
  priceCents: number;
  periodDays: number;
  active: boolean;
  perWalkCents: number;
  ownerFeeCents: number;
  totalCents: number;
}

export interface SubscriptionDTO {
  id: string;
  status: "PENDING_PAYMENT" | "ACTIVE" | "EXPIRED" | "CANCELLED";
  plan: PlanDTO;
  walksTotal: number;
  walksUsed: number;
  walksLeft: number;
  durationMin: number;
  priceCents: number;
  periodStart?: string | null;
  periodEnd?: string | null;
  payment?: PaymentDTO | null;
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
  /** Only in admin views — owners and walkers never see each other's number. */
  phone?: string;
}

export interface NotificationPrefsDTO {
  whatsapp: boolean;
  push: boolean;
  locale: "es" | "en";
  /** WhatsApp delivery is configured on the server. */
  whatsappAvailable: boolean;
  /** VAPID key to subscribe this browser (null = web push unavailable). */
  pushPublicKey: string | null;
  /** Browsers/devices subscribed to push. */
  pushDevices: number;
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
  destination: PayoutDestinationDTO;
  maxCashDebtCents: number;
  blockedForDebt: boolean; // cash debt over the limit → no new bookings
}

export interface PayoutDTO {
  id: string;
  amountCents: number;
  method: string;
  status: "REQUESTED" | "APPROVED" | "PAID" | "CANCELLED";
  requestedAt: string;
  paidAt?: string | null;
  reference?: string | null;
  batchId?: string | null;
  destRef?: string | null;
}

export interface PayoutDestinationDTO {
  payoutMethod: "QR" | "BANK" | null;
  payoutBank: string | null;
  payoutAccount: string | null;
  payoutHolder: string | null;
}

export interface PayoutBatchDTO {
  id: string;
  status: "DRAFT" | "APPROVED" | "PAID";
  periodStart: string;
  periodEnd: string;
  totalCents: number;
  reference?: string | null;
  approvedAt?: string | null;
  paidAt?: string | null;
  createdAt: string;
  payouts: (PayoutDTO & { walkerId: string; walkerName: string | null })[];
}

export interface ReconIssueDTO {
  id: string;
  kind: "SETTLED_NOT_RECORDED" | "RECORDED_NOT_SETTLED" | "AMOUNT_MISMATCH" | "UNKNOWN_REFERENCE" | "LEDGER_UNBALANCED" | "MANUAL_REFUND";
  status: "OPEN" | "RESOLVED";
  paymentId?: string | null;
  providerRef?: string | null;
  expectedCents?: number | null;
  actualCents?: number | null;
  detail: string;
  resolution?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
}

export interface ReconRunDTO {
  id: string;
  provider: string;
  periodStart: string;
  periodEnd: string;
  settledCount: number;
  settledCents: number;
  recordedCount: number;
  recordedCents: number;
  issuesFound: number;
  createdAt: string;
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

// ---------------------------------------------------------------
// Safety & ops (Milestone 8)
// ---------------------------------------------------------------

export interface VetDTO {
  id: string;
  name: string;
  phone: string;
  address: string;
  lat: number;
  lng: number;
  open24h: boolean;
  notes: string | null;
  active: boolean;
  /** Meters from the position it was searched from (null without one). */
  distanceM: number | null;
}

export interface SosResponseDTO {
  incidentId: string;
  repeated: boolean;
  position: { lat: number; lng: number } | null;
  vets: VetDTO[];
  supportWhatsApp: string;
}

export interface IncidentDTO {
  id: string;
  type: "SOS" | "LATE" | "INJURY" | "OTHER";
  status: "OPEN" | "RESOLVED";
  note: string;
  lat: number | null;
  lng: number | null;
  mapsUrl: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
  walk: {
    id: string;
    status: string;
    scheduledStart: string;
    dogName: string;
    zoneName: string;
    walkerName: string;
    walkerPhone: string;
    ownerName: string;
    ownerPhone: string;
  } | null;
  reporterName: string;
}

export interface BackupOfferDTO {
  walkId: string;
  dogName: string;
  dogPhotoUrl: string | null;
  zoneName: string;
  scheduledStart: string;
  durationMin: number;
  expiresAt: string;
}

export interface OpsLiveWalkDTO {
  walkId: string;
  dogName: string;
  walkerName: string;
  walkerPhone: string;
  ownerName: string;
  zoneName: string;
  startedAt: string | null;
  durationMin: number;
  /** Last accepted GPS fix. */
  last: [number, number] | null;
  lastFixAt: string | null;
  track: [number, number][];
  openSos: boolean;
  mockLocation: boolean;
}

export interface OpsLateWalkDTO {
  walkId: string;
  dogName: string;
  walkerName: string;
  walkerPhone: string;
  ownerName: string;
  ownerPhone: string;
  zoneName: string;
  scheduledStart: string;
  minutesLate: number;
  backupWalkerName: string | null;
  backupExpiresAt: string | null;
  backupExhausted: boolean;
}

export interface JobStatusDTO {
  job: string;
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  lastTrigger: string | null;
}

export interface OpsLiveDTO {
  inProgress: OpsLiveWalkDTO[];
  late: OpsLateWalkDTO[];
  openIncidents: number;
  jobs: JobStatusDTO[];
}

export interface LeaderboardRowDTO {
  userId: string;
  name: string;
  avatarUrl: string | null;
  zoneName: string;
  status: string;
  rating: number;
  ratingCount: number;
  /** Walks this walker started in the period. */
  walksStarted: number;
  /** % of started walks that began within safety.lateStartMinutes (null with none). */
  onTimePct: number | null;
  /** Walks they never started: reassigned to a backup, or left unstarted. */
  noShows: number;
  sosCount: number;
}

// ---------------------------------------------------------------
// FirulAI admin (Milestone 9)
// ---------------------------------------------------------------

export interface FirulaiAdminDTO {
  days: { day: string; requests: number; inputTokens: number; outputTokens: number; costMicroUsd: number }[];
  conversations: {
    id: string;
    userName: string | null;
    lang: string;
    messageCount: number;
    costMicroUsd: number;
    handoff: boolean;
    preview: string;
    updatedAt: string;
  }[];
}

export interface FirulaiConversationDTO {
  id: string;
  messages: { role: string; content: string; toolCalls: unknown; degraded: string | null; createdAt: string }[];
}
