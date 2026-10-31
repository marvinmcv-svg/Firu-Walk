"use client";

// Payment sheet: QR Simple (simulated) / bank transfer / cash.
// QR + transfer create a HELD balance on the platform (released after the walk);
// cash accrues the platform fee to the walker wallet on completion.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Banknote,
  CheckCircle2,
  Landmark,
  Loader2,
  QrCode,
  ShieldCheck,
} from "lucide-react";
import { api, qk } from "@/lib/firu/api";
import { formatBOB } from "@/lib/firu/money";
import type { PaymentDTO, PaymentMethod } from "@/lib/firu/types";
import { useToast } from "@/hooks/use-toast";
import { srvErr, useT } from "@/lib/firu/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Deterministic pseudo-QR visual (clearly labeled as simulated demo). */
function PseudoQr({ seed }: { seed: string }) {
  const { t } = useT();
  const cells = useMemo(() => {
    const n = 25;
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const rand = () => {
      h ^= h << 13;
      h ^= h >>> 17;
      h ^= h << 5;
      return ((h >>> 0) % 1000) / 1000;
    };
    const grid: boolean[][] = [];
    for (let r = 0; r < n; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < n; c++) {
        const isFinder =
          (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
        if (isFinder) {
          const lr = r < 7 ? r : n - 1 - r;
          const lc = c < 7 ? c : n - 1 - c;
          const ring = Math.min(lr, lc);
          row.push(ring === 0 || ring === 2 || (ring === 3 && lr >= 2 && lc >= 2 && lr <= 4 && lc <= 4));
        } else {
          row.push(rand() > 0.52);
        }
      }
      grid.push(row);
    }
    return grid;
  }, [seed]);

  return (
    <div
      className="inline-grid gap-0 rounded-xl bg-white p-3 border shadow-inner"
      style={{ gridTemplateColumns: "repeat(25, 8px)" }}
      aria-label={t("sh.pay.qrSimulated")}
    >
      {cells.flat().map((on, i) => (
        <span
          key={i}
          className={cn("w-2 h-2", on ? "bg-neutral-900" : "bg-white")}
        />
      ))}
    </div>
  );
}

const METHOD_INFO: Record<
  Exclude<PaymentMethod, "PLAN">,
  { labelKey: string; descKey: string; icon: React.ElementType }
> = {
  QR: { labelKey: "sh.pay.method.qr.label", descKey: "sh.pay.method.qr.desc", icon: QrCode },
  TRANSFER: { labelKey: "sh.pay.method.transfer.label", descKey: "sh.pay.method.transfer.desc", icon: Landmark },
  CASH: { labelKey: "sh.pay.method.cash.label", descKey: "sh.pay.method.cash.desc", icon: Banknote },
};

