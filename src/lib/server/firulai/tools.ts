// FirulAI tools (Milestone 9). All read-only: they look up live prices and
// zones, build a booking deep link, or hand off to WhatsApp. There is no tool
// that creates bookings or touches payments — the visitor finishes booking
// and pays inside the app.

import { z } from "zod";
import type { AppConfig } from "@/lib/firu/types";
import { priceBreakdown } from "@/lib/firu/money";
import type { LlmToolDef, LlmToolOutcome } from "../llm/types";

export interface ZoneRow {
  key: string;
  name: string;
  /** City name. */
  city: string;
}

/** A launched city: its base prices and walk lengths. */
export interface CityRow {
  key: string;
  name: string;
  price30Cents: number;
  price45Cents: number;
  price60Cents: number;
  durations: number[];
}

export interface PlanRow {
  name: string;
  walks: number;
  durationMin: number;
  priceCents: number;
}

/** Buttons the chat shows under the reply. */
export type FirulaiAction =
  | { type: "booking"; url: string; zoneKey: string | null; durationMin: number | null }
  | { type: "whatsapp"; url: string };

export interface ToolContext {
  cfg: AppConfig;
  zones: ZoneRow[];
  cities: CityRow[];
  plans: PlanRow[];
  appUrl: string;
  lang: "es" | "en";
  /** Filled while tools run. */
  actions: FirulaiAction[];
}

export const TOOL_DEFS: LlmToolDef[] = [
  {
    name: "check_price",
    description:
      "Current FiruWalk prices in Bolivianos: price per walk for 30/45/60 minutes (service fee included) in each city, and the monthly plans. Call it before quoting any price.",
    input_schema: {
      type: "object",
      properties: {
        durationMin: { type: "integer", enum: [30, 45, 60], description: "Walk length the visitor asked about, if any." },
        city: { type: "string", description: "City the visitor asked about, if any (e.g. Santa Cruz, La Paz)." },
      },
    },
  },
  {
    name: "check_zone_coverage",
    description:
      "Check whether FiruWalk has walkers in a neighborhood or zone of one of its cities. Returns the matching zone and its city (if any) and the list of covered zones.",
    input_schema: {
      type: "object",
      properties: {
        place: { type: "string", description: "Neighborhood, zone, street or landmark the visitor mentioned." },
      },
      required: ["place"],
    },
  },
  {
    name: "start_booking",
    description:
      "Create a link that opens the FiruWalk booking flow, optionally pre-filled with a zone and walk length. Use it when the visitor wants to book. It does not book or charge anything: the visitor completes the booking and payment in the app.",
    input_schema: {
      type: "object",
      properties: {
        zoneKey: { type: "string", description: "Zone key from check_zone_coverage, if known." },
        durationMin: { type: "integer", enum: [30, 45, 60] },
      },
    },
  },
  {
    name: "contact_human",
    description:
      "Hand the visitor over to the FiruWalk human team on WhatsApp. Use it when they ask for a person, have a complaint, an emergency, a payment or account problem, or anything outside your data.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "One short line for the team about what the visitor needs." },
      },
      required: ["reason"],
    },
  },
];

const Duration = z.union([z.literal(30), z.literal(45), z.literal(60)]);
const PriceInput = z.object({ durationMin: Duration.optional(), city: z.string().trim().max(80).optional() }).passthrough();
const ZoneInput = z.object({ place: z.string().trim().min(1).max(200) }).passthrough();
const BookingInput = z
  .object({ zoneKey: z.string().trim().max(60).optional(), durationMin: Duration.optional() })
  .passthrough();
const HumanInput = z.object({ reason: z.string().trim().max(300).optional() }).passthrough();

