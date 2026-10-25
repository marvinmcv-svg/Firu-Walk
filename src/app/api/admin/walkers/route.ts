// GET /api/admin/walkers?status= → WalkerProfileDTO[] joined with user
// (ALL statuses; PENDING first). Extras: name/phone/avatar for the queue UI.

import { db } from "@/lib/db";
import { ok, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { walkerProfileOf } from "@/lib/server/serialize";

const STATUS_RANK: Record<string, number> = { PENDING: 0, ACTIVE: 1, SUSPENDED: 2, REJECTED: 3 };

export async function GET(req: Request) {
  return run(async () => {
    await requireAdmin(req);
    const status = new URL(req.url).searchParams.get("status");

    const profiles = await db.walkerProfile.findMany({
      where: status ? { status } : {},
      include: { user: true, zone: true },
    });

    const out = profiles
      .map((p) => ({
        ...walkerProfileOf(p, p.zone?.name ?? ""),
        name: p.user?.name ?? "",
        phone: p.user?.phone ?? "",
        avatarUrl: p.user?.avatarUrl ?? null,
      }))
      .sort(
        (a, b) =>
          (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) ||
          a.appliedAt.localeCompare(b.appliedAt)
      );
    return ok(out);
  });
}
