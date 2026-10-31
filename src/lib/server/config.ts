// Config service — all business tunables live in the Config table.
// getAppConfig() merges DB rows over sane defaults so the app never crashes
// on a missing key.

import { db } from "@/lib/db";
import type { AppConfig } from "@/lib/firu/types";

export const CONFIG_SECTIONS = ["platform", "fees", "pricing", "policy", "demo", "payouts", "tracking"] as const;
export type ConfigSection = (typeof CONFIG_SECTIONS)[number];

/** Whitelisted keys per section (admin PATCH only touches these). */
export const CONFIG_WHITELIST: Record<ConfigSection, string[]> = {
  platform: ["name", "city", "supportWhatsApp", "guaranteeText"],
  fees: ["commissionPct", "ownerFeePct", "tipPassThroughPct"],
  pricing: ["price30Cents", "price45Cents", "price60Cents"],
  policy: [
    "cancellationFreeHours",
    "lateCancelWalkerSharePct",
    "acceptTimeoutMinutes",
    "trialWalks",
    "noShowCreditCents",
  ],
  demo: ["otpCode", "acceptTimeoutSeconds"],
  payouts: ["cycle", "minPayoutCents"],
  tracking: ["geofenceMeters", "maxSpeedKmh", "maxJumpMeters", "maxAccuracyMeters"],
};

export const DEFAULT_CONFIG: AppConfig = {
  platform: {
    name: "FiruWalk",
    city: "Santa Cruz de la Sierra",
    supportWhatsApp: "+59177165787",
    guaranteeText:
      "Garantía FiruWalk: si tu paseador cancela, encontramos un respaldo o te acreditamos el paseo.",
  },
  fees: { commissionPct: 12, ownerFeePct: 0, tipPassThroughPct: 100 },
  pricing: { price30Cents: 1500, price45Cents: 2000, price60Cents: 2500 },
  policy: {
    cancellationFreeHours: 12,
    lateCancelWalkerSharePct: 50,
    acceptTimeoutMinutes: 5,
    trialWalks: 5,
    noShowCreditCents: 1000,
  },
  demo: { otpCode: "123456", acceptTimeoutSeconds: 90 },
  payouts: { cycle: "weekly", minPayoutCents: 2000 },
  tracking: { geofenceMeters: 150, maxSpeedKmh: 25, maxJumpMeters: 1000, maxAccuracyMeters: 100 },
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Read all Config rows merged over defaults. */
export async function getAppConfig(): Promise<AppConfig> {
  const rows = await db.config.findMany();
  const merged: AppConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  for (const row of rows) {
    if (!CONFIG_SECTIONS.includes(row.key as ConfigSection)) continue;
    let value: unknown;
    try {
      value = JSON.parse(row.valueJson);
    } catch {
      continue;
    }
    if (!isRecord(value)) continue;
    const section = row.key as ConfigSection;
    merged[section] = { ...merged[section], ...(value as object) } as never;
  }
  return merged;
}

/**
 * Shallow-merge `patch` into a config section and persist.
 * Keys are pre-validated by the caller (admin route); anything not
 * whitelisted here is dropped silently to be extra safe.
 */
export async function updateConfigSection(
  key: ConfigSection,
  patch: Record<string, unknown>
): Promise<void> {
  const allowed = new Set(CONFIG_WHITELIST[key]);
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (allowed.has(k) && v !== undefined) clean[k] = v;
  }
  if (Object.keys(clean).length === 0) return;

  const current = await getAppConfig();
  const next = { ...(current[key] as Record<string, unknown>), ...clean };

  const existing = await db.config.findUnique({ where: { key } });
  if (existing) {
    await db.config.update({ where: { key }, data: { valueJson: JSON.stringify(next) } });
  } else {
    await db.config.create({ data: { key, valueJson: JSON.stringify(next) } });
  }
}
