// PATCH  /api/admin/vets/[id] {…partial} → VetDTO
// DELETE /api/admin/vets/[id]

import { db } from "@/lib/db";
import { ApiError, ok, readJson, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { vetOf } from "@/lib/server/safety/vets";
import { VetInput } from "../schema";

async function load(id: string) {
  const vet = await db.vet.findUnique({ where: { id } });
  if (!vet) throw new ApiError(404, "Veterinaria no encontrada.");
  return vet;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const admin = await requireAdmin(req);
    await load(id);
    const parsed = VetInput.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Datos de la veterinaria inválidos.");
    const vet = await db.vet.update({ where: { id }, data: parsed.data });
    await db.auditLog.create({
      data: { actorId: admin.id, action: "VET_UPDATED", entity: "vet", entityId: id, detail: JSON.stringify(parsed.data) },
    });
    return ok(vetOf(vet));
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const admin = await requireAdmin(req);
    const vet = await load(id);
    await db.vet.delete({ where: { id } });
    await db.auditLog.create({
      data: { actorId: admin.id, action: "VET_DELETED", entity: "vet", entityId: id, detail: vet.name },
    });
    return ok({ ok: true });
  });
}
