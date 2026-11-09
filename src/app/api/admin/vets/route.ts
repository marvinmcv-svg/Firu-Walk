// GET  /api/admin/vets → VetDTO[] (all, including inactive)
// POST /api/admin/vets {name, phone, address, lat, lng, open24h?, notes?} → VetDTO

import { db } from "@/lib/db";
import { ApiError, ok, readJson, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { vetOf } from "@/lib/server/safety/vets";
import { VetInput } from "./schema";

export async function GET(req: Request) {
  return run(async () => {
    await requireAdmin(req);
    const vets = await db.vet.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });
    return ok(vets.map((v) => vetOf(v)));
  });
}

export async function POST(req: Request) {
  return run(async () => {
    const admin = await requireAdmin(req);
    const parsed = VetInput.required({ name: true, phone: true, address: true, lat: true, lng: true }).safeParse(
      await readJson(req)
    );
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Datos de la veterinaria inválidos.");
    const vet = await db.vet.create({ data: parsed.data });
    await db.auditLog.create({
      data: { actorId: admin.id, action: "VET_CREATED", entity: "vet", entityId: vet.id, detail: JSON.stringify(parsed.data) },
    });
    return ok(vetOf(vet), { status: 201 });
  });
}
