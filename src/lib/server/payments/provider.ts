// PaymentProvider — the one seam between FiruWalk and a Bolivian bank QR /
// aggregator. Everything else (ledger, plans, payouts) talks to this
// interface, so swapping providers never touches business logic.
//
// Contract:
//   - createQr: issue a QR for `amountCents` that expires at `expiresAt`.
//     `reference` is ours (unique per payment) and must come back in
//     webhooks/settlements so a payment can always be matched.
//   - verifyWebhook: authenticate the raw request (signature/secret) and
//     normalize it. MUST throw WebhookRejected for anything not authentic.
//   - getStatus: ask the provider about one QR (used by the status poll).
//   - listSettlements: what the provider says it collected in [from, to)
//     (daily reconciliation).
//   - refund: return money to the payer, or null when the provider has no
//     refund API (ops then transfers it by hand; see reconciliation).

export type ChargeStatus = "PENDING" | "PAID" | "EXPIRED" | "REFUNDED" | "UNKNOWN";

export interface CreatedQr {
  /** Image to show the owner: data: URI (PNG/SVG) or https URL. */
  qrImage: string;
  /** Provider id for this QR — unique; webhooks and polls refer to it. */
  providerRef: string;
  expiresAt: Date;
}

export interface ChargeState {
  providerRef: string;
  status: ChargeStatus;
  /** Amount actually collected (PAID), integer centavos. */
  paidCents?: number;
  paidAt?: Date;
}

export interface WebhookEvent extends ChargeState {
  /** Provider event id — the idempotency key for redelivered webhooks. */
  eventId: string;
  raw: unknown;
}

export interface Settlement {
  providerRef: string;
  reference: string;
  amountCents: number;
  paidAt: Date;
}

export interface PaymentProvider {
  readonly name: string;
  createQr(amountCents: number, reference: string, expiresAt: Date): Promise<CreatedQr>;
  verifyWebhook(rawBody: string, headers: Headers): Promise<WebhookEvent>;
  getStatus(providerRef: string): Promise<ChargeState>;
  listSettlements(from: Date, to: Date): Promise<Settlement[]>;
  refund(providerRef: string, amountCents: number): Promise<{ refundRef: string } | null>;
}

/** Thrown by verifyWebhook when a request is not authentic or malformed. */
export class WebhookRejected extends Error {}

/** Thrown when the configured provider cannot be used (not set up yet). */
export class ProviderUnavailable extends Error {}
