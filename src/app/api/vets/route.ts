// GET /api/vets?lat=&lng= → nearest active vets (signed-in users).

import { z } from "zod";
import { ok, run } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { nearestVets } from "@/lib/server/safety/vets";

const Pos = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) });

export async function GET(req: Request) {
  return run(async () => {
    await requireUser(req);
    const sp = new URL(req.url).searchParams;
    const pos = Pos.safeParse({ lat: sp.get("lat") ?? undefined, lng: sp.get("lng") ?? undefined });
    return ok(await nearestVets(pos.success ? pos.data : null, 10));
  });
}
