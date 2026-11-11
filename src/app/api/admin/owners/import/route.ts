// POST /api/admin/owners/import {rows, dryRun?} → OwnerImportResultDTO
// Phase 2 soft launch: move the Phase-0 (concierge / WhatsApp) customers onto
// the app. Creates OWNER accounts (and their dogs) that sign in later with
// their phone via OTP; they accept the Terms on first sign-in. Phones that
// already have an account are skipped. dryRun validates without writing.
// Each created row returns a wa.me invite link for ops to send by hand.

import { z } from "zod";
import { db } from "@/lib/db";
import type { OwnerImportResultDTO, OwnerImportRowResult } from "@/lib/firu/types";
import { normalizePhone } from "@/lib/server/auth/phone";
import { getAppConfig } from "@/lib/server/config";
import { ApiError, ok, readJson, run } from "@/lib/server/http";
import { normalizeChannel } from "@/lib/server/referrals";
import { requireAdmin } from "@/lib/server/session";

const DogInput = z.object({
  name: z.string().trim().min(1).max(40),
  breed: z.string().trim().max(60).optional().default(""),
  size: z.enum(["S", "M", "L"]).optional().default("M"),
  ageYears: z.number().min(0).max(30).optional().default(3),
  temperament: z.enum(["CALM", "ENERGETIC", "ANXIOUS"]).optional().default("CALM"),
  notes: z.string().trim().max(500).optional(),
});

const RowInput = z.object({
  name: z.string().trim().min(2, "Falta el nombre.").max(80),
  phone: z.string().trim().min(6, "Falta el teléfono.").max(30),
  zone: z.string().trim().max(60).optional(),
  addressNote: z.string().trim().max(200).optional(),
  channel: z.string().trim().max(30).optional(),
  dogs: z.array(DogInput).max(10).optional().default([]),
});

const Body = z.object({
  rows: z.array(z.unknown()).min(1, "No hay filas para importar.").max(500, "Máximo 500 filas por importación."),
  dryRun: z.boolean().optional().default(false),
});

function baseUrl(req: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  return new URL(req.url).origin;
}

/** Folded, lower-case text for matching zone names typed by ops. */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export async function POST(req: Request) {
  return run(async () => {
    const admin = await requireAdmin(req);
    const parsed = Body.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Datos de importación inválidos.");
    const { rows, dryRun } = parsed.data;

    const [zones, cfg] = await Promise.all([db.zone.findMany(), getAppConfig()]);
    const zoneByText = new Map<string, string>();
    for (const z of zones) {
      zoneByText.set(fold(z.key), z.id);
      zoneByText.set(fold(z.name), z.id);
    }

    // Validate every row first; merge rows of the same phone (one dog per CSV line).
    const results: OwnerImportRowResult[] = [];
    const valid = new Map<string, { row: z.infer<typeof RowInput>; zoneId: string | null; index: number }>();
    rows.forEach((raw, index) => {
      const r = RowInput.safeParse(raw);
      const fallbackPhone = typeof (raw as { phone?: unknown })?.phone === "string" ? (raw as { phone: string }).phone : "";
      if (!r.success) {
        results.push({ index, phone: fallbackPhone, name: "", status: "error", reason: r.error.issues[0]?.message ?? "Fila inválida.", dogs: 0 });
        return;
      }
      const phone = normalizePhone(r.data.phone);
      if (!/^\+\d{8,15}$/.test(phone)) {
        results.push({ index, phone: r.data.phone, name: r.data.name, status: "error", reason: "Teléfono inválido (usa +5917xxxxxxx).", dogs: 0 });
        return;
      }
      let zoneId: string | null = null;
      if (r.data.zone) {
        zoneId = zoneByText.get(fold(r.data.zone)) ?? null;
        if (!zoneId) {
          results.push({ index, phone, name: r.data.name, status: "error", reason: `Zona desconocida: «${r.data.zone}».`, dogs: 0 });
          return;
        }
      }
      const prev = valid.get(phone);
      if (prev) {
        prev.row.dogs.push(...r.data.dogs);
        prev.zoneId ??= zoneId;
        prev.row.addressNote ??= r.data.addressNote;
        return;
      }
      valid.set(phone, { row: { ...r.data, phone, dogs: [...r.data.dogs] }, zoneId, index });
    });

    const existing = new Set(
      (await db.user.findMany({ where: { phone: { in: [...valid.keys()] } }, select: { phone: true } })).map((u) => u.phone)
    );
    const appUrl = baseUrl(req);
    const now = new Date();
    let created = 0;

    for (const [phone, { row, zoneId, index }] of valid) {
      if (existing.has(phone)) {
        results.push({ index, phone, name: row.name, status: "exists", reason: "Ya tiene cuenta.", dogs: row.dogs.length });
        continue;
      }
      const first = row.name.split(" ")[0];
      const invite = `¡Hola ${first}! 🐾 Ya puedes reservar los paseos de ${
        row.dogs[0]?.name ?? "tu perrito"
      } en la app de ${cfg.platform.name}: ${appUrl} — entra con este número de teléfono (${phone}) y te llega un código por WhatsApp.`;
      const inviteUrl = `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(invite)}`;
      if (!dryRun) {
        try {
          await db.user.create({
            data: {
              phone,
              name: row.name,
              role: "OWNER",
              zoneId,
              addressNote: row.addressNote ?? null,
              acquisitionChannel: normalizeChannel(row.channel) ?? "concierge",
              importedAt: now,
              dogs: {
                create: row.dogs.map((d) => ({
                  name: d.name,
                  breed: d.breed || "Mestizo",
                  size: d.size,
                  ageYears: d.ageYears,
                  temperament: d.temperament,
                  notes: d.notes ?? null,
                })),
              },
            },
          });
        } catch (err) {
          if ((err as { code?: string }).code === "P2002") {
            results.push({ index, phone, name: row.name, status: "exists", reason: "Ya tiene cuenta.", dogs: row.dogs.length });
            continue;
          }
          throw err;
        }
        created++;
      }
      results.push({ index, phone, name: row.name, status: dryRun ? "ready" : "created", dogs: row.dogs.length, inviteUrl });
    }

    if (!dryRun && created > 0) {
      await db.auditLog.create({
        data: {
          actorId: admin.id,
          action: "OWNERS_IMPORTED",
          entity: "user",
          entityId: "import",
          detail: JSON.stringify({ created, rows: rows.length }),
        },
      });
    }
    results.sort((a, b) => a.index - b.index);
    const dto: OwnerImportResultDTO = {
      dryRun,
      created,
      ready: results.filter((r) => r.status === "ready").length,
      exists: results.filter((r) => r.status === "exists").length,
      errors: results.filter((r) => r.status === "error").length,
      rows: results,
    };
    return ok(dto);
  });
}
