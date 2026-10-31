// GET /api/auth/demo-accounts → DemoAccountDTO[]
// Lists the seeded demo users with a friendly subtitle per role.
// DEMO MODE ONLY — 404 otherwise.

import { db } from "@/lib/db";
import { ApiError, ok, run } from "@/lib/server/http";
import { DEMO_PHONE_PREFIX, isDemoMode } from "@/lib/server/auth/demo";
import type { DemoAccountDTO } from "@/lib/firu/types";

export async function GET() {
  return run(async () => {
    if (!isDemoMode()) throw new ApiError(404, "No encontrado.");
    const users = await db.user.findMany({
      where: { phone: { startsWith: DEMO_PHONE_PREFIX } },
      include: { walker: { include: { zone: true } }, zone: true, dogs: true },
    });

    // owners first, then walkers, then admin (login screen reading order)
    const roleRank: Record<string, number> = { OWNER: 0, WALKER: 1, ADMIN: 2 };
    users.sort(
      (a, b) =>
        (roleRank[a.role] ?? 9) - (roleRank[b.role] ?? 9) || a.phone.localeCompare(b.phone)
    );

    const out: DemoAccountDTO[] = [];
    for (const u of users) {
      // gender for the subtitle noun — based on the FIRST name (not surname)
      const firstName = u.name.split(" ")[0] ?? u.name;
      const female = firstName.endsWith("a");
      let subtitle: string;
      if (u.role === "ADMIN") {
        subtitle = "Panel de operaciones";
      } else if (u.role === "WALKER" && u.walker) {
        const zoneName = u.walker.zone?.name ?? u.zone?.name ?? "";
        const noun = female ? "Paseadora" : "Paseador";
        subtitle =
          u.walker.status === "ACTIVE"
            ? `${noun} verificado · ${zoneName}`
            : `Solicitud en revisión · ${zoneName}`;
      } else {
        const dog = u.dogs[0]?.name;
        subtitle = dog
          ? `${female ? "Propietaria" : "Propietario"} de ${dog}`
          : female
            ? "Propietaria"
            : "Propietario";
      }
      out.push({
        id: u.id,
        name: u.name,
        role: u.role as DemoAccountDTO["role"],
        phone: u.phone,
        avatarUrl: u.avatarUrl,
        subtitle,
      });
    }
    return ok(out);
  });
}
