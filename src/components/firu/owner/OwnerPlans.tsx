"use client";

// Owner → monthly plans: the active plan (walks left, period end) or the
// catalogue to buy one. Buying opens the payment sheet with the provider QR;
// the plan activates when the bank confirms the payment.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { CalendarCheck, Loader2, Ticket } from "lucide-react";
import { useState } from "react";
import { api, qk } from "@/lib/firu/api";
import { fmtDateShort } from "@/lib/firu/dates";
import { formatBOB } from "@/lib/firu/money";
import { springSmooth } from "@/lib/firu/motion";
import { srvErr, useT } from "@/lib/firu/i18n";
import type { PlanDTO, SubscriptionDTO } from "@/lib/firu/types";
import { SectionHeader } from "@/components/firu/shared/bits";
import { PaymentDialog } from "@/components/firu/shared/PaymentDialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";

export function OwnerPlans() {
  const { t } = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [checkout, setCheckout] = useState<SubscriptionDTO | null>(null);

  const { data: plans } = useQuery({
    queryKey: qk.plans,
    queryFn: () => api.get<PlanDTO[]>("/api/plans"),
  });
  const { data: subs } = useQuery({
    queryKey: qk.subscriptions,
    queryFn: () => api.get<SubscriptionDTO[]>("/api/subscriptions"),
  });

  const buy = useMutation({
    mutationFn: (planId: string) => api.post<SubscriptionDTO>("/api/subscriptions", { planId }),
    onSuccess: (s) => {
      setCheckout(s);
      qc.invalidateQueries({ queryKey: qk.subscriptions });
    },
    onError: (e: Error) =>
      toast({ title: t("own.plans.errTitle"), description: srvErr(e.message), variant: "destructive" }),
  });

  const active = (subs ?? []).filter((s) => s.status === "ACTIVE");
  if (!plans?.length && active.length === 0) return null;

  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={springSmooth}>
      <SectionHeader title={t("own.plans.title")} subtitle={t("own.plans.subtitle")} />

      {active.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {active.map((s) => (
            <div key={s.id} className="rounded-3xl border border-primary/30 bg-brand-soft/50 p-4 shadow-sm space-y-2">
              <p className="font-extrabold flex items-center gap-2">
                <Ticket className="size-4 text-primary" /> {s.plan.name}
              </p>
              <p className="text-sm">
                <strong className="text-2xl font-black text-primary tabular-nums">{s.walksLeft}</strong>{" "}
                {t("own.plans.left", { total: s.walksTotal, min: s.durationMin })}
              </p>
              <Progress value={(s.walksUsed / s.walksTotal) * 100} aria-label={t("own.plans.usedAria")} />
              {s.periodEnd && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <CalendarCheck className="size-3.5" /> {t("own.plans.until", { date: fmtDateShort(s.periodEnd) })}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(plans ?? []).map((p) => (
            <div key={p.id} className="rounded-3xl border bg-card p-4 shadow-sm flex flex-col gap-2">
              <p className="font-extrabold">{p.name}</p>
              <p className="text-sm text-muted-foreground">
                {t("own.plans.walks", { count: p.walks, min: p.durationMin, days: p.periodDays })}
              </p>
              <p className="text-2xl font-black text-primary tabular-nums">{formatBOB(p.totalCents)}</p>
              <p className="text-xs text-muted-foreground">
                {t("own.plans.perWalk", { amount: formatBOB(p.perWalkCents) })}
                {p.ownerFeeCents > 0 && ` · ${t("own.plans.inclFee", { amount: formatBOB(p.ownerFeeCents) })}`}
              </p>
              <Button
                className="rounded-full font-bold mt-auto"
                disabled={buy.isPending}
                onClick={() => buy.mutate(p.id)}
              >
                {buy.isPending && buy.variables === p.id && <Loader2 className="size-4 animate-spin" />}
                {t("own.plans.buy")}
              </Button>
            </div>
          ))}
        </div>
      )}

      {checkout && (
        <PaymentDialog
          open={!!checkout}
          onOpenChange={(v) => !v && setCheckout(null)}
          payment={checkout.payment}
          title={t("own.plans.payTitle", { name: checkout.plan.name })}
          description={t("own.plans.payDesc")}
        />
      )}
    </motion.section>
  );
}
