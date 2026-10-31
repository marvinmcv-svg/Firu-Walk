// POST /api/admin/walkers/[id]/deposit {amountCents, reference} (id = WalkerProfile id)
// Records cash the walker handed/transferred to FiruWalk to pay down the
// platform's share of cash walks (their negative wallet). Ledger:
// platform:cash → walker:{userId}. Audit-logged.

import { z } from "zod";
import { db } from "@/lib/db";
import { formatBOB } from "@/lib/firu/money";
import { ApiError, ok, readJson, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { postTxn, walletBalance } from "@/lib/server/ledger";
import { notify } from "@/lib/server/notify";

const Body = z.object({
  amountCents: z.number().int().positive("El monto es inválido.").max(10_000_000),
  reference: z.string().trim().min(3, "Indica la referencia del depósito.").max(80),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const admin = await requireAdmin(req);
    const parsed = Body.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Datos inválidos.");
    const { amountCents, reference } = parsed.data;

    const profile = await db.walkerProfile.findUnique({ where: { id }, include: { user: true } });
    if (!profile) throw new ApiError(404, "Perfil de paseador no encontrado.");
    const debt = -(await walletBalance(profile.userId));
    if (debt <= 0) throw new ApiError(400, "Este paseador no tiene deuda.");
    if (amountCents > debt) {
      throw new ApiError(400, `El depósito supera la deuda (${formatBOB(debt)}).`);
    }

    await postTxn(
      [
        { account: "platform:cash", debit: amountCents, memo: `Depósito de ${profile.user.name} — ref. ${reference}` },
        { account: `walker:${profile.userId}`, credit: amountCents, memo: `Depósito de deuda de efectivo (ref. ${reference})` },
      ],
      "deposit",
      profile.userId
    );
    await db.auditLog.create({
      data: {
        actorId: admin.id,
        action: "WALKER_DEBT_DEPOSIT",
        entity: "walker",
        entityId: profile.id,
        detail: `${formatBOB(amountCents)} — ref. ${reference}`,
      },
    });
    await notify(
      profile.userId,
      "PAYOUT",
      "Depósito registrado ✅",
      `Registramos tu depósito de ${formatBOB(amountCents)} (ref. ${reference}). Gracias por ponerte al día.`,
      "earnings"
    );
    return ok({ balanceCents: await walletBalance(profile.userId) });
  });
}
