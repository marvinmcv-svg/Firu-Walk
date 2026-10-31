// Notifier — delivers one event to a user on every channel they allow:
//   in-app   always (the Notification row is the record shown in the bell),
//   WhatsApp templated events only (business-initiated WhatsApp messages
//            must use an approved template), when the user allows it,
//   web push every notification, to each browser the user subscribed.
// Every attempt is logged in NotificationDelivery. A failing channel never
// fails the request that triggered it.

import type { NotificationType } from "@prisma/client";
import { db } from "@/lib/db";
import { log } from "../log";
import { isDemoPhone } from "../auth/demo";
import { getPushSender, getWhatsAppSender, PushGoneError } from "./channels";
import { renderTemplate, type Locale, type TemplateKey, type TemplateVars } from "./templates";

export interface ChannelPrefs {
  whatsapp: boolean;
  push: boolean;
  locale: Locale;
}

export const DEFAULT_PREFS: ChannelPrefs = { whatsapp: true, push: true, locale: "es" };

export async function getPrefs(userId: string): Promise<ChannelPrefs> {
  const row = await db.notificationPreference.findUnique({ where: { userId } });
  if (!row) return { ...DEFAULT_PREFS };
  return { whatsapp: row.whatsapp, push: row.push, locale: row.locale === "en" ? "en" : "es" };
}

function appUrl(): string {
  return process.env.APP_URL || "http://localhost:3000";
}

async function record(
  userId: string,
  notificationId: string | null,
  template: string,
  channel: "IN_APP" | "WHATSAPP" | "PUSH",
  status: "SENT" | "FAILED" | "SKIPPED",
  extra: { providerRef?: string | null; error?: string } = {}
): Promise<void> {
  try {
    await db.notificationDelivery.create({
      data: {
        userId,
        notificationId,
        template,
        channel,
        status,
        providerRef: extra.providerRef ?? null,
        error: extra.error?.slice(0, 300) ?? null,
      },
    });
  } catch (err) {
    log.warn("notify.record_failed", { err });
  }
}

/** Web push to every subscribed browser of the user (expired ones are removed). */
async function deliverPush(
  userId: string,
  notificationId: string,
  template: string,
  title: string,
  body: string,
  link: string | null,
  pushUrl?: string
): Promise<void> {
  const subs = await db.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) return;
  const sender = getPushSender();
  if (!sender) {
    await record(userId, notificationId, template, "PUSH", "SKIPPED", { error: "not configured" });
    return;
  }
  const url = pushUrl ?? (link ? `/?view=${encodeURIComponent(link)}` : "/");
  for (const s of subs) {
    try {
      await sender.send(s, { title, body, url, tag: notificationId });
      await db.pushSubscription.update({ where: { id: s.id }, data: { lastUsedAt: new Date() } });
      await record(userId, notificationId, template, "PUSH", "SENT");
    } catch (err) {
      if (err instanceof PushGoneError) {
        await db.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
      }
      await record(userId, notificationId, template, "PUSH", "FAILED", { error: (err as Error).message });
      log.warn("notify.push_failed", { userId, template, err: (err as Error).message });
    }
  }
}

/**
 * Plain in-app notification (+ web push). Used for events that have no
 * WhatsApp template (admin alerts, disputes, application decisions…).
 */
export async function notify(
  userId: string,
  type: NotificationType,
  title: string,
  body: string,
  link?: string | null
): Promise<void> {
  const n = await db.notification.create({
    data: { userId, type, title, body, link: link ?? null },
  });
  try {
    const prefs = await getPrefs(userId);
    if (prefs.push) await deliverPush(userId, n.id, "generic", title, body, link ?? null);
  } catch (err) {
    log.warn("notify.channels_failed", { userId, err });
  }
}

/** Notify every ADMIN user (used for applications, payout requests, disputes). */
export async function notifyAdmins(
  type: NotificationType,
  title: string,
  body: string,
  link?: string | null
): Promise<void> {
  const admins = await db.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  for (const a of admins) {
    await notify(a.id, type, title, body, link);
  }
}

/**
 * A templated event (booking request, walk started, payout sent…): rendered
 * in the user's language, stored in-app, sent as a WhatsApp template and as
 * web push according to the user's preferences.
 */
export async function notifyEvent<K extends TemplateKey>(
  userId: string,
  key: K,
  vars: TemplateVars[K]
): Promise<void> {
  const prefs = await getPrefs(userId);
  const r = renderTemplate(key, vars, { locale: prefs.locale, appUrl: appUrl() });

  const n = await db.notification.create({
    data: { userId, type: r.type, title: r.title, body: r.body, link: r.link },
  });
  await record(userId, n.id, key, "IN_APP", "SENT");

  try {
    // WhatsApp
    if (!prefs.whatsapp) {
      await record(userId, n.id, key, "WHATSAPP", "SKIPPED", { error: "opted out" });
    } else {
      const sender = getWhatsAppSender();
      const user = await db.user.findUnique({ where: { id: userId }, select: { phone: true } });
      if (!sender) {
        await record(userId, n.id, key, "WHATSAPP", "SKIPPED", { error: "not configured" });
      } else if (!user || (sender.name === "cloud" && isDemoPhone(user.phone))) {
        await record(userId, n.id, key, "WHATSAPP", "SKIPPED", { error: "no reachable phone" });
      } else {
        try {
          const res = await sender.send({
            to: user.phone,
            template: r.waTemplate,
            language: prefs.locale,
            params: r.waParams,
          });
          await record(userId, n.id, key, "WHATSAPP", "SENT", { providerRef: res.messageId });
        } catch (err) {
          await record(userId, n.id, key, "WHATSAPP", "FAILED", { error: (err as Error).message });
          log.warn("notify.whatsapp_failed", { userId, template: key, err: (err as Error).message });
        }
      }
    }

    // Web push
    if (prefs.push) await deliverPush(userId, n.id, key, r.title, r.body, r.link, r.pushUrl);
  } catch (err) {
    log.warn("notify.channels_failed", { userId, template: key, err });
  }
}
