// Notification templates (ES/EN). Each event renders:
//   - the in-app notification (title + body, stored in the Notification table
//     and reused as the web push text), and
//   - the WhatsApp Cloud API template: an approved template name plus its
//     ordered {{n}} body parameters. The template texts to submit to Meta are
//     in docs/WHATSAPP_TEMPLATES.md — keep both in sync.

import type { BookingType, NotificationType } from "@prisma/client";
import type { ScheduleItem } from "@/lib/firu/types";
import { scheduleSummary } from "../botime";

export type Locale = "es" | "en";

export interface TemplateVars {
  booking_request: {
    ownerName: string;
    dogName: string;
    zoneName: string;
    schedule: ScheduleItem[];
    bookingType: BookingType;
    durationMin: number;
    acceptSeconds: number;
  };
  booking_confirmed: {
    walkerName: string;
    dogName: string;
    schedule: ScheduleItem[];
    bookingType: BookingType;
    payment: "CASH" | "PLAN" | "QR";
  };
  walker_on_the_way: { walkerName: string; dogName: string; walkId: string };
  walk_started: { walkerName: string; dogName: string; walkId: string };
  walk_finished: {
    walkerName: string;
    dogName: string;
    walkId: string;
    hasTrack: boolean;
    cashCents: number | null; // cash to hand over, when paid in cash
  };
  payment_received: { amountCents: number; dogName?: string; planName?: string };
  payout_sent: { amountCents: number; method: "BANK" | "QR"; reference: string };
  plan_expiring: { planName: string; periodEnd: Date; walksLeft: number };
  // Milestone 8 — safety & ops
  walk_reminder: { dogName: string; zoneName: string; startsAt: Date; walkId: string };
  walk_sos: { walkerName: string; dogName: string; walkId: string };
  walk_late: { walkerName: string; dogName: string; walkId: string; minutesLate: number };
  backup_offer: { dogName: string; zoneName: string; startsAt: Date; durationMin: number; minutesToAccept: number };
  walk_reassigned: { walkerName: string; dogName: string; walkId: string };
  backup_none: { dogName: string; walkId: string };
}

export type TemplateKey = keyof TemplateVars;

export const TEMPLATE_KEYS = [
  "booking_request",
  "booking_confirmed",
  "walker_on_the_way",
  "walk_started",
  "walk_finished",
  "payment_received",
  "payout_sent",
  "plan_expiring",
  "walk_reminder",
  "walk_sos",
  "walk_late",
  "backup_offer",
  "walk_reassigned",
  "backup_none",
] as const satisfies readonly TemplateKey[];

export interface Rendered {
  type: NotificationType;
  /** In-app view hint (see AppShell). */
  link: string;
  /** Where a tapped web push opens (default: the view hint). */
  pushUrl?: string;
  title: string;
  body: string;
  /** WhatsApp template name (same name for every language). */
  waTemplate: string;
  /** Ordered {{1}}, {{2}}… body parameters. */
  waParams: string[];
}

export interface RenderCtx {
  locale: Locale;
  /** Public base URL for links in WhatsApp messages. */
  appUrl: string;
}

