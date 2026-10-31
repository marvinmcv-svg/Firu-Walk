// Money utilities — ALL amounts are integer centavos of Bolivianos (Bs).
// Never use floating point for stored amounts.
// Decimal/thousand separators follow the active language:
// es-BO keeps "Bs 15,00"; en renders "Bs 15.00". The "Bs" prefix is the brand.

import { getLangCore } from "./langCore";

function numLocale(): string {
  return getLangCore() === "en" ? "en-US" : "es-BO";
}

/** Format integer centavos as Bolivianian currency: 1500 → "Bs 15,00" (es) / "Bs 15.00" (en) */
export function formatBOB(cents: number, opts?: { signed?: boolean }): string {
  const abs = Math.abs(cents) / 100;
  const num = abs.toLocaleString(numLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = cents < 0 ? "-" : opts?.signed ? "+" : "";
  return `${sign}Bs ${num}`;
}

/** Short format for compact UI: 1500 → "Bs 15" (drops ,00) */
export function formatBOBShort(cents: number): string {
  if (cents % 100 === 0)
    return `${cents < 0 ? "-" : ""}Bs ${(Math.abs(cents) / 100).toLocaleString(numLocale())}`;
  return formatBOB(cents);
}

/** Rating with locale decimal: 4.8 → "4,8" (es) / "4.8" (en) */
export function fmtRating(rating: number): string {
  return rating.toFixed(1).replace(",", getLangCore() === "en" ? "." : ",");
}

/** Distance with locale decimal: 1250 m → "1,25 km" (es) / "1.25 km" (en) */
export function fmtKm(meters: number): string {
  const km = (meters / 1000).toFixed(2).replace(",", getLangCore() === "en" ? "." : ",");
  return `${km} km`;
}

/** Bs string ("15,50" or "15.5") -> centavos */
export function parseBOB(input: string): number {
  const normalized = input
    .replace(/[Bb]s\s?/g, "")
    .replace(/\s/g, "")
    .replace(",", ".");
  const value = Number.parseFloat(normalized);
  if (Number.isNaN(value)) return 0;
  return Math.round(value * 100);
}

/** Percent helpers for the configurable commission math (integer-safe) */
export function takePortion(amountCents: number, pct: number): number {
  return Math.round((amountCents * pct) / 100);
}

/**
 * Owner service fee on top of a walk/plan price (fees.ownerFeePct).
 * Shared by the server (what is charged) and the UI (breakdown before paying).
 */
export function priceBreakdown(baseCents: number, ownerFeePct: number) {
  const ownerFeeCents = takePortion(baseCents, ownerFeePct);
  return { baseCents, ownerFeeCents, totalCents: baseCents + ownerFeeCents };
}
