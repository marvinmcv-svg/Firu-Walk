// GET /api/auth/demo-accounts → DemoAccountDTO[]
// Lists the seeded demo users with a friendly subtitle per role.

import { db } from "@/lib/db";
import { ok, run } from "@/lib/server/http";
import type { DemoAccountDTO } from "@/lib/firu/types";

/** Seeded demo phones live in the +591 7000 00xx range. */
const SEEDED_PREFIX = "+59170000";

export async function GET() {
  return run(async () => {
    const users = await db.user.findMany({
      where: { phone: { startsWith: SEEDED_PREFIX } },
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
