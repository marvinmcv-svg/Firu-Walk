// Provider selection: PAYMENT_PROVIDER=mock (default outside production) |
// bankqr. In production the mock is refused so a fake QR is never shown to
// a real customer; QR payments stay unavailable until a provider is set up.

import { BankQrProvider } from "./bankQrProvider";
import { MockProvider } from "./mockProvider";
import type { PaymentProvider } from "./provider";
import { ProviderUnavailable } from "./provider";

let override: PaymentProvider | null = null;

/** Tests can swap in a provider double. */
export function setPaymentProviderForTests(p: PaymentProvider | null): void {
  override = p;
}

function isProduction(): boolean {
  return process.env.VERCEL_ENV === "production" || (process.env.NODE_ENV === "production" && !process.env.VERCEL_ENV);
}

/** Name of the configured provider ("mock" unless PAYMENT_PROVIDER says otherwise). */
export function paymentProviderName(): string {
  return override?.name ?? (process.env.PAYMENT_PROVIDER || "mock");
}

/** True when the mock may be used (and its "simulate payment" helper exposed). */
export function mockPaymentsAllowed(): boolean {
  return paymentProviderName() === "mock" && !isProduction();
}

export function getPaymentProvider(name: string = paymentProviderName()): PaymentProvider {
  if (override && override.name === name) return override;
  switch (name) {
    case "mock":
      if (isProduction()) {
        throw new ProviderUnavailable("The mock payment provider cannot be used in production.");
      }
      return new MockProvider();
    case "bankqr":
      return new BankQrProvider();
    default:
      throw new ProviderUnavailable(`Unknown PAYMENT_PROVIDER "${name}".`);
  }
}

export type { PaymentProvider } from "./provider";
export { ProviderUnavailable, WebhookRejected } from "./provider";
