// GET /api/users/me → SessionUserDTO
// PATCH /api/users/me {name?, zoneId?, addressNote?, addressLat?, addressLng?}

import { db } from "@/lib/db";
import { ApiError, ok, optNum, optStr, readJson, run } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { sessionUserOf } from "@/lib/server/serialize";

export async function GET(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    return ok(sessionUserOf(user));
  });
}

export async function PATCH(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    const body = await readJson(req);

    const data: Record<string, unknown> = {};

    const name = optStr(body, "name", { max: 80 });
    if (name !== undefined) data.name = name;

    const zoneId = optStr(body, "zoneId");
    if (zoneId !== undefined) {
      const zone = await db.zone.findUnique({ where: { id: zoneId } });
      if (!zone || !zone.active) throw new ApiError(400, "La zona seleccionada no existe.");
      data.zoneId = zoneId;
    }

    const addressNote = optStr(body, "addressNote", { max: 300 });
    if (addressNote !== undefined) data.addressNote = addressNote;

    const addressLat = optNum(body, "addressLat");
    if (addressLat !== undefined) {
      if (addressLat < -90 || addressLat > 90) throw new ApiError(400, "Latitud inválida.");
      data.addressLat = addressLat;
    }
    const addressLng = optNum(body, "addressLng");
    if (addressLng !== undefined) {
      if (addressLng < -180 || addressLng > 180) throw new ApiError(400, "Longitud inválida.");
      data.addressLng = addressLng;
    }

    if (Object.keys(data).length === 0) {
      throw new ApiError(400, "Nada que actualizar.");
    }

    const updated = await db.user.update({
      where: { id: user.id },
      data,
      include: { walker: true, zone: true },
    });
    return ok(sessionUserOf(updated));
  });
}
