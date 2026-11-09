// GET /api/admin/bookings?status= → BookingDTO[] (all, newest first)

import { db } from "@/lib/db";
import { BookingStatus } from "@prisma/client";
import { ok, oneOf, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { bookingInclude, bookingList, withPhones } from "@/lib/server/serialize";
import { kickMinuteJobsIfStale } from "@/lib/server/jobs";

export async function GET(req: Request) {
  return run(async () => {
    await requireAdmin(req);
    const status = new URL(req.url).searchParams.get("status");

    // Accept windows are swept by the minute job; nudge it if no scheduler ran.
    kickMinuteJobsIfStale();

    const bookings = await db.booking.findMany({
      where: status
        ? { status: oneOf(status, Object.values(BookingStatus), "El estado") }
        : {},
      include: bookingInclude,
      orderBy: { requestedAt: "desc" },
    });
    const phones = bookings.flatMap((b) => [b.owner, b.walker].filter((u) => u !== null));
    return ok(withPhones(await bookingList(bookings), phones));
  });
}
