"use client";

// Walker earnings ("Ganancias"): wallet hero with withdrawal dialog, ledger
// movements (income / fee / payout) and payout history.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Landmark,
  Loader2,
  PiggyBank,
  QrCode,
  Receipt,
  Scissors,
  Wallet,
} from "lucide-react";
import { api, qk } from "@/lib/firu/api";
import { useT, srvErr } from "@/lib/firu/i18n";
import { formatBOB, parseBOB } from "@/lib/firu/money";
import { fmtDateShort, fmtRelative } from "@/lib/firu/dates";
import type { AppConfig, LedgerEntryDTO, PayoutDTO, WalletDTO } from "@/lib/firu/types";
import { springSmooth } from "@/lib/firu/motion";
import { EmptyState, SectionHeader, StatusBadge } from "@/components/firu/shared/bits";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// i18n keys for payout-method and payout-cycle labels; the user-facing
// strings live in the dictionaries (es/en walker.ts).
const METHOD_KEYS: Record<string, string> = {
  QR: "wlk.pay.methodQR",
  BANK: "wlk.pay.methodBank",
  TRANSFER: "wlk.pay.methodTransfer",
};

const CYCLE_KEYS: Record<string, string> = {
  weekly: "wlk.pay.cycle.weekly",
  biweekly: "wlk.pay.cycle.biweekly",
  monthly: "wlk.pay.cycle.monthly",
};

