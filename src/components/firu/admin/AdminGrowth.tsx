"use client";

// Admin → Panel → "Revisión semanal" (Phase 2 soft launch, LAUNCH_PLAN §6):
// the 8-week table, month-2/3 retention cohorts, acquisition channels,
// "Regalá un paseo" referrals (with void for fraud) and the leakage signal.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Gift, MapPinned, Megaphone, Repeat, TableProperties, TriangleAlert } from "lucide-react";
import { api } from "@/lib/firu/api";
import { fmtDateShort } from "@/lib/firu/dates";
import { formatBOB } from "@/lib/firu/money";
import { getLang, srvErr, useT } from "@/lib/firu/i18n";
import type { AdminReferralDTO, GrowthMetricsDTO } from "@/lib/firu/types";
import { SectionHeader } from "@/components/firu/shared/bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

const growthKey = ["admin", "metrics", "growth"] as const;
const referralsKey = ["admin", "referrals"] as const;

const dec = () => (getLang() === "en" ? "." : ",");
const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(1).replace(".", dec())}%`);
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", dec()));
/** "2026-11-09" → "9/11" */
const weekLabel = (k: string) => {
  const [, m, d] = k.split("-");
  return `${Number(d)}/${Number(m)}`;
};

type WeekRow = GrowthMetricsDTO["weeks"][number];

export function AdminGrowth() {
  const { t } = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: g, isLoading } = useQuery({
    queryKey: growthKey,
    queryFn: () => api.get<GrowthMetricsDTO>("/api/admin/metrics/growth"),
    refetchInterval: 120_000,
  });
  const { data: refs } = useQuery({
    queryKey: referralsKey,
    queryFn: () => api.get<AdminReferralDTO[]>("/api/admin/referrals"),
  });
  const voidRef = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.patch(`/api/admin/referrals/${id}`, { action: "void", reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: referralsKey });
      qc.invalidateQueries({ queryKey: growthKey });
    },
    onError: (e: Error) => toast({ title: t("adm.grow.voidErr"), description: srvErr(e.message), variant: "destructive" }),
  });

  if (isLoading || !g) return <Skeleton className="h-72 rounded-2xl" />;

  const rows: { label: string; hint?: string; value: (w: WeekRow) => string }[] = [
    { label: t("adm.grow.newOwners"), value: (w) => String(w.newOwners) },
    { label: t("adm.grow.activeOwners"), value: (w) => String(w.activeOwners) },
    { label: t("adm.grow.walks"), value: (w) => String(w.completedWalks) },
    { label: t("adm.grow.walksPerOwner"), value: (w) => num(w.walksPerActiveOwner) },
    { label: t("adm.grow.onTime", { min: g.onTimeMinutes }), value: (w) => pct(w.onTimePct) },
    { label: t("adm.grow.noShow"), value: (w) => pct(w.noShowPct) },
    { label: t("adm.grow.gmv"), value: (w) => formatBOB(w.gmvCents) },
    { label: t("adm.grow.revenue"), value: (w) => formatBOB(w.revenueCents) },
    { label: t("adm.grow.giftSpend"), value: (w) => formatBOB(w.giftSpendCents) },
    { label: t("adm.grow.contribution"), hint: t("adm.grow.contributionHint"), value: (w) => formatBOB(w.contributionPerWalkCents) },
    { label: t("adm.grow.refSignups"), value: (w) => String(w.referralSignups) },
    { label: t("adm.grow.refRewarded"), value: (w) => String(w.referralsRewarded) },
  ];

  const channelName = (c: string) => {
    const k = `adm.grow.ch.${c}`;
    const label = t(k);
    return label === k ? c : label;
  };

  return (
    <section className="space-y-4" aria-labelledby="growth-title">
      <SectionHeader title={t("adm.grow.title")} subtitle={t("adm.grow.subtitle")} />

      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle id="growth-title" className="text-base flex items-center gap-2">
            <TableProperties className="size-4 text-primary" /> {t("adm.grow.weekly")}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-card">{t("adm.grow.weekOf")}</TableHead>
                {g.weeks.map((w) => (
                  <TableHead key={w.weekStart} className="text-right tabular-nums">
                    {weekLabel(w.weekStart)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.label}>
                  <TableCell className="sticky left-0 bg-card font-semibold text-xs" title={r.hint}>
                    {r.label}
                  </TableCell>
                  {g.weeks.map((w) => (
                    <TableCell key={w.weekStart} className="text-right tabular-nums text-xs">
                      {r.value(w)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-2xl min-w-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Repeat className="size-4 text-primary" /> {t("adm.grow.cohorts")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t("adm.grow.cohortsHint")}</p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("adm.grow.month")}</TableHead>
                  <TableHead className="text-right">{t("adm.grow.owners")}</TableHead>
                  <TableHead className="text-right">{t("adm.grow.m2")}</TableHead>
                  <TableHead className="text-right">{t("adm.grow.m3")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {g.cohorts.map((c) => (
                  <TableRow key={c.month}>
                    <TableCell className="font-semibold tabular-nums">{c.month}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.owners}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.owners ? pct(c.m2Pct) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.owners ? pct(c.m3Pct) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="rounded-2xl min-w-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Megaphone className="size-4 text-primary" /> {t("adm.grow.channels")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t("adm.grow.channelsHint")}</p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("adm.grow.channel")}</TableHead>
                  <TableHead className="text-right">{t("adm.grow.owners")}</TableHead>
                  <TableHead className="text-right">{t("adm.grow.activated")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {g.channels.map((c) => (
                  <TableRow key={c.channel}>
                    <TableCell className="font-semibold">{channelName(c.channel)}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.owners}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.activated} · {pct(c.activationPct)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPinned className="size-4 text-primary" /> {t("adm.grow.zones")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{t("adm.grow.zonesHint", { pct: g.expandThresholdPct })}</p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("adm.grow.zone")}</TableHead>
                <TableHead className="text-right">{t("adm.grow.zoneWalkers")}</TableHead>
                <TableHead className="text-right">{t("adm.grow.zoneHours")}</TableHead>
                <TableHead className="text-right">{t("adm.grow.zoneUtil")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {g.zones.map((z) => (
                <TableRow key={z.zoneId}>
                  <TableCell className="font-semibold">
                    {z.zoneName}
                    {new Set(g.zones.map((x) => x.cityName)).size > 1 && (
                      <span className="ml-1 text-xs font-normal text-muted-foreground">· {z.cityName}</span>
                    )}
                    {z.readyToExpand && (
                      <Badge className="ml-2" variant="default">
                        {t("adm.grow.zoneFull")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{z.activeWalkers}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {num(Math.round(z.peakBookedMin / 6) / 10)} / {num(Math.round(z.peakCapacityMin / 6) / 10)} h
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {z.peakCapacityMin > 0 ? pct(z.peakUtilizationPct) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-2xl min-w-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Gift className="size-4 text-primary" /> {t("adm.grow.referrals")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {t("adm.grow.refSummary", {
                pending: g.referrals.pending,
                rewarded: g.referrals.rewarded,
                issued: g.referrals.giftWalksIssued,
                used: g.referrals.giftWalksUsed,
                cost: formatBOB(g.referrals.giftCostCents),
              })}
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {(refs ?? []).length === 0 && <p className="text-sm text-muted-foreground">{t("adm.grow.noReferrals")}</p>}
            {(refs ?? []).slice(0, 12).map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl border p-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold truncate">
                    {r.referrerName} → {r.refereeName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.code} · {fmtDateShort(r.createdAt)}
                    {r.voidReason ? ` · ${r.voidReason}` : ""}
                  </p>
                </div>
                <Badge variant={r.status === "REWARDED" ? "default" : r.status === "VOID" ? "destructive" : "secondary"}>
                  {t(`adm.grow.refStatus.${r.status}`)}
                </Badge>
                {r.status === "PENDING" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 rounded-full text-xs"
                    disabled={voidRef.isPending}
                    onClick={() => {
                      const reason = window.prompt(t("adm.grow.voidPrompt"));
                      if (reason?.trim()) voidRef.mutate({ id: r.id, reason: reason.trim() });
                    }}
                  >
                    <Ban className="size-3.5" /> {t("adm.grow.void")}
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-2xl min-w-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TriangleAlert className="size-4 text-amber-500" /> {t("adm.grow.leakage")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t("adm.grow.leakageHint", { days: g.leakQuietDays })}</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {g.leakage.length === 0 && <p className="text-sm text-muted-foreground">{t("adm.grow.noLeakage")}</p>}
            {g.leakage.map((l) => (
              <div key={l.ownerId} className="rounded-xl border p-2 text-sm">
                <p className="font-semibold">{l.ownerName}</p>
                <p className="text-xs text-muted-foreground">
                  {t("adm.grow.leakRow", {
                    walks: l.walks,
                    date: fmtDateShort(l.lastWalkAt),
                    walker: l.walkerName,
                    recent: l.walkerRecentWalks,
                  })}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