export function PaymentDialog({
  open,
  onOpenChange,
  bookingId,
  payment,
  amountCents,
  title,
  description,
  onPaid,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  bookingId: string;
  payment: PaymentDTO | null | undefined;
  amountCents: number;
  title: string;
  description?: string;
  onPaid?: () => void;
}) {
  const { toast } = useToast();
  const { t } = useT();
  const qc = useQueryClient();
  const currentMethod = payment?.method ?? "QR";
  const [method, setMethod] = useState<PaymentMethod>(currentMethod);
  const [paid, setPaid] = useState(false);
  const isPaid =
    paid ||
    (payment && ["HELD", "RELEASED", "CASH_SETTLED"].includes(payment.status));

  const setMethodMut = useMutation({
    mutationFn: (m: PaymentMethod) =>
      api.post<PaymentDTO>("/api/payments", { bookingId, method: m }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.bookings });
      qc.invalidateQueries({ queryKey: qk.payments });
    },
  });

  const confirmMut = useMutation({
    mutationFn: () =>
      api.post<PaymentDTO>(`/api/payments/${payment?.id}/confirm`, {
        qrRef: `QR-FW-${bookingId.slice(-6).toUpperCase()}`,
      }),
    onSuccess: () => {
      setPaid(true);
      qc.invalidateQueries({ queryKey: qk.bookings });
      qc.invalidateQueries({ queryKey: qk.payments });
      qc.invalidateQueries({ queryKey: qk.notifications });
      toast({
        title: t("sh.pay.receivedTitle"),
        description: t("sh.pay.receivedDesc"),
      });
      onPaid?.();
    },
    onError: (e: Error) =>
      toast({ title: t("sh.pay.confirmError"), description: srvErr(e.message), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setPaid(false); }}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <ShieldCheck className="size-5 text-primary" />
            {isPaid && payment?.status !== "CASH_SETTLED" ? t("sh.pay.confirmedTitle") : title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {isPaid ? (
          <div className="text-center py-4">
            <CheckCircle2 className="size-14 text-primary mx-auto" />
            <p className="font-extrabold text-lg mt-3">
              {method === "CASH" ? t("sh.pay.cashLater") : t("sh.pay.heldAmount", { amount: formatBOB(amountCents) })}
            </p>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto leading-relaxed">
              {method === "CASH"
                ? t("sh.pay.cashNote")
                : t("sh.pay.heldNote")}
            </p>
            {payment?.qrRef && (
              <p className="text-xs text-muted-foreground mt-3 font-mono">
                {t("sh.pay.ref", { ref: payment.qrRef })}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-center bg-brand-soft/60 rounded-2xl py-3 border">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("sh.pay.amount")}</p>
              <p className="text-3xl font-black text-primary">{formatBOB(amountCents)}</p>
            </div>

            <div className="grid gap-2">
              {(Object.keys(METHOD_INFO) as Exclude<PaymentMethod, "PLAN">[]).map((m) => {
                const info = METHOD_INFO[m];
                const active = method === m;
                return (
                  <button
                    key={m}
                    onClick={() => {
                      setMethod(m);
                      if (payment && payment.method !== m) setMethodMut.mutate(m);
                    }}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl border-2 p-3 text-left transition-[border-color,background-color,transform] duration-200 ease-out-expo active:scale-[0.98]",
                      active
                        ? "border-primary bg-brand-soft/60"
                        : "border-border hover:border-primary/40"
                    )}
                  >
                    <info.icon className={cn("size-6 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                    <div className="min-w-0">
                      <p className="font-bold text-sm">{t(info.labelKey)}</p>
                      <p className="text-xs text-muted-foreground leading-snug">{t(info.descKey)}</p>
                    </div>
                    <span
                      className={cn(
                        "ml-auto size-4 rounded-full border-2 shrink-0",
                        active ? "border-primary bg-primary" : "border-muted-foreground/40"
                      )}
                    />
                  </button>
                );
              })}
            </div>

            {method === "QR" && (
              <div className="text-center space-y-2">
                <PseudoQr seed={payment?.id ?? bookingId} />
                <p className="text-xs text-muted-foreground">
                  {t("sh.pay.qrNote")}
                </p>
              </div>
            )}
            {method === "TRANSFER" && (
              <div className="rounded-2xl border bg-muted/40 p-3 text-sm space-y-1">
                <p className="font-bold">{t("sh.pay.transferAccount")}</p>
                <p className="text-muted-foreground">{t("sh.pay.transferBank")}</p>
                <p className="text-muted-foreground">
                  {t("sh.pay.transferLead")} <strong>{formatBOB(amountCents)}</strong> {t("sh.pay.transferTail")}
                </p>
              </div>
            )}
            {method === "CASH" && (
              <p className="text-sm text-muted-foreground text-center leading-relaxed">
                {t("sh.pay.cashReminder")}
              </p>
            )}

            <Button
              className="w-full rounded-full font-bold"
              disabled={confirmMut.isPending || setMethodMut.isPending}
              onClick={() => {
                if (method === "CASH") {
                  if (payment && payment.method !== "CASH") setMethodMut.mutate("CASH");
                  setPaid(true);
                  toast({
                    title: t("sh.pay.methodSavedTitle"),
                    description: t("sh.pay.methodSavedDesc"),
                  });
                  onPaid?.();
                } else if (payment) {
                  confirmMut.mutate();
                } else {
                  api
                    .post<PaymentDTO>("/api/payments", { bookingId, method })
                    .then(() => qc.invalidateQueries({ queryKey: qk.bookings }))
                    .catch(() => undefined);
                }
              }}
            >
              {confirmMut.isPending && <Loader2 className="size-4 animate-spin" />}
              {method === "CASH" ? t("sh.pay.saveMethod") : t("sh.pay.simulate", { amount: formatBOB(amountCents) })}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
