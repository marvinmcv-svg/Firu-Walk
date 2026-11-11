// POST /api/referrals/redeem {code} → {applied: true}
// A new owner who skipped the code at sign-up can still enter a friend's
// code before their first walk (within REDEEM_WINDOW_DAYS of signing up).

import { ApiError, ok, readJson, reqStr, run } from "@/lib/server/http";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { attachCode } from "@/lib/server/referrals";
import { requireUser } from "@/lib/server/session";

const REASONS: Record<string, string> = {
  disabled: "Las invitaciones no están activas por el momento.",
  invalid: "Ese código de invitación no existe. Revísalo con quien te invitó.",
  own: "No puedes usar tu propio código.",
  already: "Ya tienes un código de invitación aplicado.",
  not_eligible: "El código de invitación solo vale para cuentas nuevas antes de su primer paseo.",
};

export async function POST(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    if (user.role !== "OWNER") throw new ApiError(403, "Solo los dueños pueden usar códigos de invitación.");
    // Codes are guessable-ish (short): cap attempts per owner.
    await enforceRateLimit(`referral-redeem:${user.id}`, 10, 3_600_000);
    const body = await readJson(req);
    const code = reqStr(body, "code", "El código", { max: 30 });
    const r = await attachCode(user.id, code);
    if (!r.applied) throw new ApiError(400, REASONS[r.reason] ?? REASONS.invalid);
    return ok({ applied: true });
  });
}
