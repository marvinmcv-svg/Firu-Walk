// GET /api/admin/export?type=bookings|walkers|ledger|payouts → CSV download
// Headers: text/csv; charset=utf-8 + Content-Disposition attachment.

import { db } from "@/lib/db";
import { ApiError, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.join(","), ...rows.map((r) => r.map(csvEscape).join(","))];
  // BOM so Excel opens UTF-8 correctly (seeded names have accents/emojis)
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "");

export async function GET(req: Request) {
  return run(async () => {
    await requireAdmin(req);
    const type = new URL(req.url).searchParams.get("type") ?? "";
    let csv: string;

    if (type === "bookings") {
      const bookings = await db.booking.findMany({
        include: { owner: true, walker: true, dog: true },
        orderBy: { requestedAt: "desc" },
      });
      const zones = await db.zone.findMany();
      const zoneName = new Map(zones.map((z) => [z.id, z.name]));
      csv = toCsv(
        ["id", "estado", "tipo", "dueño", "paseador", "mascota", "zona", "precio_centavos", "duracion_min", "solicitada_en", "aceptada_en", "notas"],
        bookings.map((b) => [
          b.id, b.status, b.type, b.owner?.name, b.walker?.name, b.dog?.name,
          zoneName.get(b.zoneId) ?? b.zoneId,
          b.pricePerWalkCents, b.durationMin, iso(b.requestedAt), iso(b.acceptedAt), b.notes,
        ])
      );
    } else if (type === "walkers") {
      const profiles = await db.walkerProfile.findMany({
        include: { user: true, zone: true },
        orderBy: { appliedAt: "desc" },
      });
      csv = toCsv(
        ["id", "usuario_id", "nombre", "telefono", "zona", "estado", "rating", "reseñas", "paseos_totales", "dueños_recurrentes", "strikes", "aplico_en", "aprobo_en"],
        profiles.map((p) => [
          p.id, p.userId, p.user?.name, p.user?.phone, p.zone?.name, p.status,
          p.rating, p.ratingCount, p.totalWalks, p.repeatOwners, p.strikes,
          iso(p.appliedAt), iso(p.approvedAt),
        ])
      );
    } else if (type === "ledger") {
      const entries = await db.ledgerEntry.findMany({ orderBy: { createdAt: "desc" } });
      csv = toCsv(
        ["id", "txn_id", "cuenta", "debito_centavos", "credito_centavos", "memo", "ref_tipo", "ref_id", "fecha"],
        entries.map((e) => [
          e.id, e.txnId, e.account, e.debitCents, e.creditCents, e.memo, e.refType, e.refId,
          iso(e.createdAt),
        ])
      );
    } else if (type === "payouts") {
      const payouts = await db.payout.findMany({ orderBy: { requestedAt: "desc" } });
      const walkers = await db.user.findMany({
        where: { id: { in: [...new Set(payouts.map((p) => p.walkerId))] } },
        select: { id: true, name: true, phone: true },
      });
      const byId = new Map(walkers.map((w) => [w.id, w]));
      csv = toCsv(
        ["id", "paseador", "telefono", "monto_centavos", "metodo", "estado", "solicitado_en", "pagado_en"],
        payouts.map((p) => [
          p.id, byId.get(p.walkerId)?.name, byId.get(p.walkerId)?.phone,
          p.amountCents, p.method, p.status, iso(p.requestedAt), iso(p.paidAt),
        ])
      );
    } else {
      throw new ApiError(400, "Tipo de export inválido. Opciones: bookings, walkers, ledger, payouts.");
    }

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="firuwalk-${type}.csv"`,
      },
    });
  });
}
