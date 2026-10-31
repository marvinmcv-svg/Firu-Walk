"use client";

// Admin → Pagos: everything money ops does by hand.
//   1. Conciliación — provider settlements vs ledger (run + issues queue).
//   2. Pagos pendientes — QR/transfer payments waiting; manual confirmation
//      with a required reason (audit-logged) when the bank shows the money.
//   3. Pagos a paseadores — weekly batches (approve → CSV → paid with the
//      bank reference) and loose walker requests.
//   4. Planes mensuales — price / active switch.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Layers,
  Loader2,
  PlayCircle,
  Scale,
  Ticket,
  Wallet,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { api, qk } from "@/lib/firu/api";
import { fmtDateShort, fmtRelative } from "@/lib/firu/dates";
import { formatBOB, parseBOB } from "@/lib/firu/money";
import { srvErr, useT } from "@/lib/firu/i18n";
import type { PaymentDTO, PayoutBatchDTO, PayoutDTO, PlanDTO, ReconIssueDTO, ReconRunDTO } from "@/lib/firu/types";
import { EmptyState, SectionHeader, StatusBadge } from "@/components/firu/shared/bits";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type AdminPayout = PayoutDTO & { walkerId: string; walkerName: string | null };
type PendingPayment = PaymentDTO & {
  bookingId: string | null;
  dogName: string | null;
  ownerName: string | null;
  planName: string | null;
};
interface ReconState {
  provider: string;
  runs: ReconRunDTO[];
  issues: ReconIssueDTO[];
  ledger: { debitCents: number; creditCents: number; balanced: boolean };
}

/** One text-input confirmation dialog (reason / reference / note). */
type Prompt =
  | { kind: "confirmPayment"; payment: PendingPayment }
  | { kind: "resolveIssue"; issue: ReconIssueDTO }
  | { kind: "payBatch"; batch: PayoutBatchDTO }
  | { kind: "payPayout"; payout: AdminPayout }
  | { kind: "cancelPayout"; payout: AdminPayout };

