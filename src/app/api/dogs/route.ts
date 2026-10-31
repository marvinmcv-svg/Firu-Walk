// GET  /api/dogs → DogDTO[] (owner's dogs; walker/admin may pass ?ownerId=)
// POST /api/dogs {name,breed,size,ageYears,temperament,notes?,tags?,photoUrl?,vetPhone?}

import { db } from "@/lib/db";
import {
  ApiError,
  ok,
  oneOf,
  optStr,
  readJson,
  reqNum,
  reqStr,
  run,
} from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { dogOf } from "@/lib/server/serialize";

export async function GET(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    const ownerId = new URL(req.url).searchParams.get("ownerId");

    let targetOwnerId: string;
    if (user.role === "OWNER") {
      targetOwnerId = user.id;
    } else {
      if (!ownerId) {
        throw new ApiError(400, "Indica el dueño con ?ownerId= para ver sus mascotas.");
      }
      targetOwnerId = ownerId;
      // Walkers only see dogs of owners who booked (or asked) them.
      if (user.role === "WALKER") {
        const related = await db.booking.findFirst({
          where: {
            ownerId: targetOwnerId,
            OR: [{ walkerId: user.id }, { candidatesJson: { contains: `"${user.id}"` } }],
          },
          select: { id: true },
        });
        if (!related) throw new ApiError(403, "No tienes acceso a las mascotas de este dueño.");
      }
    }

    const dogs = await db.dog.findMany({ where: { ownerId: targetOwnerId } });
    return ok(dogs.map(dogOf));
  });
}

export async function POST(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    if (user.role !== "OWNER") {
      throw new ApiError(403, "Solo los dueños pueden registrar mascotas.");
    }

    const body = await readJson(req);
    const name = reqStr(body, "name", "El nombre de la mascota", { max: 40 });
    const breed = reqStr(body, "breed", "La raza", { max: 60 });
    const size = oneOf(body.size, ["S", "M", "L"] as const, "El tamaño");
    const temperament = oneOf(
      body.temperament,
      ["CALM", "ENERGETIC", "ANXIOUS"] as const,
      "El temperamento"
    );
    const ageYears = reqNum(body, "ageYears", "La edad", { min: 0, max: 30 });
    const notes = optStr(body, "notes", { max: 500 }) ?? null;
    const photoUrl = optStr(body, "photoUrl", { max: 300 }) ?? null;
    const vetPhone = optStr(body, "vetPhone", { max: 20 }) ?? null;

    const rawTags = body.tags;
    const tags = Array.isArray(rawTags)
      ? rawTags.filter((t): t is string => typeof t === "string").slice(0, 8)
      : [];

    const dog = await db.dog.create({
      data: {
        ownerId: user.id,
        name,
        breed,
        size,
        ageYears,
        temperament,
        notes,
        photoUrl,
        vetPhone,
        tagsJson: JSON.stringify(tags),
      },
    });
    return ok(dogOf(dog), { status: 201 });
  });
}
