// GET  /api/admin/partners → PartnerDTO[] (with sign-ups, activation, walks, fees)
// POST /api/admin/partners {name, kind, code?, referralFeeCents, giftWalk, …} → PartnerDTO

import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, ok, readJson, run } from "@/lib/server/http";
import { appBaseUrl, codeTaken, partnerList, partnerOf, suggestPartnerCode } from "@/lib/server/partners";
import { normalizeCode } from "@/lib/server/referrals";
import { requireAdmin } from "@/lib/server/session";
import { PartnerInput } from "./schema";

const CreateInput = PartnerInput.extend({
  code: z.string().trim().max(20).optional(),
  giftWalk: z.boolean().optional().default(true),
  active: z.boolean().optional().default(true),
  referralFeeCents: PartnerInput.shape.referralFeeCents.optional().default(0),
});

export async function GET(req: Request) {
  return run(async () => {
    await requireAdmin(req);
    return ok(await partnerList(appBaseUrl(req)));
  });
}

export async function POST(req: Request) {
  return run(async () => {
    const admin = await requireAdmin(req);
    const parsed = CreateInput.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Datos del aliado inválidos.");
    const { code: rawCode, ...data } = parsed.data;
    let code: string;
    if (rawCode) {
      code = normalizeCode(rawCode);
      if (code.length < 4) throw new ApiError(400, "El código debe tener al menos 4 letras o números.");
      if (await codeTaken(code)) throw new ApiError(400, "Ese código ya está en uso.");
    } else {
      code = await suggestPartnerCode(data.name);
    }
    if (data.zoneId && !(await db.zone.findUnique({ where: { id: data.zoneId }, select: { id: true } }))) {
      throw new ApiError(400, "La zona no existe.");
    }
    const partner = await db.partner.create({ data: { ...data, code } });
    await db.auditLog.create({
      data: { actorId: admin.id, action: "PARTNER_CREATED", entity: "partner", entityId: partner.id, detail: JSON.stringify({ code, ...data }) },
    });
    return ok(partnerOf(partner, appBaseUrl(req)), { status: 201 });
  });
}
