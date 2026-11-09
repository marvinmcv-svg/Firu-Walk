// Ops alerts (Milestone 8): SOS, late starts and "no backup found" go to
//   - every ADMIN (in-app + web push), and
//   - the ops phones in Config `safety.opsWhatsApp` as the WhatsApp template
//     `firuwalk_ops_alert` (the Cloud API cannot post into WhatsApp groups,
//     so ops lists each phone — or one shared phone that forwards).
// Deliveries are recorded in NotificationDelivery with userId "ops:<phone>".
// Never throws: an alert channel failing must not fail the SOS itself.

import { db } from "@/lib/db";
import type { AppConfig } from "@/lib/firu/types";
import { log } from "../log";
import { notifyAdmins } from "../notify";
import { getWhatsAppSender } from "../notifications/channels";

const PHONE_RE = /^\+\d{8,15}$/;

/** "+59170000001, +59170000002" → ["+59170000001", "+59170000002"]; null if any is invalid. */
export function parseOpsPhones(raw: string): string[] | null {
  const parts = raw
    .split(/[,;\n]/)
    .map((p) => p.replace(/[\s()-]/g, ""))
    .filter(Boolean);
  if (parts.some((p) => !PHONE_RE.test(p))) return null;
  return [...new Set(parts)].slice(0, 10);
}

export function mapsLink(pos: { lat: number; lng: number } | null): string {
  return pos ? `https://maps.google.com/?q=${pos.lat.toFixed(6)},${pos.lng.toFixed(6)}` : "—";
}

export interface OpsAlert {
  /** Short label: "SOS", "Retraso", "Sin respaldo". */
  kind: string;
  /** One line for the ops phones and the admin notification body. */
  summary: string;
  pos: { lat: number; lng: number } | null;
  /** Admin in-app view hint. */
  link?: string;
}

export async function sendOpsAlert(alert: OpsAlert, cfg: AppConfig): Promise<{ whatsappSent: number }> {
  let whatsappSent = 0;
  try {
    await notifyAdmins(
      "SYSTEM",
      `🚨 ${alert.kind}`,
      alert.pos ? `${alert.summary} · ${mapsLink(alert.pos)}` : alert.summary,
      alert.link ?? "ops"
    );
  } catch (err) {
    log.warn("ops.admin_notify_failed", { err });
  }

  const phones = parseOpsPhones(cfg.safety.opsWhatsApp ?? "") ?? [];
  if (phones.length === 0) return { whatsappSent };
  const sender = getWhatsAppSender();
  for (const phone of phones) {
    const userId = `ops:${phone}`;
    if (!sender) {
      await recordOps(userId, "SKIPPED", null, "not configured");
      continue;
    }
    try {
      const res = await sender.send({
        to: phone,
        template: "firuwalk_ops_alert",
        language: "es",
        params: [alert.kind, alert.summary.slice(0, 900), mapsLink(alert.pos)],
      });
      whatsappSent++;
      await recordOps(userId, "SENT", res.messageId, undefined);
    } catch (err) {
      await recordOps(userId, "FAILED", null, (err as Error).message);
      log.warn("ops.whatsapp_failed", { phone, err: (err as Error).message });
    }
  }
  return { whatsappSent };
}

async function recordOps(
  userId: string,
  status: "SENT" | "FAILED" | "SKIPPED",
  providerRef: string | null,
  error: string | undefined
): Promise<void> {
  await db.notificationDelivery
    .create({
      data: {
        userId,
        template: "ops_alert",
        channel: "WHATSAPP",
        status,
        providerRef,
        error: error?.slice(0, 300) ?? null,
      },
    })
    .catch((err) => log.warn("ops.record_failed", { err }));
}
