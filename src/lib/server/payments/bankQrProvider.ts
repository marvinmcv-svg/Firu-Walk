// BankQrProvider — adapter skeleton for the real Bolivian QR provider.
//
// TODO(business): pick the bank / aggregator (BNB, BCP, Banco Ganadero,
// Libélula, PagosNet…) and fill in each method from its API docs. Typical
// shape of these APIs:
//   - createQr: POST with amount (BOB), currency, our reference, expiry →
//     returns a QR id and the QR image as base64 PNG.
//   - webhook: POST to /api/payments/webhook/bankqr when the QR is paid,
//     authenticated with a shared secret / HMAC header / IP allow-list.
//   - status: GET by QR id → paid / pending / expired, amount, payer bank.
//   - settlements: daily report (API or SFTP CSV) of collected QRs.
//   - refunds: often NOT available by API — return null and ops refunds by
//     bank transfer (reconciliation keeps the trail).
// Credentials: PAYMENT_API_URL, PAYMENT_API_KEY, PAYMENT_WEBHOOK_SECRET.

import type { ChargeState, CreatedQr, PaymentProvider, Settlement, WebhookEvent } from "./provider";
import { ProviderUnavailable } from "./provider";

function notReady(): never {
  throw new ProviderUnavailable(
    "BankQrProvider is a skeleton: implement it once the QR provider is chosen (src/lib/server/payments/bankQrProvider.ts)."
  );
}

export class BankQrProvider implements PaymentProvider {
  readonly name = "bankqr";

  async createQr(_amountCents: number, _reference: string, _expiresAt: Date): Promise<CreatedQr> {
    return notReady();
  }

  async verifyWebhook(_rawBody: string, _headers: Headers): Promise<WebhookEvent> {
    return notReady();
  }

  async getStatus(_providerRef: string): Promise<ChargeState> {
    return notReady();
  }

  async listSettlements(_from: Date, _to: Date): Promise<Settlement[]> {
    return notReady();
  }

  async refund(_providerRef: string, _amountCents: number): Promise<{ refundRef: string } | null> {
    return null;
  }
}