/** Integer centavos → "Bs 15,00" (es) / "Bs 15.00" (en), independent of the UI language. */
export function money(cents: number, locale: Locale): string {
  const n = (Math.abs(cents) / 100).toLocaleString(locale === "en" ? "en-US" : "es-BO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${cents < 0 ? "-" : ""}Bs ${n}`;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** "25/10/2026" (es) or "10/25/2026" (en), Bolivia time (UTC-4). */
function boDate(d: Date, locale: Locale): string {
  const bo = new Date(d.getTime() - 4 * 3_600_000);
  const dd = `${bo.getUTCDate()}`.padStart(2, "0");
  const mm = `${bo.getUTCMonth() + 1}`.padStart(2, "0");
  return locale === "en" ? `${mm}/${dd}/${bo.getUTCFullYear()}` : `${dd}/${mm}/${bo.getUTCFullYear()}`;
}

/** "17:30" in Bolivia time (UTC-4). */
export function boTime(d: Date): string {
  const bo = new Date(d.getTime() - 4 * 3_600_000);
  return `${`${bo.getUTCHours()}`.padStart(2, "0")}:${`${bo.getUTCMinutes()}`.padStart(2, "0")}`;
}

/** Deep link that opens a walk (live map or finished report) in the app. */
export function walkLink(appUrl: string, walkId: string): string {
  return `${appUrl.replace(/\/$/, "")}/?walk=${encodeURIComponent(walkId)}`;
}

type Renderer<K extends TemplateKey> = (v: TemplateVars[K], ctx: RenderCtx) => Rendered;

const RENDERERS: { [K in TemplateKey]: Renderer<K> } = {
  booking_request: (v, { locale }) => {
    const summary = scheduleSummary(v.schedule, v.bookingType, locale);
    return {
      type: "BOOKING",
      link: "home",
      waTemplate: "firuwalk_booking_request",
      waParams: [firstName(v.ownerName), v.dogName, v.zoneName, summary, String(v.durationMin)],
      ...(locale === "en"
        ? {
            title: "New booking request ⏳",
            body: `${v.ownerName} requests walks for ${v.dogName} in ${v.zoneName} (${summary}, ${v.durationMin} min). You have ${v.acceptSeconds} seconds to accept.`,
          }
        : {
            title: "Nueva solicitud de reserva ⏳",
            body: `${v.ownerName} solicita paseos para ${v.dogName} en ${v.zoneName} (${summary}, ${v.durationMin} min). Tienes ${v.acceptSeconds} segundos para aceptar.`,
          }),
    };
  },

  booking_confirmed: (v, { locale }) => {
    const summary = scheduleSummary(v.schedule, v.bookingType, locale);
    const hint =
      locale === "en"
        ? v.payment === "CASH"
          ? "You'll pay in cash when the walk ends."
          : v.payment === "PLAN"
            ? "The walks are taken from your plan."
            : "Pay with QR to secure the first walk."
        : v.payment === "CASH"
          ? "El pago será en efectivo al finalizar el paseo."
          : v.payment === "PLAN"
            ? "Los paseos se descuentan de tu plan."
            : "Paga con QR para asegurar el primer paseo.";
    return {
      type: "BOOKING",
      link: "bookings",
      waTemplate: "firuwalk_booking_confirmed",
      waParams: [firstName(v.walkerName), v.dogName, summary],
      ...(locale === "en"
        ? {
            title: "Booking confirmed! ✅",
            body: `${v.walkerName} confirmed ${v.dogName}'s walks (${summary}). ${hint}`,
          }
        : {
            title: "¡Reserva confirmada! ✅",
            body: `${v.walkerName} confirmó los paseos de ${v.dogName} (${summary}). ${hint}`,
          }),
    };
  },

  walker_on_the_way: (v, { locale }) => ({
    type: "WALK",
    link: "walk-live",
    pushUrl: `/?walk=${encodeURIComponent(v.walkId)}`,
    waTemplate: "firuwalk_walker_on_the_way",
    waParams: [firstName(v.walkerName), v.dogName],
    ...(locale === "en"
      ? {
          title: "Your walker is on the way 🚶",
          body: `${v.walkerName} is heading over to pick up ${v.dogName}. Get the leash ready!`,
        }
      : {
          title: "Tu paseador va en camino 🚶",
          body: `${v.walkerName} va en camino a buscar a ${v.dogName}. ¡Ten lista la correa!`,
        }),
  }),

  walk_started: (v, { locale, appUrl }) => ({
    type: "WALK",
    link: "walk-live",
    pushUrl: `/?walk=${encodeURIComponent(v.walkId)}`,
    waTemplate: "firuwalk_walk_started",
    waParams: [firstName(v.walkerName), v.dogName, walkLink(appUrl, v.walkId)],
    ...(locale === "en"
      ? {
          title: "The walk has started! 🐾",
          body: `${v.walkerName} started ${v.dogName}'s walk. Follow it live on the map.`,
        }
      : {
          title: "¡El paseo empezó! 🐾",
          body: `${v.walkerName} inició el paseo de ${v.dogName}. Sigue el recorrido en vivo en el mapa.`,
        }),
  }),

  walk_finished: (v, { locale, appUrl }) => {
    const cash = v.cashCents != null ? money(v.cashCents, locale) : null;
    return {
      type: "WALK",
      link: "bookings",
      pushUrl: `/?walk=${encodeURIComponent(v.walkId)}`,
      waTemplate: "firuwalk_walk_finished",
      waParams: [firstName(v.walkerName), v.dogName, walkLink(appUrl, v.walkId)],
      ...(locale === "en"
        ? {
            title: "Report ready 🎉",
            body: `${v.walkerName} finished ${v.dogName}'s walk${v.hasTrack ? " with a route map" : ""}. See the photos and the full report.${cash ? ` Have ${cash} ready in cash.` : ""}`,
          }
        : {
            title: "Reporte listo 🎉",
            body: `${v.walkerName} terminó el paseo de ${v.dogName}${v.hasTrack ? " con mapa del recorrido" : ""}. Mira las fotos y el reporte completo.${cash ? ` Ten listo ${cash} en efectivo.` : ""}`,
          }),
    };
  },

  payment_received: (v, { locale }) => {
    const amount = money(v.amountCents, locale);
    const concept = v.planName
      ? v.planName
      : locale === "en"
        ? `${v.dogName ?? "your dog"}'s walk`
        : `paseo de ${v.dogName ?? "tu perrito"}`;
    return {
      type: "PAYMENT",
      link: v.planName ? "home" : "bookings",
      waTemplate: "firuwalk_payment_received",
      waParams: [amount, concept],
      ...(v.planName
        ? locale === "en"
          ? {
              title: "Plan activated! 🎉",
              body: `We received your ${amount} payment. Your ${v.planName} is active: book your walks whenever you like.`,
            }
          : {
              title: "¡Plan activado! 🎉",
              body: `Recibimos tu pago de ${amount}. Tu ${v.planName} ya está activo: reserva tus paseos cuando quieras.`,
            }
        : locale === "en"
          ? {
              title: "Payment received 🔒",
              body: `We received your ${amount} payment. FiruWalk holds it and releases it to the walker when the walk is completed.`,
            }
          : {
              title: "Pago recibido 🔒",
              body: `Recibimos tu pago de ${amount}. Queda retenido por FiruWalk y se libera al paseador cuando el paseo se complete.`,
            }),
    };
  },

  payout_sent: (v, { locale }) => {
    const amount = money(v.amountCents, locale);
    return {
      type: "PAYOUT",
      link: "earnings",
      waTemplate: "firuwalk_payout_sent",
      waParams: [amount, v.reference],
      ...(locale === "en"
        ? {
            title: "Payout sent! 💸",
            body: `We sent you ${amount} by ${v.method === "BANK" ? "bank transfer" : "QR"} (ref. ${v.reference}). Great work! 🐾`,
          }
        : {
            title: "¡Pago enviado! 💸",
            body: `Te enviamos ${amount} por ${v.method === "BANK" ? "transferencia bancaria" : "QR"} (ref. ${v.reference}). ¡Buen trabajo! 🐾`,
          }),
    };
  },

  plan_expiring: (v, { locale }) => {
    const date = boDate(v.periodEnd, locale);
    return {
      type: "PAYMENT",
      link: "home",
      waTemplate: "firuwalk_plan_expiring",
      waParams: [v.planName, date, String(v.walksLeft)],
      ...(locale === "en"
        ? {
            title: "Your plan is ending soon 📅",
            body: `Your ${v.planName} ends on ${date} and you have ${v.walksLeft} walks left. Use them or renew to keep walking.`,
          }
        : {
            title: "Tu plan está por vencer 📅",
            body: `Tu ${v.planName} vence el ${date} y te quedan ${v.walksLeft} paseos. Úsalos o renueva para seguir paseando.`,
          }),
    };
  },

  walk_reminder: (v, { locale }) => {
    const time = boTime(v.startsAt);
    return {
      type: "WALK",
      link: "home",
      waTemplate: "firuwalk_walk_reminder",
      waParams: [v.dogName, time, v.zoneName],
      ...(locale === "en"
        ? {
            title: "Walk coming up ⏰",
            body: `${v.dogName}'s walk starts at ${time} in ${v.zoneName}. Tap "On my way" when you leave.`,
          }
        : {
            title: "Se viene un paseo ⏰",
            body: `El paseo de ${v.dogName} empieza a las ${time} en ${v.zoneName}. Toca "Voy en camino" cuando salgas.`,
          }),
    };
  },

  walk_sos: (v, { locale, appUrl }) => ({
    type: "WALK",
    link: "walk-live",
    pushUrl: `/?walk=${encodeURIComponent(v.walkId)}`,
    waTemplate: "firuwalk_walk_sos",
    waParams: [firstName(v.walkerName), v.dogName, walkLink(appUrl, v.walkId)],
    ...(locale === "en"
      ? {
          title: "Alert during the walk 🚨",
          body: `${v.walkerName} pressed SOS during ${v.dogName}'s walk. Our ops team is already on it and will contact you. Follow the live location on the map.`,
        }
      : {
          title: "Alerta durante el paseo 🚨",
          body: `${v.walkerName} activó el SOS durante el paseo de ${v.dogName}. Nuestro equipo ya está atendiendo y te contactará. Sigue la ubicación en vivo en el mapa.`,
        }),
  }),

  walk_late: (v, { locale }) => ({
    type: "WALK",
    link: "bookings",
    waTemplate: "firuwalk_walk_late",
    waParams: [v.dogName, firstName(v.walkerName), String(v.minutesLate)],
    ...(locale === "en"
      ? {
          title: "Your walker is running late ⏱️",
          body: `${v.dogName}'s walk hasn't started yet (${v.minutesLate} min late). We're contacting ${v.walkerName} and looking for a backup walker. We'll keep you posted.`,
        }
      : {
          title: "Tu paseador viene con retraso ⏱️",
          body: `El paseo de ${v.dogName} aún no empezó (${v.minutesLate} min de retraso). Estamos contactando a ${v.walkerName} y buscando un paseador de respaldo. Te avisamos enseguida.`,
        }),
  }),

  backup_offer: (v, { locale }) => {
    const time = boTime(v.startsAt);
    return {
      type: "WALK",
      link: "home",
      waTemplate: "firuwalk_backup_offer",
      waParams: [v.dogName, v.zoneName, time, String(v.minutesToAccept)],
      ...(locale === "en"
        ? {
            title: "Urgent backup walk 🆘",
            body: `${v.dogName} needs a walker now in ${v.zoneName} (${time}, ${v.durationMin} min). Take it in the next ${v.minutesToAccept} minutes from your home screen.`,
          }
        : {
            title: "Paseo de respaldo urgente 🆘",
            body: `${v.dogName} necesita paseador ahora en ${v.zoneName} (${time}, ${v.durationMin} min). Tómalo en los próximos ${v.minutesToAccept} minutos desde tu inicio.`,
          }),
    };
  },

  walk_reassigned: (v, { locale }) => ({
    type: "WALK",
    link: "bookings",
    waTemplate: "firuwalk_walk_reassigned",
    waParams: [firstName(v.walkerName), v.dogName],
    ...(locale === "en"
      ? {
          title: "Backup walker on the way ✅",
          body: `${v.walkerName}, a verified FiruWalk walker, is taking ${v.dogName}'s walk today. Same guarantee, same live tracking.`,
        }
      : {
          title: "Paseador de respaldo en camino ✅",
          body: `${v.walkerName}, paseador verificado de FiruWalk, hará hoy el paseo de ${v.dogName}. Misma garantía y seguimiento en vivo.`,
        }),
  }),

  backup_none: (v, { locale }) => ({
    type: "WALK",
    link: "bookings",
    waTemplate: "firuwalk_backup_none",
    waParams: [v.dogName],
    ...(locale === "en"
      ? {
          title: "We couldn't find a backup 😔",
          body: `No backup walker was free for ${v.dogName}'s walk. Our team will contact you to reschedule or credit the walk.`,
        }
      : {
          title: "No encontramos respaldo 😔",
          body: `Ningún paseador de respaldo estaba libre para el paseo de ${v.dogName}. Nuestro equipo te contactará para reprogramar o acreditarte el paseo.`,
        }),
  }),
};

export function renderTemplate<K extends TemplateKey>(
  key: K,
  vars: TemplateVars[K],
  ctx: RenderCtx
): Rendered {
  return (RENDERERS[key] as Renderer<K>)(vars, ctx);
}
