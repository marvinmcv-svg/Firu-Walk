// GET /api/admin/partners/[id]/qr → PNG of the partner's sign-up link, for
// flyers and counter stickers at the vet / pet shop / building lobby.

import QRCode from "qrcode";
import { db } from "@/lib/db";
import { ApiError, run } from "@/lib/server/http";
import { appBaseUrl, partnerShareUrl } from "@/lib/server/partners";
import { requireAdmin } from "@/lib/server/session";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    await requireAdmin(req);
    const partner = await db.partner.findUnique({ where: { id }, select: { code: true } });
    if (!partner) throw new ApiError(404, "Aliado no encontrado.");
    const png = await QRCode.toBuffer(partnerShareUrl(appBaseUrl(req), partner.code), { margin: 2, width: 720 });
    return new Response(new Uint8Array(png), {
      headers: {
        "content-type": "image/png",
        "content-disposition": `inline; filename="firuwalk-${partner.code}.png"`,
        "cache-control": "private, max-age=300",
      },
    });
  });
}
