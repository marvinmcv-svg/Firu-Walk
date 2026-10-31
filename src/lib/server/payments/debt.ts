// Cash walks leave the platform's share as walker debt (negative wallet).
// Walkers whose debt exceeds Config payouts.maxCashDebtCents receive no new
// bookings until it is paid down (earnings or a deposit recorded by an admin).

import type { AppConfig } from "@/lib/firu/types";
import { formatBOB } from "@/lib/firu/money";
import { ApiError } from "../http";
import { walletBalance, walletBalances } from "../ledger";

/** Walker ids (from `ids`) currently blocked for cash debt. */
export async function debtBlockedWalkers(ids: string[], cfg: AppConfig): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const balances = await walletBalances(ids);
  return new Set(ids.filter((id) => -(balances.get(id) ?? 0) > cfg.payouts.maxCashDebtCents));
}

/** Throw a friendly 400 when the walker's cash debt is over the limit. */
export async function assertNotDebtBlocked(walkerUserId: string, cfg: AppConfig, who: "self" | "other"): Promise<void> {
  const debt = -(await walletBalance(walkerUserId));
  if (debt <= cfg.payouts.maxCashDebtCents) return;
  throw new ApiError(
    400,
    who === "self"
      ? `Tienes una deuda de ${formatBOB(debt)} por paseos en efectivo (límite ${formatBOB(cfg.payouts.maxCashDebtCents)}). Deposítala a FiruWalk para recibir nuevas reservas.`
      : "El paseador elegido no está disponible actualmente."
  );
}
