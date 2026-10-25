// PATCH  /api/dogs/[id] (owner only, own dog)
// DELETE /api/dogs/[id] (owner only, own dog)

import { db } from "@/lib/db";
import {
  ApiError,
  ok,
  oneOf,
  optNum,
  optStr,
  readJson,
  run,
} from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { dogOf } from "@/lib/server/serialize";

async function ownDog(req: Request, id: string) {
  const user = await requireUser(req);
  if (user.role !== "OWNER") {
    throw new ApiError(403, "Solo el dueño puede modificar la mascota.");
  }
  const dog = await db.dog.findUnique({ where: { id } });
  if (!dog) throw new ApiError(404, "La mascota no existe.");
  if (dog.ownerId !== user.id) throw new ApiError(403, "Esta mascota no es tuya.");
  return { user, dog };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const { dog } = await ownDog(req, id);
    const body = await readJson(req);

    const data: Record<string, unknown> = {};
    const name = optStr(body, "name", { max: 40 });
    if (name !== undefined) data.name = name;
    const breed = optStr(body, "breed", { max: 60 });
    if (breed !== undefined) data.breed = breed;
    if (body.size !== undefined) data.size = oneOf(body.size, ["S", "M", "L"] as const, "El tamaño");
    if (body.temperament !== undefined) {
      data.temperament = oneOf(
        body.temperament,
        ["CALM", "ENERGETIC", "ANXIOUS"] as const,
        "El temperamento"
      );
    }
    const ageYears = optNum(body, "ageYears");
    if (ageYears !== undefined) {
      if (ageYears < 0 || ageYears > 30) throw new ApiError(400, "La edad es inválida.");
      data.ageYears = ageYears;
    }
    const notes = optStr(body, "notes", { max: 500 });
    if (notes !== undefined) data.notes = notes || null;
    const photoUrl = optStr(body, "photoUrl", { max: 300 });
    if (photoUrl !== undefined) data.photoUrl = photoUrl || null;
    const vetPhone = optStr(body, "vetPhone", { max: 20 });
    if (vetPhone !== undefined) data.vetPhone = vetPhone || null;
    if (Array.isArray(body.tags)) {
      data.tagsJson = JSON.stringify(
        body.tags.filter((t): t is string => typeof t === "string").slice(0, 8)
      );
    }

    if (Object.keys(data).length === 0) throw new ApiError(400, "Nada que actualizar.");

    const updated = await db.dog.update({ where: { id: dog.id }, data });
    return ok(dogOf(updated));
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const { dog } = await ownDog(req, id);
    // Guard: block delete when the dog still has active bookings.
    const active = await db.booking.count({
      where: { dogId: dog.id, status: { in: ["REQUESTED", "CONFIRMED"] } },
    });
    if (active > 0) {
      throw new ApiError(
        400,
        "Esta mascota tiene reservas activas. Cancéalas antes de eliminar el perfil."
      );
    }
    await db.dog.delete({ where: { id: dog.id } });
    return ok({ ok: true });
  });
}
