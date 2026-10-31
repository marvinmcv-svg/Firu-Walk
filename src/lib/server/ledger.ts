// Double-entry ledger service.
//
// SEMANTICS (matches the seeded data in prisma/seed.ts — source of truth):
//   - Every txn = 2+ LedgerEntry rows sharing one txnId, ΣdebitCents === ΣcreditCents.
//   - debit  = SOURCE account (money flows OUT of it),
//     credit = DESTINATION account (money flows INTO it).
//       e.g. payment.hold:  [owner:{id} debit]  → [platform:held credit]
//            walk.release:  [platform:held debit] → [walker:{id} credit net, platform:revenue credit fee]
//            payout.request:[walker:{id} debit] → [payout:{id} credit]
//   - Walker wallet balance = Σcredit − Σdebit on `walker:{userId}` entries.
//     (Seed posts income as CREDIT "Ingreso neto…" and cash fees/payouts as
//     DEBIT "se descuenta del saldo"; WalletDTO notes the balance may go
//     negative when cash fees accrue — so debits reduce the balance.)
//
// NOTE for reviewers: worklog.md line "Wallet balance = Σdebit−Σcredit" is
// INVERTED relative to the seeded entries; this implementation follows the
// data (seed + types.ts comment) so demo wallets are correct (e.g. Luis:
// +Bs 23,36 after earning Bs 63,36 net and withdrawing Bs 40,00).

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "./http";

/** The global client or an interactive-transaction client. */
export type DbClient = typeof db | Prisma.TransactionClient;

export interface TxnEntry {
  account: string;
  debit?: number;
  credit?: number;
  memo: string;
}

/**
 * Post one transaction: entries share a fresh txnId, createdAt = `at`.
 * Validates that total debits equal total credits. Zero-amount legs are
 * dropped (e.g. a 0% owner fee). Pass `client` to post inside $transaction.
 */
export async function postTxn(
  entries: TxnEntry[],
  refType: string,
  refId: string,
  at: Date = new Date(),
  client: DbClient = db
): Promise<string> {
  for (const e of entries) {
    for (const v of [e.debit ?? 0, e.credit ?? 0]) {
      if (!Number.isInteger(v) || v < 0) {
        throw new ApiError(500, "Transacción contable inválida (montos enteros y positivos).");
      }
    }
  }
  entries = entries.filter((e) => (e.debit ?? 0) > 0 || (e.credit ?? 0) > 0);
  const sumDebit = entries.reduce((s, e) => s + (e.debit ?? 0), 0);
  const sumCredit = entries.reduce((s, e) => s + (e.credit ?? 0), 0);
  if (entries.length < 2) {
    throw new ApiError(500, "Transacción contable inválida (mínimo 2 asientos).");
  }
  if (sumDebit !== sumCredit) {
    throw new ApiError(500, "Transacción contable desbalanceada.");
  }
  const txnId = crypto.randomUUID();
  await client.ledgerEntry.createMany({
    data: entries.map((e) => ({
      txnId,
      account: e.account,
      debitCents: e.debit ?? 0,
      creditCents: e.credit ?? 0,
      memo: e.memo,
      refType,
      refId,
      createdAt: at,
    })),
  });
  return txnId;
}

/** Balance of any account = Σcredit − Σdebit (money that flowed into it). */
export async function accountBalance(account: string, client: DbClient = db): Promise<number> {
  const agg = await client.ledgerEntry.aggregate({
    where: { account },
    _sum: { debitCents: true, creditCents: true },
  });
  return (agg._sum.creditCents ?? 0) - (agg._sum.debitCents ?? 0);
}

/** Walker wallet balance = Σcredit − Σdebit on `walker:{userId}`. May be negative (cash fees). */
export async function walletBalance(walkerUserId: string, client: DbClient = db): Promise<number> {
  return accountBalance(`walker:${walkerUserId}`, client);
}

/** Wallet balances for many walkers in one query (missing = 0). */
export async function walletBalances(walkerUserIds: string[]): Promise<Map<string, number>> {
  const rows = await db.ledgerEntry.groupBy({
    by: ["account"],
    where: { account: { in: walkerUserIds.map((id) => `walker:${id}`) } },
    _sum: { debitCents: true, creditCents: true },
  });
  const out = new Map<string, number>(walkerUserIds.map((id) => [id, 0]));
  for (const r of rows) {
    out.set(r.account.slice("walker:".length), (r._sum.creditCents ?? 0) - (r._sum.debitCents ?? 0));
  }
  return out;
}

/**
 * Whole-ledger check: Σdebit must equal Σcredit, and no single txn may be
 * unbalanced. Used by reconciliation and the tests.
 */
export async function ledgerTotals(): Promise<{ debitCents: number; creditCents: number; unbalancedTxns: string[] }> {
  const [agg, byTxn] = await Promise.all([
    db.ledgerEntry.aggregate({ _sum: { debitCents: true, creditCents: true } }),
    db.ledgerEntry.groupBy({ by: ["txnId"], _sum: { debitCents: true, creditCents: true } }),
  ]);
  return {
    debitCents: agg._sum.debitCents ?? 0,
    creditCents: agg._sum.creditCents ?? 0,
    unbalancedTxns: byTxn
      .filter((t) => (t._sum.debitCents ?? 0) !== (t._sum.creditCents ?? 0))
      .map((t) => t.txnId),
  };
}

/**
 * Lifetime net earned by a walker = Σcredit − Σdebit EXCLUDING payout
 * movements (withdrawals are not negative earnings; fees/tips count).
 */
export async function lifetimeEarned(walkerUserId: string): Promise<number> {
  const entries = await db.ledgerEntry.findMany({
    where: { account: `walker:${walkerUserId}`, refType: { not: "payout" } },
    select: { debitCents: true, creditCents: true },
  });
  return entries.reduce((s, e) => s + e.creditCents - e.debitCents, 0);
}

/** Split a gross amount into platform fee and walker net (integer-safe). */
export function payerShare(grossCents: number, commissionPct: number): { feeCents: number; netCents: number } {
  const feeCents = Math.round((grossCents * commissionPct) / 100);
  return { feeCents, netCents: grossCents - feeCents };
}
