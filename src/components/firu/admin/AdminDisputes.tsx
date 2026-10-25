"use client";

// T4-d — Admin dispute queue ("Casos").
// OPEN cases first (red accent) with a resolve dialog supporting refund /
// credit / dismiss + resolution note; resolved cases render muted below.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { springSmooth } from "@/lib/firu/motion";
import { CircleCheckBig, Gavel, Quote, ShieldAlert, Undo2 } from "lucide-react";
import { useState } from "react";
import { api, qk } from "@/lib/firu/api";
import type { AppConfig, DisputeDTO } from "@/lib/firu/types";
import { formatBOB, parseBOB } from "@/lib/firu/money";
import { fmtRelative } from "@/lib/firu/dates";
import { useT, getLang, srvErr } from "@/lib/firu/i18n";
import { Avatar, EmptyState, SectionHeader, StatusBadge } from "@/components/firu/shared/bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const REASON_LABEL: Record<string, string> = {
  LATE: "adm.dis.reason.late",
  NO_SHOW: "adm.dis.reason.noShow",
  QUALITY: "adm.dis.reason.quality",
  SAFETY: "adm.dis.reason.safety",
  BILLING: "adm.dis.reason.billing",
  OTHER: "adm.dis.reason.other",
};

/** Bs text for a cents amount, edit-friendly (es "7,50" / en "7.50"). */
const bsText = (cents: number) =>
  (cents / 100).toFixed(2).replace(".", getLang() === "en" ? "." : ",");

/* ------------------------------ dispute card ----------------------------- */

