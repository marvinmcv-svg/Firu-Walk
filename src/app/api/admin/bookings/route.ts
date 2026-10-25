// GET /api/admin/bookings?status= → BookingDTO[] (all, newest first)

import { db } from "@/lib/db";
import { ok, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { bookingInclude, bookingList } from "@/lib/server/serialize";
import { sweepExpiredRequests } from "@/lib/server/bookingEngine";

export async function GET(req: Request) {
  return run(async () => {
    await requireAdmin(req);
    const status = new URL(req.url).searchParams.get("status");

    // keep accept-window state fresh for the ops view too
    await sweepExpiredRequests();

    const bookings = await db.booking.findMany({
      where: status ? { status } : {},
      include: bookingInclude,
      orderBy: { requestedAt: "desc" },
    });
    return ok(await bookingList(bookings));
  });
}