/** "Equipetrol" / "equipétrol " → "equipetrol" (accents and case ignored). */
export function normalizePlace(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function bs(cents: number): string {
  const v = cents / 100;
  return `Bs ${Number.isInteger(v) ? v : v.toFixed(2)}`;
}

export function whatsappLink(phone: string, text: string): string {
  return `https://wa.me/${phone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(text)}`;
}

export function bookingLink(appUrl: string, zoneKey: string | null, durationMin: number | null): string {
  const q = new URLSearchParams({ book: "1" });
  if (zoneKey) q.set("zone", zoneKey);
  if (durationMin) q.set("duration", String(durationMin));
  return `${appUrl.replace(/\/$/, "")}/?${q.toString()}`;
}

const ok = (data: unknown): LlmToolOutcome => ({ content: JSON.stringify(data) });
const bad = (message: string): LlmToolOutcome => ({ content: JSON.stringify({ error: message }), isError: true });

export async function runFirulaiTool(name: string, raw: unknown, ctx: ToolContext): Promise<LlmToolOutcome> {
  const { cfg } = ctx;
  switch (name) {
    case "check_price": {
      const input = PriceInput.safeParse(raw ?? {});
      if (!input.success) return bad("durationMin must be 30, 45 or 60");
      const fee = cfg.fees.ownerFeePct;
      const per = (c: number) => bs(priceBreakdown(c, fee).totalCents);
      const priced = (c: CityRow) =>
        Object.fromEntries(
          c.durations.map((d) => [String(d), per(d === 30 ? c.price30Cents : d === 45 ? c.price45Cents : c.price60Cents)])
        );
      const wanted = input.data.city ? normalizePlace(input.data.city) : "";
      const city =
        (wanted &&
          ctx.cities.find((c) => {
            const n = normalizePlace(c.name);
            const k = normalizePlace(c.key.replace(/-/g, " "));
            return n.includes(wanted) || wanted.includes(n) || wanted.includes(k);
          })) ||
        ctx.cities[0];
      return ok({
        currency: "BOB",
        city: city?.name ?? cfg.platform.city,
        perWalk: city
          ? priced(city)
          : { "30": per(cfg.pricing.price30Cents), "45": per(cfg.pricing.price45Cents), "60": per(cfg.pricing.price60Cents) },
        ...(ctx.cities.length > 1 ? { byCity: ctx.cities.map((c) => ({ city: c.name, perWalk: priced(c) })) } : {}),
        asked: input.data.durationMin ?? null,
        serviceFeeIncluded: fee > 0 ? `${fee}%` : "none",
        note: "Walkers may set their own price within these bands; the booking shows the exact total before paying.",
        monthlyPlans: ctx.plans.map((p) => ({
          name: p.name,
          walks: p.walks,
          minutesPerWalk: p.durationMin,
          price: bs(priceBreakdown(p.priceCents, fee).totalCents),
        })),
        tipsGoToWalker: `${cfg.fees.tipPassThroughPct}%`,
      });
    }

    case "check_zone_coverage": {
      const input = ZoneInput.safeParse(raw);
      if (!input.success) return bad("place is required");
      const place = normalizePlace(input.data.place);
      const match = ctx.zones.find((z) => {
        const n = normalizePlace(z.name);
        const k = normalizePlace(z.key);
        return (n.length > 2 && place.includes(n)) || (k.length > 2 && place.includes(k)) || (place.length > 3 && n.includes(place));
      });
      return ok({
        covered: !!match,
        zone: match ? { key: match.key, name: match.name, city: match.city } : null,
        coveredZones: ctx.zones.map((z) => `${z.name} (${z.city})`),
        cities: ctx.cities.map((c) => c.name),
        note: match
          ? "This zone has FiruWalk walkers."
          : "No exact match. The place may still be inside one of the covered zones: ask which zone it is in, or offer WhatsApp to confirm. Never claim coverage you cannot see here.",
      });
    }

    case "start_booking": {
      const input = BookingInput.safeParse(raw ?? {});
      if (!input.success) return bad("invalid booking input");
      const key = input.data.zoneKey ?? null;
      const zone = key ? ctx.zones.find((z) => z.key === key || normalizePlace(z.name) === normalizePlace(key)) : null;
      const duration = input.data.durationMin ?? null;
      const url = bookingLink(ctx.appUrl, zone?.key ?? null, duration);
      ctx.actions.push({ type: "booking", url, zoneKey: zone?.key ?? null, durationMin: duration });
      return ok({
        url,
        zone: zone?.name ?? null,
        durationMin: duration,
        shownToVisitor: "A 'Book now' button is shown under your reply.",
        note: "Nothing is booked or charged yet. The visitor picks the dog, day and time, sees the walker and the total, and pays inside the app.",
      });
    }

    case "contact_human": {
      const input = HumanInput.safeParse(raw ?? {});
      const reason = input.success ? (input.data.reason ?? "") : "";
      const text =
        ctx.lang === "en"
          ? `Hi FiruWalk 🐾 I'm coming from the FirulAI chat.${reason ? ` ${reason}` : ""}`
          : `Hola FiruWalk 🐾 Vengo del chat de FirulAI.${reason ? ` ${reason}` : ""}`;
      const url = whatsappLink(cfg.platform.supportWhatsApp, text.slice(0, 400));
      if (!ctx.actions.some((a) => a.type === "whatsapp")) ctx.actions.push({ type: "whatsapp", url });
      return ok({ url, shownToVisitor: "A WhatsApp button is shown under your reply." });
    }

    default:
      return bad(`unknown tool ${name}`);
  }
}
