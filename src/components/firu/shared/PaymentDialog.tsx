"use client";

// Payment sheet: bank QR (via the payment provider) / bank transfer / cash.
// The owner never confirms a payment: the QR is issued by the provider and
// the dialog polls the payment until the provider's webhook (or the status
// poll) marks it HELD. Transfers are confirmed by the FiruWalk team; cash
// is settled when the walk ends. With the mock provider (development) a
// "Simular pago" button plays the bank.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  Banknote,
  CheckCircle2,
  FlaskConical,
  Landmark,
  Loader2,
  QrCode,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { api, qk } from "@/lib/firu/api";
import { formatBOB } from "@/lib/firu/money";
import { fmtTime } from "@/lib/firu/dates";
import type { AppConfig, PaymentDTO, PaymentMethod } from "@/lib/firu/types";
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

type PayMethod = Exclude<PaymentMethod, "PLAN">;

const METHOD_INFO: Record<PayMethod, { labelKey: string; descKey: string; icon: React.ElementType }> = {
  QR: { labelKey: "sh.pay.method.qr.label", descKey: "sh.pay.method.qr.desc", icon: QrCode },
  TRANSFER: { labelKey: "sh.pay.method.transfer.label", descKey: "sh.pay.method.transfer.desc", icon: Landmark },
  CASH: { labelKey: "sh.pay.method.cash.label", descKey: "sh.pay.method.cash.desc", icon: Banknote },
};

const PAID = ["HELD", "RELEASED", "CASH_SETTLED"];

/** Price / service fee / total lines (only when there is a fee). */
export function PriceBreakdownLines({
  totalCents,
  feeCents,
  baseLabel,
  className,
}: {
  totalCents: number;
  feeCents: number;
  baseLabel: string;
  className?: string;
}) {
  const { t } = useT();
  if (feeCents <= 0) return null;
  return (
    <dl className={cn("text-sm space-y-1", className)}>
      <div className="flex justify-between gap-2">
        <dt className="text-muted-foreground">{baseLabel}</dt>
        <dd className="font-semibold tabular-nums">{formatBOB(totalCents - feeCents)}</dd>
      </div>
      <div className="flex justify-between gap-2">
        <dt className="text-muted-foreground">{t("sh.pay.breakdown.fee")}</dt>
        <dd className="font-semibold tabular-nums">{formatBOB(feeCents)}</dd>
      </div>
      <div className="flex justify-between gap-2 border-t pt-1">
        <dt className="font-bold">{t("sh.pay.breakdown.total")}</dt>
        <dd className="font-black tabular-nums">{formatBOB(totalCents)}</dd>
      </div>
    </dl>
  );
}

