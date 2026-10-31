// POST /api/payments/webhook/[provider] — payment provider callbacks.
// Public endpoint: authenticity comes from the provider's signature
// (verifyWebhook), never from cookies. Redelivered events are no-ops.
// 200 for every authentic event (so the provider stops retrying), 401 for
// anything not authentic, 5xx only when we failed and want a retry.

import { NextResponse } from "next/server";
import { log } from "@/lib/server/log";
import { handleWebhook, WebhookRejected } from "@/lib/server/payments/service";
import { ProviderUnavailable } from "@/lib/server/payments/provider";

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const raw = await req.text();
  if (raw.length > 64_000) return NextResponse.json({ error: "payload too large" }, { status: 413 });
  try {
    const outcome = await handleWebhook(provider, raw, req.headers);
    log.info("payments.webhook", { provider, ...outcome });
    return NextResponse.json({ ok: true, ...outcome });
  } catch (err) {
    if (err instanceof WebhookRejected) {
      log.warn("payments.webhook_rejected", { provider, reason: err.message });
      return NextResponse.json({ error: "invalid webhook" }, { status: 401 });
    }
    if (err instanceof ProviderUnavailable) {
      return NextResponse.json({ error: "unknown provider" }, { status: 404 });
    }
    log.error("payments.webhook_failed", { provider, err });
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