function DisputeCard({
  d,
  onResolve,
}: {
  d: DisputeDTO;
  onResolve: (d: DisputeDTO) => void;
}) {
  const { t } = useT();
  const isOpen = d.status === "OPEN";
  const ctx = d.booking;
  const reasonKey = REASON_LABEL[d.reason];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springSmooth}
      layout
    >
      <Card
        className={cn(
          "rounded-2xl border-l-4 overflow-hidden",
          isOpen
            ? "border-l-red-500 dark:border-l-red-400"
            : "border-l-border opacity-90"
        )}
      >
        <CardContent className="space-y-3">
          {/* Header */}
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold",
                isOpen
                  ? "bg-red-50 text-red-700 border-red-300 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800"
                  : "bg-muted text-muted-foreground border-border"
              )}
            >
              {reasonKey ? t(reasonKey) : d.reason}
            </span>
            <StatusBadge status={d.status} kind="dispute" />
            <span className="text-xs text-muted-foreground font-semibold ml-auto">
              {t("adm.dis.openAgo", { ago: fmtRelative(d.createdAt) })}
            </span>
          </div>

          {/* Parties + booking context */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Avatar src={d.openedBy.avatarUrl} name={d.openedBy.name} size="sm" />
            <span className="font-extrabold">{d.openedBy.name}</span>
            <span className="text-muted-foreground">vs</span>
            <Avatar src={d.against.avatarUrl} name={d.against.name} size="sm" />
            <span className="font-extrabold">{d.against.name}</span>
          </div>
          {ctx && (
            <p className="text-sm text-muted-foreground">
              {t("adm.dis.bookingPre")}<span className="font-bold text-foreground">{ctx.dogName}</span>
              {ctx.walkerName ? t("adm.dis.withWalker", { name: ctx.walkerName }) : ""} ·{" "}
              <span className="font-bold text-foreground">{formatBOB(ctx.pricePerWalkCents)}</span>{t("adm.dis.perWalk")}
            </p>
          )}

          {/* Owner's words */}
          <p className="text-sm border-l-2 border-primary/40 pl-3 leading-relaxed">
            <Quote className="inline size-3.5 text-muted-foreground mr-1 -mt-0.5" />
            {d.description}
          </p>

          {/* Resolution / footer */}
          {isOpen ? (
            <div className="flex justify-end pt-1">
              <Button size="sm" className="rounded-full" onClick={() => onResolve(d)}>
                <Gavel className="size-4" /> {t("adm.dis.resolve")}
              </Button>
            </div>
          ) : (
            <div className="rounded-xl bg-muted/60 px-3 py-2.5 space-y-1">
              <p className="text-xs text-muted-foreground font-bold uppercase tracking-wide">
                {t("adm.dis.resolution", { ago: fmtRelative(d.resolvedAt) })}
              </p>
              {d.resolution && <p className="text-sm leading-relaxed">«{d.resolution}»</p>}
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {d.refundCents > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-300 px-2 py-0.5 text-[11px] font-bold dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800">
                    <Undo2 className="size-3" /> {t("adm.dis.refundChip", { amount: formatBOB(d.refundCents) })}
                  </span>
                )}
                {d.creditCents > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full border bg-brand-soft text-primary border-primary/30 px-2 py-0.5 text-[11px] font-bold">
                    {t("adm.dis.creditChip", { amount: formatBOB(d.creditCents) })}
                  </span>
                )}
                {d.refundCents === 0 && d.creditCents === 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full border bg-muted text-muted-foreground border-border px-2 py-0.5 text-[11px] font-bold">
                    <CircleCheckBig className="size-3" /> {t("adm.dis.noMoney")}
                  </span>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ================================= view ================================= */

export function AdminDisputes() {
  const { toast } = useToast();
  const { t } = useT();
  const qc = useQueryClient();

  const { data: disputes, isLoading } = useQuery({
    queryKey: qk.disputes,
    queryFn: () => api.get<DisputeDTO[]>("/api/disputes"),
  });
  const { data: cfg } = useQuery({
    queryKey: qk.config,
    queryFn: () => api.get<AppConfig>("/api/config"),
  });

  // Resolve dialog state
  const [resolving, setResolving] = useState<DisputeDTO | null>(null);
  const [option, setOption] = useState<"refund" | "credit" | "dismiss">("refund");
  const [amount, setAmount] = useState("0,00");
  const [note, setNote] = useState("");

  const resolve = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown>; ownerName: string }) =>
      api.patch(`/api/disputes/${v.id}`, v.body),
    onSuccess: (_d, v) => {
      toast({
        title: t("adm.dis.resolvedToast"),
        description: t("adm.dis.notified", { name: v.ownerName }),
      });
      setResolving(null);
      // Money may have moved: refresh disputes, metrics, bookings, wallets, payments
      qc.invalidateQueries({ queryKey: qk.disputes });
      qc.invalidateQueries({ queryKey: qk.adminMetrics });
      qc.invalidateQueries({ queryKey: qk.adminBookings });
      qc.invalidateQueries({ queryKey: ["wallet"] });
      qc.invalidateQueries({ queryKey: qk.payments });
    },
    onError: (err: Error) => {
      toast({
        title: t("adm.dis.errResolve"),
        description: srvErr(err.message),
        variant: "destructive",
      });
    },
  });

  const list = [...(disputes ?? [])].sort(
    (a, b) => Number(a.status !== "OPEN") - Number(b.status !== "OPEN")
  );
  const openCount = list.filter((d) => d.status === "OPEN").length;

  const openResolve = (d: DisputeDTO) => {
    setResolving(d);
    setOption("refund");
    setNote("");
    // Default: 50% refund of the walk price
    setAmount(bsText(Math.round((d.booking?.pricePerWalkCents ?? 0) / 2)));
  };

  const changeOption = (v: string) => {
    const next = v as "refund" | "credit" | "dismiss";
    setOption(next);
    if (next === "refund") {
      setAmount(bsText(Math.round((resolving?.booking?.pricePerWalkCents ?? 0) / 2)));
    } else if (next === "credit") {
      setAmount(bsText(cfg?.policy.noShowCreditCents ?? 0));
    }
  };

  const confirmResolve = () => {
    if (!resolving) return;
    const cents = parseBOB(amount);
    if (option !== "dismiss" && cents <= 0) {
      toast({
        title: t("adm.dis.errAmount"),
        description: t("adm.dis.errAmountDesc"),
        variant: "destructive",
      });
      return;
    }
    const body: Record<string, unknown> = { action: option };
    if (option === "refund") body.refundCents = cents;
    if (option === "credit") body.creditCents = cents;
    if (note.trim()) body.resolution = note.trim();
    resolve.mutate({
      id: resolving.id,
      body,
      ownerName: resolving.booking?.ownerName ?? resolving.openedBy.name,
    });
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title={t("adm.dis.title")}
        subtitle={
          openCount === 1
            ? t("adm.dis.openCount.one", { count: openCount })
            : t("adm.dis.openCount.many", { count: openCount })
        }
      />

      {isLoading ? (
        <div className="grid gap-4">
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={ShieldAlert}
          title={t("adm.dis.empty")}
          description={t("adm.dis.emptyDesc")}
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {list.map((d) => (
            <DisputeCard key={d.id} d={d} onResolve={openResolve} />
          ))}
        </div>
      )}

      {/* Resolve dialog */}
      <Dialog open={!!resolving} onOpenChange={(open) => !open && setResolving(null)}>
        <DialogContent className="rounded-2xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("adm.dis.resolveTitle", { dog: resolving?.booking?.dogName ?? t("adm.dis.dispute") })}</DialogTitle>
            <DialogDescription>
              {resolving?.openedBy.name} vs {resolving?.against.name}
              {resolving?.booking
                ? t("adm.dis.walkPrice", { price: formatBOB(resolving.booking.pricePerWalkCents) })
                : ""}
              {t("adm.dis.bothNotified")}
            </DialogDescription>
          </DialogHeader>

          <RadioGroup value={option} onValueChange={changeOption} className="gap-3">
            {/* Refund */}
            <Label
              htmlFor="opt-refund"
              className="flex flex-col gap-2 rounded-2xl border p-3 cursor-pointer transition-[border-color,background-color,transform] duration-200 ease-out-expo active:scale-[0.99] has-[[data-state=checked]]:border-primary/60 has-[[data-state=checked]]:bg-brand-soft"
            >
              <span className="flex items-center gap-2">
                <RadioGroupItem id="opt-refund" value="refund" />
                <span className="font-extrabold text-sm">{t("adm.dis.refund")}</span>
              </span>
              <span className="text-xs text-muted-foreground leading-snug pl-6">
                {t("adm.dis.refundDesc")}
              </span>
              {option === "refund" && (
                <span className="pl-6 flex items-center gap-2">
                  <Input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-28 font-bold"
                    inputMode="decimal"
                    aria-label={t("adm.dis.refundAmount")}
                  />
                  <span className="text-xs text-muted-foreground font-bold">Bs</span>
                  <span className="text-xs text-muted-foreground">
                    {t("adm.dis.walkPriceShort", {
                      price: formatBOB(resolving?.booking?.pricePerWalkCents ?? 0),
                    })}
                  </span>
                </span>
              )}
            </Label>

            {/* Credit */}
            <Label
              htmlFor="opt-credit"
              className="flex flex-col gap-2 rounded-2xl border p-3 cursor-pointer transition-[border-color,background-color,transform] duration-200 ease-out-expo active:scale-[0.99] has-[[data-state=checked]]:border-primary/60 has-[[data-state=checked]]:bg-brand-soft"
            >
              <span className="flex items-center gap-2">
                <RadioGroupItem id="opt-credit" value="credit" />
                <span className="font-extrabold text-sm">{t("adm.dis.credit")}</span>
              </span>
              <span className="text-xs text-muted-foreground leading-snug pl-6">
                {t("adm.dis.creditDesc")}
              </span>
              {option === "credit" && (
                <span className="pl-6 flex items-center gap-2">
                  <Input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-28 font-bold"
                    inputMode="decimal"
                    aria-label={t("adm.dis.creditAmount")}
                  />
                  <span className="text-xs text-muted-foreground font-bold">Bs</span>
                  <span className="text-xs text-muted-foreground">
                    {t("adm.dis.configAmount", {
                      amount: formatBOB(cfg?.policy.noShowCreditCents ?? 0),
                    })}
                  </span>
                </span>
              )}
            </Label>

            {/* Dismiss */}
            <Label
              htmlFor="opt-dismiss"
              className="flex flex-col gap-2 rounded-2xl border p-3 cursor-pointer transition-[border-color,background-color,transform] duration-200 ease-out-expo active:scale-[0.99] has-[[data-state=checked]]:border-primary/60 has-[[data-state=checked]]:bg-brand-soft"
            >
              <span className="flex items-center gap-2">
                <RadioGroupItem id="opt-dismiss" value="dismiss" />
                <span className="font-extrabold text-sm">{t("adm.dis.dismiss")}</span>
              </span>
              <span className="text-xs text-muted-foreground leading-snug pl-6">
                {t("adm.dis.dismissDesc")}
              </span>
            </Label>
          </RadioGroup>

          <div>
            <Label htmlFor="resolution-note" className="text-xs font-bold text-muted-foreground">
              {t("adm.dis.noteLabel")}
            </Label>
            <Textarea
              id="resolution-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("adm.dis.notePh")}
              rows={2}
              maxLength={600}
              className="mt-1.5"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => setResolving(null)}
              disabled={resolve.isPending}
            >
              {t("adm.back")}
            </Button>
            <Button className="rounded-full" onClick={confirmResolve} disabled={resolve.isPending}>
              {resolve.isPending ? t("adm.dis.resolving") : t("adm.dis.confirmResolve")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