export function PaymentDialog({
  open,
  onOpenChange,
  bookingId,
  payment,
  title,
  description,
  onPaid,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Walk payments: lets the owner switch method. Omit for plan purchases. */
  bookingId?: string;
  payment: PaymentDTO | null | undefined;
  title: string;
  description?: string;
  onPaid?: () => void;
}) {
  const { toast } = useToast();
  const { t } = useT();
  const qc = useQueryClient();
  const isPlan = payment?.purpose === "PLAN";
  const [method, setMethod] = useState<PayMethod>(
    payment && payment.method !== "PLAN" ? payment.method : "QR"
  );
  const [transferSent, setTransferSent] = useState(false);

  const { data: config } = useQuery({
    queryKey: qk.config,
    queryFn: () => api.get<AppConfig>("/api/config"),
  });

  const paymentId = payment?.id;
  // Live payment: polled while it waits for the provider/team.
  const live = useQuery({
    queryKey: ["payment", paymentId],
    queryFn: () => api.get<PaymentDTO>(`/api/payments/${paymentId}`),
    enabled: open && !!paymentId,
    initialData: payment ?? undefined,
    refetchInterval: (q) =>
      q.state.data?.status === "PENDING" ? (method === "QR" ? 3_000 : 15_000) : false,
  });
  const current = live.data ?? payment ?? null;
  const pending = current?.status === "PENDING";
  const isPaid = !!current && PAID.includes(current.status);
  const amountCents = current?.amountCents ?? 0;

  // Provider QR for the payment (issued/renewed server-side).
  const qr = useQuery({
    queryKey: ["payment-qr", paymentId],
    queryFn: () => api.post<PaymentDTO>(`/api/payments/${paymentId}/qr`),
    enabled: open && !!paymentId && pending && method === "QR",
    retry: false,
    staleTime: Infinity,
    refetchInterval: (q) => {
      const exp = q.state.data?.qrExpiresAt;
      return exp ? Math.max(5_000, new Date(exp).getTime() - Date.now() - 60_000) : false;
    },
  });

  // Pending → paid while open: refresh everything that shows money, once.
  const sawPending = useRef(false);
  const announced = useRef(false);
  useEffect(() => {
    if (!open) return;
    if (pending) sawPending.current = true;
    if (!isPaid || !sawPending.current || announced.current) return;
    announced.current = true;
    qc.invalidateQueries({ queryKey: qk.bookings });
    qc.invalidateQueries({ queryKey: qk.payments });
    qc.invalidateQueries({ queryKey: qk.notifications });
    qc.invalidateQueries({ queryKey: ["subscriptions"] });
    toast({ title: t("sh.pay.receivedTitle"), description: t(isPlan ? "sh.pay.planReceivedDesc" : "sh.pay.receivedDesc") });
    onPaid?.();
  }, [open, pending, isPaid, isPlan, qc, toast, t, onPaid]);

  const setMethodMut = useMutation({
    mutationFn: (m: PayMethod) => api.post<PaymentDTO>("/api/payments", { bookingId, method: m }),
    onSuccess: (p) => {
      qc.setQueryData(["payment", p.id], p);
      qc.invalidateQueries({ queryKey: qk.bookings });
      qc.invalidateQueries({ queryKey: qk.payments });
    },
    onError: (e: Error) =>
      toast({ title: t("sh.pay.confirmError"), description: srvErr(e.message), variant: "destructive" }),
  });

  const mockPay = useMutation({
    mutationFn: () => api.post<PaymentDTO>("/api/payments/mock/pay", { paymentId }),
    onSuccess: (p) => qc.setQueryData(["payment", p.id], p),
    onError: (e: Error) =>
      toast({ title: t("sh.pay.confirmError"), description: srvErr(e.message), variant: "destructive" }),
  });

  const chooseMethod = (m: PayMethod) => {
    setMethod(m);
    setTransferSent(false);
    if (bookingId && current && current.method !== m) setMethodMut.mutate(m);
  };

  const close = (v: boolean) => {
    onOpenChange(v);
    if (!v) {
      announced.current = false;
      sawPending.current = false;
      setTransferSent(false);
    }
  };

  const qrData = qr.data?.qrImage ?? (current?.qrImage || null);
  const qrExpires = qr.data?.qrExpiresAt ?? current?.qrExpiresAt ?? null;
  const showMock = !!config?.paymentsMock && pending && method === "QR";

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md rounded-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <ShieldCheck className="size-5 text-primary" />
            {isPaid && current?.status !== "CASH_SETTLED" ? t("sh.pay.confirmedTitle") : title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {isPaid ? (
          <div className="text-center py-4">
            <CheckCircle2 className="size-14 text-primary mx-auto" />
            <p className="font-extrabold text-lg mt-3">
              {current?.method === "CASH" ? t("sh.pay.cashLater") : t("sh.pay.heldAmount", { amount: formatBOB(amountCents) })}
            </p>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto leading-relaxed">
              {current?.method === "CASH" ? t("sh.pay.cashNote") : t(isPlan ? "sh.pay.planHeldNote" : "sh.pay.heldNote")}
            </p>
            {current?.qrRef && (
              <p className="text-xs text-muted-foreground mt-3 font-mono">{t("sh.pay.ref", { ref: current.qrRef })}</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-brand-soft/60 rounded-2xl py-3 px-4 border">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground text-center">{t("sh.pay.amount")}</p>
              <p className="text-3xl font-black text-primary text-center">{formatBOB(amountCents)}</p>
              <PriceBreakdownLines
                className="mt-2"
                totalCents={amountCents}
                feeCents={current?.ownerFeeCents ?? 0}
                baseLabel={t(isPlan ? "sh.pay.breakdown.plan" : "sh.pay.breakdown.walk")}
              />
            </div>

            {!isPlan && bookingId && (
              <div className="grid gap-2" role="radiogroup" aria-label={t("sh.pay.methodLabel")}>
                {(Object.keys(METHOD_INFO) as PayMethod[]).map((m) => {
                  const info = METHOD_INFO[m];
                  const active = method === m;
                  return (
                    <button
                      key={m}
                      role="radio"
                      aria-checked={active}
                      onClick={() => chooseMethod(m)}
                      className={cn(
                        "flex items-center gap-3 rounded-2xl border-2 p-3 text-left transition-[border-color,background-color,transform] duration-200 ease-out-expo active:scale-[0.98]",
                        active ? "border-primary bg-brand-soft/60" : "border-border hover:border-primary/40"
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
            )}

            {method === "QR" && (
              <div className="text-center space-y-2">
                {qr.isError ? (
                  <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground space-y-2">
                    <p>{srvErr((qr.error as Error).message)}</p>
                    <Button size="sm" variant="outline" className="rounded-full" onClick={() => qr.refetch()}>
                      <RefreshCw className="size-4" /> {t("sh.pay.qrRetry")}
                    </Button>
                  </div>
                ) : qrData ? (
                  <>
                    <img
                      src={qrData}
                      alt={t("sh.pay.qrAlt")}
                      className="mx-auto size-56 rounded-xl bg-white p-2 border shadow-inner"
                    />
                    <p className="text-xs text-muted-foreground">{t("sh.pay.qrNote")}</p>
                    <p className="text-xs font-semibold flex items-center justify-center gap-1.5 text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin text-primary" /> {t("sh.pay.waiting")}
                      {qrExpires && <span>· {t("sh.pay.qrValidUntil", { time: fmtTime(qrExpires) })}</span>}
                    </p>
                  </>
                ) : (
                  <div className="mx-auto size-56 rounded-xl border grid place-items-center text-sm text-muted-foreground">
                    <span className="flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" /> {t("sh.pay.qrLoading")}
                    </span>
                  </div>
                )}
              </div>
            )}
            {method === "TRANSFER" && (
              <div className="rounded-2xl border bg-muted/40 p-3 text-sm space-y-1">
                <p className="font-bold">{t("sh.pay.transferAccount")}</p>
                <p className="text-muted-foreground">{t("sh.pay.transferBank")}</p>
                <p className="text-muted-foreground">
                  {t("sh.pay.transferLead")} <strong>{formatBOB(amountCents)}</strong> {t("sh.pay.transferTail")}
                </p>
                {current?.qrRef && <p className="font-mono text-xs">{t("sh.pay.ref", { ref: current.qrRef })}</p>}
              </div>
            )}
            {method === "CASH" && (
              <p className="text-sm text-muted-foreground text-center leading-relaxed">{t("sh.pay.cashReminder")}</p>
            )}

            {showMock && (
              <div className="space-y-1.5">
                <Button
                  className="w-full rounded-full font-bold"
                  variant="outline"
                  disabled={mockPay.isPending || !qrData}
                  onClick={() => mockPay.mutate()}
                >
                  {mockPay.isPending ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
                  {t("sh.pay.simulate", { amount: formatBOB(amountCents) })}
                </Button>
                <p className="text-[11px] text-center text-muted-foreground">{t("sh.pay.mockNote")}</p>
              </div>
            )}

            {method === "TRANSFER" &&
              (transferSent ? (
                <p className="text-sm text-center rounded-2xl bg-brand-soft/60 p-3">
                  <strong>{t("sh.pay.transferPendingTitle")}</strong> {t("sh.pay.transferPendingDesc")}
                </p>
              ) : (
                <Button className="w-full rounded-full font-bold" onClick={() => setTransferSent(true)}>
                  {t("sh.pay.transferDone")}
                </Button>
              ))}

            {method === "CASH" && (
              <Button
                className="w-full rounded-full font-bold"
                disabled={setMethodMut.isPending}
                onClick={() => {
                  toast({ title: t("sh.pay.methodSavedTitle"), description: t("sh.pay.methodSavedDesc") });
                  onPaid?.();
                  close(false);
                }}
              >
                {t("sh.pay.saveMethod")}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