export function AdminPayments() {
  const { t } = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [text, setText] = useState("");
  const [text2, setText2] = useState("");

  const recon = useQuery({ queryKey: qk.adminRecon, queryFn: () => api.get<ReconState>("/api/admin/reconciliation") });
  const pending = useQuery({
    queryKey: qk.adminPendingPayments,
    queryFn: () => api.get<PendingPayment[]>("/api/payments?status=PENDING"),
  });
  const batches = useQuery({ queryKey: qk.adminBatches, queryFn: () => api.get<PayoutBatchDTO[]>("/api/admin/payout-batches") });
  const payouts = useQuery({ queryKey: qk.payouts, queryFn: () => api.get<AdminPayout[]>("/api/payouts") });
  const plans = useQuery({ queryKey: qk.adminPlans, queryFn: () => api.get<PlanDTO[]>("/api/admin/plans") });

  const refreshMoney = () => {
    for (const key of [qk.adminRecon, qk.adminPendingPayments, qk.adminBatches, qk.payouts, qk.adminMetrics, qk.payments, qk.adminUsers]) {
      qc.invalidateQueries({ queryKey: key });
    }
  };
  const onError = (e: Error) => toast({ title: t("adm.money.err"), description: srvErr(e.message), variant: "destructive" });

  const act = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      refreshMoney();
      setPrompt(null);
      setText("");
      setText2("");
      toast({ title: t("adm.money.done") });
    },
    onError,
  });

  const openIssues = (recon.data?.issues ?? []).filter((i) => i.status === "OPEN");
  const loosePayouts = (payouts.data ?? []).filter((p) => p.status === "REQUESTED" && !p.batchId);
  const openBatch = (batches.data ?? []).find((b) => b.status !== "PAID");
  const lastRun = recon.data?.runs[0];

  const submitPrompt = () => {
    if (!prompt) return;
    if (prompt.kind === "confirmPayment") {
      act.mutate(() => api.post(`/api/payments/${prompt.payment.id}/confirm`, { reason: text, reference: text2 || undefined }));
    } else if (prompt.kind === "resolveIssue") {
      act.mutate(() => api.patch(`/api/admin/reconciliation/${prompt.issue.id}`, { resolution: text }));
    } else if (prompt.kind === "payBatch") {
      act.mutate(() => api.patch(`/api/admin/payout-batches/${prompt.batch.id}`, { action: "paid", reference: text }));
    } else if (prompt.kind === "payPayout") {
      act.mutate(() => api.patch(`/api/payouts/${prompt.payout.id}`, { action: "paid", reference: text }));
    } else {
      act.mutate(() => api.patch(`/api/payouts/${prompt.payout.id}`, { action: "cancel", reason: text || undefined }));
    }
  };

  const promptCopy: Record<Prompt["kind"], { title: string; label: string; required: boolean }> = {
    confirmPayment: { title: t("adm.money.confirmTitle"), label: t("adm.money.reasonLabel"), required: true },
    resolveIssue: { title: t("adm.money.resolveTitle"), label: t("adm.money.noteLabel"), required: true },
    payBatch: { title: t("adm.money.payBatchTitle"), label: t("adm.money.refLabel"), required: true },
    payPayout: { title: t("adm.money.payPayoutTitle"), label: t("adm.money.refLabel"), required: true },
    cancelPayout: { title: t("adm.money.cancelPayoutTitle"), label: t("adm.money.cancelReasonLabel"), required: false },
  };

  return (
    <div className="space-y-8">
      <SectionHeader
        title={t("adm.money.title")}
        subtitle={t("adm.money.subtitle", { provider: recon.data?.provider ?? "…" })}
      />

      {/* ---------- 1. Reconciliation ---------- */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-muted-foreground">
            <Scale className="size-4" /> {t("adm.money.reconTitle")}
          </h3>
          {recon.data && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold",
                recon.data.ledger.balanced
                  ? "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800"
                  : "bg-red-50 text-red-700 border-red-300 dark:bg-red-950/40 dark:text-red-400"
              )}
            >
              {recon.data.ledger.balanced ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}
              {recon.data.ledger.balanced ? t("adm.money.ledgerOk") : t("adm.money.ledgerBad")}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            className="rounded-full ml-auto"
            disabled={act.isPending}
            onClick={() => act.mutate(() => api.post("/api/admin/reconciliation", {}))}
          >
            <PlayCircle className="size-4" /> {t("adm.money.runRecon")}
          </Button>
        </div>
        {lastRun && (
          <p className="text-xs text-muted-foreground">
            {t("adm.money.lastRun", {
              ago: fmtRelative(lastRun.createdAt),
              day: fmtDateShort(lastRun.periodStart),
              settled: lastRun.settledCount,
              recorded: lastRun.recordedCount,
              issues: lastRun.issuesFound,
            })}
          </p>
        )}
        {recon.isLoading ? (
          <Skeleton className="h-20 rounded-2xl" />
        ) : openIssues.length === 0 ? (
          <div className="rounded-2xl border border-dashed px-4 py-3 text-sm text-muted-foreground">{t("adm.money.noIssues")}</div>
        ) : (
          <div className="grid gap-2">
            {openIssues.map((i) => (
              <div key={i.id} className="rounded-2xl border border-amber-300 bg-sun-soft/50 p-3 flex flex-wrap items-center gap-3">
                <AlertTriangle className="size-5 text-amber-600 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm">{t(`adm.money.kind.${i.kind}`)}</p>
                  <p className="text-xs text-muted-foreground">{i.detail}</p>
                  <p className="text-[11px] font-mono text-muted-foreground">
                    {i.paymentId ?? i.providerRef ?? ""} · {fmtRelative(i.createdAt)}
                  </p>
                </div>
                <Button size="sm" variant="outline" className="rounded-full" onClick={() => setPrompt({ kind: "resolveIssue", issue: i })}>
                  {t("adm.money.resolve")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------- 2. Pending payments ---------- */}
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-muted-foreground">
          <Wallet className="size-4" /> {t("adm.money.pendingTitle")}
        </h3>
        {pending.isLoading ? (
          <Skeleton className="h-16 rounded-2xl" />
        ) : (pending.data ?? []).length === 0 ? (
          <div className="rounded-2xl border border-dashed px-4 py-3 text-sm text-muted-foreground">{t("adm.money.noPending")}</div>
        ) : (
          <div className="rounded-2xl border bg-card divide-y max-h-80 overflow-y-auto">
            {(pending.data ?? []).map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-bold">
                    {p.ownerName ?? "—"} · {p.planName ?? p.dogName ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {p.method === "QR" ? t("adm.pay.qr") : t("adm.pay.transfer")}
                    {p.qrRef ? ` · ${p.qrRef}` : ""} · {fmtRelative(p.createdAt)}
                  </p>
                </div>
                <p className="font-black tabular-nums">{formatBOB(p.amountCents)}</p>
                <Button size="sm" variant="outline" className="rounded-full" onClick={() => setPrompt({ kind: "confirmPayment", payment: p })}>
                  {t("adm.money.confirmManual")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------- 3. Walker payouts ---------- */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-muted-foreground">
            <Layers className="size-4" /> {t("adm.money.payoutsTitle")}
          </h3>
          <Button
            size="sm"
            className="rounded-full ml-auto"
            disabled={act.isPending || !!openBatch}
            onClick={() => act.mutate(() => api.post("/api/admin/payout-batches"))}
          >
            {t("adm.money.buildBatch")}
          </Button>
        </div>

        {loosePayouts.length > 0 && (
          <div className="grid gap-2 xl:grid-cols-2">
            {loosePayouts.map((p) => (
              <div key={p.id} className="rounded-2xl border border-primary/30 bg-brand-soft p-3 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold">{p.walkerName ?? t("adm.usr.walkerFallback")}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.destRef ?? t("adm.money.noAccount")} · {t("adm.money.requested", { ago: fmtRelative(p.requestedAt) })}
                  </p>
                </div>
                <p className="text-lg font-black tabular-nums">{formatBOB(p.amountCents)}</p>
                <div className="flex gap-2">
                  <Button size="sm" className="rounded-full" onClick={() => setPrompt({ kind: "payPayout", payout: p })}>
                    {t("adm.usr.markPaid")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full text-destructive border-destructive/40"
                    onClick={() => setPrompt({ kind: "cancelPayout", payout: p })}
                  >
                    <XCircle className="size-4" /> {t("c.cancel")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {batches.isLoading ? (
          <Skeleton className="h-32 rounded-2xl" />
        ) : (batches.data ?? []).length === 0 ? (
          <EmptyState icon={Layers} title={t("adm.money.noBatches")} description={t("adm.money.noBatchesDesc")} />
        ) : (
          <div className="space-y-3">
            {(batches.data ?? []).map((b) => (
              <div key={b.id} className="rounded-2xl border bg-card overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b bg-muted/30">
                  <StatusBadge status={b.status} />
                  <p className="font-bold text-sm">
                    {t("adm.money.batchOf", { from: fmtDateShort(b.periodStart), to: fmtDateShort(b.periodEnd) })}
                  </p>
                  <p className="font-black tabular-nums ml-auto">{formatBOB(b.totalCents)}</p>
                  {b.status === "DRAFT" && (
                    <Button
                      size="sm"
                      className="rounded-full"
                      disabled={act.isPending}
                      onClick={() => act.mutate(() => api.patch(`/api/admin/payout-batches/${b.id}`, { action: "approve" }))}
                    >
                      {t("adm.money.approve")}
                    </Button>
                  )}
                  {b.status !== "DRAFT" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      onClick={() => window.open(`/api/admin/payout-batches/${b.id}/csv`, "_blank")}
                    >
                      <Download className="size-4" /> CSV
                    </Button>
                  )}
                  {b.status === "APPROVED" && (
                    <Button size="sm" className="rounded-full" onClick={() => setPrompt({ kind: "payBatch", batch: b })}>
                      {t("adm.money.markBatchPaid")}
                    </Button>
                  )}
                  {b.reference && <span className="text-xs font-mono text-muted-foreground w-full">{t("wlk.pay.reference", { ref: b.reference })}</span>}
                </div>
                {b.payouts.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted-foreground">{t("adm.money.emptyBatch")}</p>
                ) : (
                  <div className="divide-y">
                    {b.payouts.map((p) => (
                      <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="font-bold">{p.walkerName ?? "—"}</p>
                          <p className={cn("text-xs", p.destRef ? "text-muted-foreground" : "text-red-600 dark:text-red-400 font-semibold")}>
                            {p.destRef ?? t("adm.money.noAccount")}
                          </p>
                        </div>
                        <StatusBadge status={p.status} kind="payout" />
                        <p className="font-black tabular-nums w-24 text-right">{formatBOB(p.amountCents)}</p>
                        {(p.status === "REQUESTED" || p.status === "APPROVED") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="rounded-full text-destructive"
                            aria-label={t("adm.money.removePayout")}
                            onClick={() => setPrompt({ kind: "cancelPayout", payout: p })}
                          >
                            <XCircle className="size-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------- 4. Plans ---------- */}
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-muted-foreground">
          <Ticket className="size-4" /> {t("adm.money.plansTitle")}
        </h3>
        {plans.isLoading ? (
          <Skeleton className="h-24 rounded-2xl" />
        ) : (
          <div className="rounded-2xl border bg-card divide-y">
            {(plans.data ?? []).map((p) => (
              <PlanRow key={`${p.id}-${p.priceCents}-${p.active}`} plan={p} busy={act.isPending} onSave={(patch) => act.mutate(() => api.patch(`/api/admin/plans/${p.id}`, patch))} />
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t("adm.money.plansNote")}</p>
      </section>

      {/* ---------- prompt dialog ---------- */}
      <Dialog open={!!prompt} onOpenChange={(v) => !v && (setPrompt(null), setText(""), setText2(""))}>
        <DialogContent className="max-w-md rounded-3xl">
          {prompt && (
            <>
              <DialogHeader>
                <DialogTitle>{promptCopy[prompt.kind].title}</DialogTitle>
                <DialogDescription>
                  {prompt.kind === "confirmPayment" &&
                    t("adm.money.confirmDesc", { amount: formatBOB(prompt.payment.amountCents), owner: prompt.payment.ownerName ?? "—" })}
                  {prompt.kind === "resolveIssue" && prompt.issue.detail}
                  {prompt.kind === "payBatch" &&
                    t("adm.money.payBatchDesc", { amount: formatBOB(prompt.batch.totalCents), count: prompt.batch.payouts.filter((p) => p.status === "APPROVED").length })}
                  {(prompt.kind === "payPayout" || prompt.kind === "cancelPayout") &&
                    `${prompt.payout.walkerName ?? ""} · ${formatBOB(prompt.payout.amountCents)}`}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="money-prompt">{promptCopy[prompt.kind].label}</Label>
                  {prompt.kind === "confirmPayment" || prompt.kind === "resolveIssue" ? (
                    <Textarea id="money-prompt" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
                  ) : (
                    <Input id="money-prompt" value={text} onChange={(e) => setText(e.target.value)} />
                  )}
                </div>
                {prompt.kind === "confirmPayment" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="money-prompt-ref">{t("adm.money.refOptional")}</Label>
                    <Input id="money-prompt-ref" value={text2} onChange={(e) => setText2(e.target.value)} />
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button
                  className={cn("rounded-full", prompt.kind === "cancelPayout" && "bg-destructive text-white hover:bg-destructive/90")}
                  disabled={act.isPending || (promptCopy[prompt.kind].required && text.trim().length < 3)}
                  onClick={submitPrompt}
                >
                  {act.isPending && <Loader2 className="size-4 animate-spin" />}
                  {t("c.confirm")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PlanRow({
  plan,
  busy,
  onSave,
}: {
  plan: PlanDTO;
  busy: boolean;
  onSave: (patch: { priceCents?: number; active?: boolean }) => void;
}) {
  const { t } = useT();
  const [price, setPrice] = useState(formatBOB(plan.priceCents).replace("Bs ", ""));
  const cents = parseBOB(price);
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <p className="font-bold">{plan.name}</p>
        <p className="text-xs text-muted-foreground">
          {t("own.plans.walks", { count: plan.walks, min: plan.durationMin, days: plan.periodDays })} ·{" "}
          {t("own.plans.perWalk", { amount: formatBOB(plan.perWalkCents) })}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Bs</span>
        <Input
          aria-label={t("adm.money.planPrice")}
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="w-24 rounded-xl h-8"
        />
        <Button
          size="sm"
          variant="outline"
          className="rounded-full h-8"
          disabled={busy || cents <= 0 || cents === plan.priceCents}
          onClick={() => onSave({ priceCents: cents })}
        >
          {t("adm.money.save")}
        </Button>
      </div>
      <label className="flex items-center gap-2 text-xs font-semibold">
        <Switch checked={plan.active} disabled={busy} onCheckedChange={(v) => onSave({ active: v })} />
        {plan.active ? t("adm.money.planActive") : t("adm.money.planInactive")}
      </label>
    </div>
  );
}
