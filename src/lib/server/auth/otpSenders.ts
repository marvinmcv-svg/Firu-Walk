// Login-code delivery channels. Order of preference: WhatsApp (cheapest and
// most used in Bolivia) → SMS → console (development only).

import { log } from "../log";

export interface OtpSender {
  readonly channel: "whatsapp" | "sms" | "console";
  send(phone: string, code: string): Promise<void>;
}

const FETCH_TIMEOUT_MS = 10_000;

async function postOrThrow(url: string, init: RequestInit, what: string): Promise<void> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    // Provider error bodies can echo the phone number — log status only.
    throw new Error(`${what} responded ${res.status}`);
  }
}

/**
 * WhatsApp Cloud API. Requires an approved AUTHENTICATION template with a
 * copy-code button (name in WHATSAPP_OTP_TEMPLATE, default "firuwalk_login").
 */
export class WhatsAppCloudOtpSender implements OtpSender {
  readonly channel = "whatsapp" as const;
  constructor(
    private token: string,
    private phoneNumberId: string,
    private template = "firuwalk_login",
    private language = "es"
  ) {}

  async send(phone: string, code: string): Promise<void> {
    await postOrThrow(
      `https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phone.replace(/^\+/, ""),
          type: "template",
          template: {
            name: this.template,
            language: { code: this.language },
            components: [
              { type: "body", parameters: [{ type: "text", text: code }] },
              { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
            ],
          },
        }),
      },
      "WhatsApp Cloud API"
    );
  }
}

/** SMS via Twilio (fallback when WhatsApp fails or the number has no WhatsApp). */
export class TwilioSmsOtpSender implements OtpSender {
  readonly channel = "sms" as const;
  constructor(private sid: string, private authToken: string, private from: string) {}

  async send(phone: string, code: string): Promise<void> {
    await postOrThrow(
      `https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.sid}:${this.authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: phone,
          From: this.from,
          Body: `FiruWalk: tu código es ${code}. Vence en 5 minutos. No lo compartas con nadie.`,
        }),
      },
      "Twilio"
    );
  }
}

/** Development only: prints the code to the server log. */
export class ConsoleOtpSender implements OtpSender {
  readonly channel = "console" as const;
  async send(phone: string, code: string): Promise<void> {
    log.info("otp.console", { phone, code });
  }
}

let override: OtpSender[] | null = null;

/** Tests inject fake senders here. */
export function setOtpSendersForTests(senders: OtpSender[] | null): void {
  override = senders;
}

/** Configured senders in preference order. Empty in production without providers. */
export function getOtpSenders(): OtpSender[] {
  if (override) return override;
  const e = process.env;
  const senders: OtpSender[] = [];
  if (e.WHATSAPP_TOKEN && e.WHATSAPP_PHONE_NUMBER_ID) {
    senders.push(
      new WhatsAppCloudOtpSender(
        e.WHATSAPP_TOKEN,
        e.WHATSAPP_PHONE_NUMBER_ID,
        e.WHATSAPP_OTP_TEMPLATE || undefined,
        e.WHATSAPP_OTP_LANGUAGE || undefined
      )
    );
  }
  if (e.TWILIO_ACCOUNT_SID && e.TWILIO_AUTH_TOKEN && e.TWILIO_FROM) {
    senders.push(new TwilioSmsOtpSender(e.TWILIO_ACCOUNT_SID, e.TWILIO_AUTH_TOKEN, e.TWILIO_FROM));
  }
  if (e.NODE_ENV !== "production") senders.push(new ConsoleOtpSender());
  return senders;
}
