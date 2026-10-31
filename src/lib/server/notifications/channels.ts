// Outbound notification channels behind small interfaces, so development and
// tests run without credentials:
//   WhatsApp — Cloud API template messages (WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID),
//              or the mock outbox outside production.
//   Web push — VAPID (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT) via
//              the `web-push` library, or the mock outbox outside production.
// In production without credentials a channel is simply "not configured" and
// deliveries are recorded as SKIPPED.

import webpush from "web-push";
import { log } from "../log";

const FETCH_TIMEOUT_MS = 8_000;

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

export interface WhatsAppMessage {
  /** E.164 phone ("+5917…"). */
  to: string;
  template: string;
  /** Template language code ("es" | "en"). */
  language: string;
  /** Ordered {{1}}, {{2}}… body parameters. */
  params: string[];
}

export interface WhatsAppSender {
  readonly name: "cloud" | "mock";
  /** Returns the provider message id. Throws on failure. */
  send(msg: WhatsAppMessage): Promise<{ messageId: string | null }>;
}

/** WhatsApp Cloud API (Meta). Templates must be approved in WhatsApp Manager. */
export class WhatsAppCloudSender implements WhatsAppSender {
  readonly name = "cloud" as const;
  constructor(private token: string, private phoneNumberId: string) {}

  async send(msg: WhatsAppMessage): Promise<{ messageId: string | null }> {
    const res = await fetch(`https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: msg.to.replace(/^\+/, ""),
        type: "template",
        template: {
          name: msg.template,
          language: { code: msg.language },
          components: msg.params.length
            ? [{ type: "body", parameters: msg.params.map((text) => ({ type: "text", text })) }]
            : [],
        },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      // Error bodies can echo the phone number — keep only Meta's error code.
      let code = "";
      try {
        const j = (await res.json()) as { error?: { code?: number } };
        code = j.error?.code ? ` (code ${j.error.code})` : "";
      } catch {
        /* not JSON */
      }
      throw new Error(`WhatsApp Cloud API responded ${res.status}${code}`);
    }
    const data = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[] };
    return { messageId: data.messages?.[0]?.id ?? null };
  }
}

// ---------------------------------------------------------------------------
// Web push
// ---------------------------------------------------------------------------

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  /** In-app view hint / URL opened when the notification is tapped. */
  url: string;
  tag?: string;
}

/** The push service says this subscription no longer exists (delete it). */
export class PushGoneError extends Error {}

export interface PushSender {
  readonly name: "webpush" | "mock";
  send(target: PushTarget, payload: PushPayload): Promise<void>;
}

export class WebPushSender implements PushSender {
  readonly name = "webpush" as const;
  constructor(publicKey: string, privateKey: string, subject: string) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  }

  async send(target: PushTarget, payload: PushPayload): Promise<void> {
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 24, timeout: FETCH_TIMEOUT_MS }
      );
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) throw new PushGoneError(`push subscription gone (${status})`);
      throw new Error(`Web push failed${status ? ` (${status})` : ""}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Mock outbox (development / tests)
// ---------------------------------------------------------------------------

export type OutboxItem =
  | ({ channel: "whatsapp" } & WhatsAppMessage)
  | ({ channel: "push"; endpoint: string } & PushPayload);

const outbox: OutboxItem[] = [];

/** Messages the mock channels "sent" (newest last). Tests read this. */
export function mockOutbox(): readonly OutboxItem[] {
  return outbox;
}

export function clearMockOutbox(): void {
  outbox.length = 0;
}

export class MockWhatsAppSender implements WhatsAppSender {
  readonly name = "mock" as const;
  async send(msg: WhatsAppMessage): Promise<{ messageId: string | null }> {
    outbox.push({ channel: "whatsapp", ...msg });
    log.info("whatsapp.mock", { template: msg.template, language: msg.language, params: msg.params });
    return { messageId: `mock-wa-${outbox.length}` };
  }
}

export class MockPushSender implements PushSender {
  readonly name = "mock" as const;
  async send(target: PushTarget, payload: PushPayload): Promise<void> {
    if (target.endpoint.includes("gone")) throw new PushGoneError("mock: subscription gone");
    outbox.push({ channel: "push", endpoint: target.endpoint, ...payload });
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function isProduction(): boolean {
  return process.env.VERCEL_ENV === "production" || (process.env.NODE_ENV === "production" && !process.env.VERCEL_ENV);
}

let waOverride: WhatsAppSender | null | undefined;
let pushOverride: PushSender | null | undefined;

/** Tests inject senders (null = channel not configured; undefined = env default). */
export function setChannelsForTests(opts: { whatsapp?: WhatsAppSender | null; push?: PushSender | null } | null): void {
  waOverride = opts ? opts.whatsapp : undefined;
  pushOverride = opts ? opts.push : undefined;
}

export function getWhatsAppSender(): WhatsAppSender | null {
  if (waOverride !== undefined) return waOverride;
  const e = process.env;
  if (e.WHATSAPP_TOKEN && e.WHATSAPP_PHONE_NUMBER_ID) {
    return new WhatsAppCloudSender(e.WHATSAPP_TOKEN, e.WHATSAPP_PHONE_NUMBER_ID);
  }
  return isProduction() ? null : new MockWhatsAppSender();
}

let webPush: WebPushSender | null = null;

export function getPushSender(): PushSender | null {
  if (pushOverride !== undefined) return pushOverride;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (pub && priv) {
    webPush ??= new WebPushSender(pub, priv, process.env.VAPID_SUBJECT || "mailto:soporte@firuwalk.com");
    return webPush;
  }
  return isProduction() ? null : new MockPushSender();
}

/** VAPID public key the browser subscribes with (null = push unavailable). */
export function pushPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}
