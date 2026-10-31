// PATCH /api/admin/config {section, patch} → AppConfig
// Whitelisted keys per section only; loose type check; audit log.

import { db } from "@/lib/db";
import { ApiError, ok, readJson, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { CONFIG_ENUMS, CONFIG_SECTIONS, CONFIG_WHITELIST, getAppConfig, updateConfigSection } from "@/lib/server/config";
import type { ConfigSection } from "@/lib/server/config";

/** Expected JS type per whitelisted key. */
function expectedType(section: ConfigSection, key: string): "string" | "number" {
  if (section === "platform") return "string";
  if (section === "demo") return key === "otpCode" ? "string" : "number";
  if (section === "payouts") return key === "cycle" ? "string" : "number";
  if (section === "plans") return "string";
  return "number"; // fees, pricing, policy, tracking, payments
}

export async function PATCH(req: Request) {
  return run(async () => {
    const admin = await requireAdmin(req);
    const body = await readJson(req);

    const section = typeof body.section === "string" ? body.section : "";
    if (!CONFIG_SECTIONS.includes(section as ConfigSection)) {
      throw new ApiError(
        400,
        `Sección de configuración inválida. Opciones: ${CONFIG_SECTIONS.join(", ")}.`
      );
    }
    const sec = section as ConfigSection;
    const patch = body.patch;
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
      throw new ApiError(400, "El campo patch debe ser un objeto con los valores a cambiar.");
    }

    const allowed = new Set(CONFIG_WHITELIST[sec]);
    const clean: Record<string, unknown> = {};
    const rejected: string[] = [];
    for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
      if (!allowed.has(key)) {
        rejected.push(key);
        continue;
      }
      const expected = expectedType(sec, key);
      if (expected === "number") {
        const n = typeof value === "string" ? Number(value) : value;
        if (typeof n !== "number" || !Number.isFinite(n)) {
          throw new ApiError(400, `El valor de "${key}" debe ser un número.`);
        }
        if (n < 0) throw new ApiError(400, `El valor de "${key}" no puede ser negativo.`);
        clean[key] = n;
      } else {
        if (typeof value !== "string" || !value.trim()) {
          throw new ApiError(400, `El valor de "${key}" debe ser un texto.`);
        }
        const options = CONFIG_ENUMS[`${sec}.${key}`];
        if (options && !options.includes(value.trim())) {
          throw new ApiError(400, `El valor de "${key}" debe ser: ${options.join(", ")}.`);
        }
        clean[key] = value.trim();
      }
    }

    if (Object.keys(clean).length === 0) {
      throw new ApiError(
        400,
        rejected.length
          ? `Ninguna clave es editable en "${sec}" (rechazadas: ${rejected.join(", ")}).`
          : "No hay cambios válidos que aplicar."
      );
    }

    await updateConfigSection(sec, clean);
    await db.auditLog.create({
      data: {
        actorId: admin.id,
        action: "CONFIG_UPDATED",
        entity: "config",
        entityId: sec,
        detail: JSON.stringify(clean),
      },
    });
    return ok(await getAppConfig());
  });
}