export function WalkerEarnings() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useT();
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const { data: wallet, isLoading } = useQuery({
    queryKey: qk.wallet,
    queryFn: () => api.get<WalletDTO>("/api/wallet"),
  });
  const { data: payouts, isLoading: loadingPayouts } = useQuery({
    queryKey: qk.payouts,
    queryFn: () => api.get<PayoutDTO[]>("/api/payouts"),
  });
  const { data: config } = useQuery({
    queryKey: qk.config,
    queryFn: () => api.get<AppConfig>("/api/config"),
  });

  const balance = wallet?.balanceCents ?? 0;
  const minPayout = config?.payouts.minPayoutCents ?? 2000;
  const cycle = config?.payouts.cycle ?? "weekly";
  const cycleLabel = CYCLE_KEYS[cycle] ? t(CYCLE_KEYS[cycle]) : cycle;
  const methodLabel = (m: string) => (METHOD_KEYS[m] ? t(METHOD_KEYS[m]) : m);
  const canWithdraw = balance >= minPayout && balance > 0;

  const withdrawMut = useMutation({
    mutationFn: (p: { amountCents: number; method: string }) =>
      api.post<PayoutDTO>("/api/payouts", p),
    onSuccess: () => {
      setWithdrawOpen(false);
      toast({
        title: t("wlk.pay.withdrawOkTitle"),
        description: t("wlk.pay.toastCycle", { cycle: cycleLabel }),
      });
      qc.invalidateQueries({ queryKey: qk.wallet });
      qc.invalidateQueries({ queryKey: qk.payouts });
    },
    onError: (e: Error) =>
      toast({ title: t("wlk.pay.withdrawErrTitle"), description: srvErr(e.message), variant: "destructive" }),
  });

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Balance hero */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springSmooth}
      >
        <SectionHeader title={t("shell.nav.earnings")} subtitle={t("wlk.pay.subtitle")} />
        {isLoading ? (
          <Skeleton className="h-52 rounded-3xl" />
        ) : (
          <div
            className={cn(
              "relative overflow-hidden rounded-3xl firu-gloss p-6 text-primary-foreground shadow-raise",
              balance < 0
                ? "bg-destructive"
                : "bg-gradient-to-br from-primary to-primary/75"
            )}
          >
            <div
              className="absolute -right-10 -top-10 size-44 rounded-full bg-white/10"
              aria-hidden
            />
            <div className="flex items-center gap-2 text-sm font-bold opacity-90">
              <Wallet className="size-4" /> {t("wlk.pay.balance")}
            </div>
            <p className="text-4xl font-black mt-2 tabular-nums">{formatBOB(balance)}</p>
            {balance < 0 && (
              <p className="text-xs mt-2 opacity-90 leading-relaxed">
                {t("wlk.pay.negativeNote")}
              </p>
            )}
            <div className="mt-4 grid grid-cols-2 gap-2.5 max-w-sm">
              <div className="rounded-2xl bg-white/12 px-3 py-2.5">
                <p className="text-[11px] font-bold uppercase tracking-wide opacity-80">
                  {t("wlk.pay.pendingLabel")}
                </p>
                <p className="font-black tabular-nums">
                  {formatBOB(wallet?.pendingPayoutCents ?? 0)}
                </p>
              </div>
              <div className="rounded-2xl bg-white/12 px-3 py-2.5">
                <p className="text-[11px] font-bold uppercase tracking-wide opacity-80">
                  {t("wlk.pay.lifetimeLabel")}
                </p>
                <p className="font-black tabular-nums">
                  {formatBOB(wallet?.lifetimeEarnedCents ?? 0)}
                </p>
              </div>
            </div>
            <Button
              onClick={() => setWithdrawOpen(true)}
              disabled={!canWithdraw}
              className="mt-5 rounded-full bg-white text-primary font-extrabold hover:bg-white/90 h-11"
              size="lg"
            >
              <Banknote className="size-4.5" /> {t("wlk.pay.withdraw")}
            </Button>
            {!canWithdraw && (
              <p className="text-xs mt-2.5 opacity-85">
                {t("wlk.pay.minBalance", { amount: formatBOB(minPayout) })}
              </p>
            )}
          </div>
        )}
      </motion.section>

      {/* Movimientos */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springSmooth, delay: 0.1 }}
      >
        <SectionHeader title={t("wlk.pay.ledgerTitle")} subtitle={t("wlk.pay.ledgerSubtitle")} />
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 rounded-2xl" />
            <Skeleton className="h-16 rounded-2xl" />
            <Skeleton className="h-16 rounded-2xl" />
          </div>
        ) : (wallet?.entries ?? []).length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={t("wlk.pay.ledgerEmptyTitle")}
            description={t("wlk.pay.ledgerEmptyDesc")}
          />
        ) : (
          <div className="rounded-3xl border bg-card overflow-hidden max-h-96 overflow-y-auto shadow-sm">
            {(wallet?.entries ?? []).map((e, i) => (
              <LedgerRow key={e.id} entry={e} last={i === (wallet?.entries.length ?? 0) - 1} />
            ))}
          </div>
        )}
      </motion.section>

      {/* Pagos */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springSmooth, delay: 0.15 }}
      >
        <SectionHeader title={t("wlk.pay.payoutsTitle")} subtitle={t("wlk.pay.payoutsSubtitle")} />
        {loadingPayouts ? (
          <div className="space-y-2">
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
          </div>
        ) : (payouts ?? []).length === 0 ? (
          <EmptyState
            icon={PiggyBank}
            title={t("wlk.pay.payoutsEmptyTitle")}
            description={t("wlk.pay.payoutsEmptyDesc")}
          />
        ) : (
          <div className="space-y-2.5 max-h-96 overflow-y-auto pr-0.5">
            {(payouts ?? []).map((p) => (
              <div
                key={p.id}
                className="rounded-2xl border bg-card p-4 shadow-sm flex items-center gap-3"
              >
                <span
                  className={cn(
                    "grid place-items-center size-11 rounded-2xl shrink-0",
                    p.status === "PAID"
                      ? "bg-brand-soft text-primary"
                      : p.status === "REQUESTED"
                        ? "bg-sun-soft text-amber-600"
                        : "bg-muted text-muted-foreground"
                  )}
                >
                  {p.method === "QR" ? <QrCode className="size-5" /> : <Landmark className="size-5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-black">{formatBOB(p.amountCents)}</p>
                    <StatusBadge status={p.status} kind="payout" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {methodLabel(p.method)} · {t("wlk.pay.requestedOn", { date: fmtDateShort(p.requestedAt) })}
                    {p.paidAt ? ` · ${t("wlk.pay.paidOn", { date: fmtDateShort(p.paidAt) })}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.section>

      {/* Withdraw dialog */}
      <WithdrawDialog
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
        balanceCents={balance}
        minPayoutCents={minPayout}
        cycleLabel={cycleLabel}
        pending={withdrawMut.isPending}
        onSubmit={(amountCents, method) => withdrawMut.mutate({ amountCents, method })}
      />
    </div>
  );
}

/* ------------------------- Ledger row ------------------------- */

function LedgerRow({ entry, last }: { entry: LedgerEntryDTO; last: boolean }) {
  // Walker wallet semantics: credit = money in, debit = money out.
  const isPayout = entry.refType === "payout";
  const isIncome = entry.creditCents > 0;
  const amount = entry.creditCents - entry.debitCents;
  const Icon = isIncome ? ArrowDownLeft : isPayout ? ArrowUpRight : Scissors;
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3",
        !last && "border-b border-border/60"
      )}
    >
      <span
        className={cn(
          "grid place-items-center size-10 rounded-2xl shrink-0",
          isIncome
            ? "bg-brand-soft text-primary"
            : isPayout
              ? "bg-sun-soft text-amber-600"
              : "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400"
        )}
      >
        <Icon className="size-4.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold truncate">{entry.memo}</p>
        <p className="text-xs text-muted-foreground">{fmtRelative(entry.createdAt)}</p>
      </div>
      <p
        className={cn(
          "font-black text-sm tabular-nums shrink-0",
          isIncome
            ? "text-primary"
            : isPayout
              ? "text-amber-600"
              : "text-red-600 dark:text-red-400"
        )}
      >
        {formatBOB(amount, { signed: true })}
      </p>
    </div>
  );
}

/* ------------------------- Withdraw dialog ------------------------- */

function WithdrawDialog({
  open,
  onOpenChange,
  balanceCents,
  minPayoutCents,
  cycleLabel,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  balanceCents: number;
  minPayoutCents: number;
  cycleLabel: string;
  pending: boolean;
  onSubmit: (amountCents: number, method: string) => void;
}) {
  const [amountText, setAmountText] = useState("");
  const [method, setMethod] = useState("QR");
  const { t } = useT();

  // Default to the full balance each time the dialog opens.
  const effectiveText = amountText || formatBOB(balanceCents).replace("Bs ", "");
  const amountCents = useMemo(() => parseBOB(effectiveText), [effectiveText]);
  const tooLow = amountCents < minPayoutCents;
  const tooHigh = amountCents > balanceCents;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setAmountText("");
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-sm rounded-3xl">
        <DialogHeader>
          <DialogTitle>{t("wlk.pay.withdrawTitle")}</DialogTitle>
          <DialogDescription>
            {t("wlk.pay.withdrawDesc")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="withdraw-amount">{t("wlk.pay.amount")}</Label>
            <Input
              id="withdraw-amount"
              inputMode="decimal"
              value={effectiveText}
              onChange={(e) => setAmountText(e.target.value)}
              className="rounded-2xl text-lg font-bold tabular-nums h-12"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {t("wlk.pay.available")} <b>{formatBOB(balanceCents)}</b>
              </span>
              <span>
                {t("wlk.pay.minimum")} <b>{formatBOB(minPayoutCents)}</b>
              </span>
            </div>
            {tooLow && (
              <p className="text-xs text-red-600 dark:text-red-400 font-semibold">
                {t("wlk.pay.errTooLow")}
              </p>
            )}
            {tooHigh && (
              <p className="text-xs text-red-600 dark:text-red-400 font-semibold">
                {t("wlk.pay.errTooHigh")}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>{t("wlk.pay.method")}</Label>
            <RadioGroup value={method} onValueChange={setMethod} className="gap-2">
              {(
                [
                  ["QR", t("wlk.pay.methodQR"), t("wlk.pay.qrHint"), QrCode],
                  ["BANK", t("wlk.pay.methodBank"), t("wlk.pay.bankHint"), Landmark],
                ] as const
              ).map(([value, label, hint, Icon]) => (
                <Label
                  key={value}
                  htmlFor={`wd-${value}`}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border p-3 cursor-pointer transition-colors",
                    method === value
                      ? "border-primary bg-brand-soft/60"
                      : "hover:bg-secondary/60"
                  )}
                >
                  <RadioGroupItem id={`wd-${value}`} value={value} />
                  <Icon className="size-5 text-primary shrink-0" />
                  <div>
                    <p className="font-bold text-sm">{label}</p>
                    <p className="text-xs text-muted-foreground">{hint}</p>
                  </div>
                </Label>
              ))}
            </RadioGroup>
          </div>

          <Button
            className="w-full rounded-full font-extrabold h-11"
            disabled={pending || tooLow || tooHigh || amountCents <= 0}
            onClick={() => onSubmit(amountCents, method)}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Banknote className="size-4" />}
            {t("wlk.pay.requestBtn")}
          </Button>
          <p className="text-xs text-muted-foreground text-center leading-relaxed">
            {t("wlk.pay.cycleNote", { cycle: cycleLabel })}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
