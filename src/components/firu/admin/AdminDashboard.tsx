"use client";

// T4-d — Admin operations dashboard ("Panel").
// KPI row, service quality bars, retention north-star, supply vs demand
// per zone, 14-day booking trend, and the ops alert queue. Polls every 30s.

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { springSmooth } from "@/lib/firu/motion";
import {
  Activity,
  CalendarRange,
  ClipboardList,
  Dog,
  Footprints,
  HandCoins,
  PawPrint,
  ShieldAlert,
  Users,
  Wallet,
} from "lucide-react";
import { Area, AreaChart, XAxis, YAxis } from "recharts";
import { api, qk } from "@/lib/firu/api";
import { useFiruSession } from "@/lib/firu/session";
import type { AdminMetricsDTO, PayoutDTO } from "@/lib/firu/types";
import { formatBOB } from "@/lib/firu/money";
import { monthsShort } from "@/lib/firu/dates";
import { useT, getLang, type Lang } from "@/lib/firu/i18n";
import { RatingStars, SectionHeader } from "@/components/firu/shared/bits";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";

// Trend tick labels ("YYYY-MM-DD" keys come from the API as Bolivia-local
// dates, so we format straight from the string — no TZ math). Month names
// follow the active language via monthsShort(lang).
const trendLabel = (key: string, lang: Lang) => {
  const [, m, d] = key.split("-");
  return `${Number(d)} ${monthsShort(lang)[(Number(m) || 1) - 1]}`;
};

// es-BO keeps the decimal comma; en gets a decimal point.
const decSep = () => (getLang() === "en" ? "." : ",");
const fmtPct = (n: number) => `${n.toFixed(1).replace(".", decSep())}%`;
const fmtRatio = (n: number) => n.toFixed(1).replace(".", decSep());

/* --------------------------- loading state --------------------------- */

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-2xl lg:col-span-2" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
      <Skeleton className="h-56 rounded-2xl" />
    </div>
  );
}

/* ------------------------------ KPI card ----------------------------- */

function Kpi({
  icon: Icon,
  value,
  label,
  tone = "default",
  onClick,
}: {
  icon: React.ElementType;
  value: string;
  label: string;
  tone?: "default" | "amber" | "green";
  onClick?: () => void;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "rounded-2xl border bg-card p-4 flex flex-col gap-2 transition-[box-shadow,transform] duration-200 ease-out-expo",
        onClick && "cursor-pointer hover:shadow-raise hover:-translate-y-0.5 active:scale-[0.98]",
        tone === "amber" && "border-amber-300 bg-sun-soft dark:border-amber-800",
        tone === "green" && "border-primary/30 bg-brand-soft"
      )}
    >
      <span
        className={cn(
          "grid place-items-center size-8 rounded-xl",
          tone === "amber"
            ? "bg-sun text-foreground"
            : tone === "green"
              ? "bg-primary text-primary-foreground"
              : "bg-brand-soft text-primary"
        )}
      >
        <Icon className="size-4" />
      </span>
      <div>
        <p className="text-2xl font-black tracking-tight leading-none">{value}</p>
        <p className="text-xs text-muted-foreground font-semibold mt-1">{label}</p>
      </div>
    </div>
  );
}

/* ---------------------------- quality bar ---------------------------- */

function QualityRow({
  label,
  pct,
  tone,
}: {
  label: string;
  pct: number;
  tone: "good" | "warn" | "bad";
}) {
  const bar = tone === "good" ? "bg-primary" : tone === "warn" ? "bg-sun" : "bg-destructive";
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-sm font-black tabular-nums">{fmtPct(pct)}</span>
      </div>
      <div className="h-2 rounded-full bg-secondary overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-[width] duration-500 ease-out-expo", bar)}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </div>
  );
}

/* ------------------------------ alerts ------------------------------- */

function AlertCard({
  tone,
  icon: Icon,
  title,
  description,
  onClick,
}: {
  tone: "red" | "amber" | "brand";
  icon: React.ElementType;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-start gap-3 rounded-2xl border p-4 text-left transition-[box-shadow,transform] duration-200 ease-out-expo hover:shadow-raise hover:-translate-y-0.5 active:scale-[0.98]",
        tone === "red" && "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40",
        tone === "amber" && "border-amber-300 bg-sun-soft dark:border-amber-800",
        tone === "brand" && "border-primary/30 bg-brand-soft"
      )}
    >
      <span
        className={cn(
          "grid place-items-center size-9 rounded-xl shrink-0",
          tone === "red" && "bg-red-500 text-white dark:bg-red-900",
          tone === "amber" && "bg-sun text-foreground",
          tone === "brand" && "bg-primary text-primary-foreground"
        )}
      >
        <Icon className="size-4.5" />
      </span>
      <span className="min-w-0">
        <span className="block font-extrabold text-sm">{title}</span>
        <span className="block text-xs text-muted-foreground leading-snug mt-0.5">{description}</span>
      </span>
    </button>
  );
}

/* ------------------------------ supply ------------------------------- */

function supplyChip(walkers: number, demandWalks: number, t: (key: string) => string) {
  if (walkers === 0) return { label: t("adm.dash.supplyLow"), ratio: "—", red: true };
  const ratio = demandWalks / walkers;
  if (ratio > 8) return { label: t("adm.dash.supplyLow"), ratio: fmtRatio(ratio), red: true };
  return { label: t("adm.dash.covered"), ratio: fmtRatio(ratio), red: false };
}

/* ============================== view ================================ */

export function AdminDashboard() {
  const setAdminView = useFiruSession((s) => s.setAdminView);
  const { t, lang } = useT();

  const chartConfig = {
    bookings: { label: t("adm.dash.chart"), color: "var(--chart-1)" },
  } satisfies ChartConfig;
  const { data: m, isLoading } = useQuery({
    queryKey: qk.adminMetrics,
    queryFn: () => api.get<AdminMetricsDTO>("/api/admin/metrics"),
    refetchInterval: 30_000,
  });
  // payouts are surfaced as an ops alert (admin sees all requests)
  const { data: payouts } = useQuery({
    queryKey: qk.payouts,
    queryFn: () => api.get<PayoutDTO[]>("/api/payouts"),
    refetchInterval: 30_000,
  });

  if (isLoading || !m) return <DashboardSkeleton />;

  const pendingPayouts = (payouts ?? []).filter((p) => p.status === "REQUESTED");
  const hasAlerts = m.recentDisputes > 0 || m.totals.pendingWalkers > 0 || pendingPayouts.length > 0;

  return (
    <div className="space-y-6">
      <SectionHeader
        title={t("adm.dash.title")}
        subtitle={t("adm.dash.subtitle")}
      />

      {/* Alert queue */}
      {hasAlerts && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springSmooth}
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        >
          {m.recentDisputes > 0 && (
            <AlertCard
              tone="red"
              icon={ShieldAlert}
              title={
                m.recentDisputes === 1
                  ? t("adm.dash.alertDisputes.one", { count: m.recentDisputes })
                  : t("adm.dash.alertDisputes.many", { count: m.recentDisputes })
              }
              description={t("adm.dash.alertDisputesDesc")}
              onClick={() => setAdminView("disputes")}
            />
          )}
          {m.totals.pendingWalkers > 0 && (
            <AlertCard
              tone="amber"
              icon={ClipboardList}
              title={
                m.totals.pendingWalkers === 1
                  ? t("adm.dash.alertApps.one", { count: m.totals.pendingWalkers })
                  : t("adm.dash.alertApps.many", { count: m.totals.pendingWalkers })
              }
              description={t("adm.dash.alertAppsDesc")}
              onClick={() => setAdminView("applications")}
            />
          )}
          {pendingPayouts.length > 0 && (
            <AlertCard
              tone="brand"
              icon={Wallet}
              title={
                pendingPayouts.length === 1
                  ? t("adm.dash.alertPayouts.one", { count: pendingPayouts.length })
                  : t("adm.dash.alertPayouts.many", { count: pendingPayouts.length })
              }
              description={t("adm.dash.alertPayoutsDesc", {
                amount: formatBOB(pendingPayouts.reduce((s, p) => s + p.amountCents, 0)),
              })}
              onClick={() => setAdminView("users")}
            />
          )}
        </motion.div>
      )}

      {/* KPI row */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springSmooth, delay: 0.05 }}
        className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3"
      >
        <Kpi icon={Users} value={String(m.totals.owners)} label={t("adm.owners")} />
        <Kpi
          icon={Footprints}
          value={String(m.totals.walkers)}
          label={t("adm.walkers")}
          tone="green"
        />
        <Kpi
          icon={ClipboardList}
          value={String(m.totals.pendingWalkers)}
          label={t("adm.dash.kpi.pendingApps")}
          tone={m.totals.pendingWalkers > 0 ? "amber" : "default"}
          onClick={m.totals.pendingWalkers > 0 ? () => setAdminView("applications") : undefined}
        />
        <Kpi icon={Dog} value={String(m.totals.dogs)} label={t("adm.dash.kpi.dogs")} />
        <Kpi
          icon={CalendarRange}
          value={formatBOB(m.totals.gmvMonthCents)}
          label={t("adm.dash.kpi.gmv")}
        />
        <Kpi
          icon={HandCoins}
          value={formatBOB(m.totals.revenueMonthCents)}
          label={t("adm.dash.kpi.revenue")}
        />
      </motion.div>

      {/* Quality + retention */}
      <div className="grid gap-4 lg:grid-cols-3">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springSmooth, delay: 0.1 }}
          className="lg:col-span-2"
        >
          <Card className="rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="size-4 text-primary" /> {t("adm.dash.quality")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <QualityRow label={t("adm.dash.q.completion")} pct={m.quality.completionPct} tone="good" />
              <QualityRow label={t("adm.dash.q.noShow")} pct={m.quality.noShowPct} tone="bad" />
              <QualityRow label={t("adm.dash.q.cancelOwner")} pct={m.quality.cancelByOwnerPct} tone="warn" />
              <QualityRow label={t("adm.dash.q.cancelWalker")} pct={m.quality.cancelByWalkerPct} tone="bad" />
              <QualityRow label={t("adm.dash.q.disputeRate")} pct={m.quality.disputeRatePct} tone="bad" />
              <div className="flex items-center justify-between pt-1 border-t">
                <span className="text-sm font-semibold">{t("adm.dash.q.avgRating")}</span>
                <RatingStars rating={m.quality.avgRating} size="md" />
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springSmooth, delay: 0.15 }}
        >
          <Card className="rounded-2xl h-full bg-brand-soft border-primary/30">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <PawPrint className="size-4 text-primary" /> {t("adm.dash.retention")}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col h-[calc(100%-4.5rem)]">
              <div className="flex items-center gap-3">
                <span className="grid place-items-center size-14 rounded-2xl bg-primary text-primary-foreground shrink-0">
                  <PawPrint className="size-7" />
                </span>
                <div>
                  <p className="text-5xl font-black text-primary leading-none tracking-tight">
                    {fmtPct(m.retention.recurringSharePct)}
                  </p>
                  <p className="text-sm font-bold mt-1">{t("adm.dash.recurringShare")}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mt-4">
                {t("adm.dash.retentionDesc")}
              </p>
              <div className="mt-auto pt-4">
                <div className="rounded-xl bg-background/70 border border-primary/20 px-3 py-2.5">
                  <p className="text-xs text-muted-foreground font-semibold">{t("adm.dash.repeatOwners")}</p>
                  <p className="text-xl font-black">{m.retention.ownersWithRepeatBooking}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Supply vs demand per zone + trend — grid items get min-w-0 so the
          zone table's min-content width can't stretch the mobile viewport */}
      <div className="grid gap-4 lg:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springSmooth, delay: 0.2 }}
          className="min-w-0"
        >
          <Card className="rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("adm.dash.supply")}</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <div className="max-h-80 overflow-auto rounded-b-2xl">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      <TableHead className="pl-4">{t("adm.zone")}</TableHead>
                      <TableHead className="text-right">{t("adm.walkers")}</TableHead>
                      <TableHead className="text-right">{t("adm.dash.th.demand")}</TableHead>
                      <TableHead className="pr-4 text-right">{t("adm.dash.th.ratio")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {m.supplyPerZone.map((z) => {
                      const chip = supplyChip(z.walkers, z.demandWalks, t);
                      return (
                        <TableRow key={z.zoneId}>
                          <TableCell className="pl-4 font-bold">{z.zoneName}</TableCell>
                          <TableCell className="text-right tabular-nums">{z.walkers}</TableCell>
                          <TableCell className="text-right tabular-nums">{z.demandWalks}</TableCell>
                          <TableCell className="pr-4 text-right">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap",
                                chip.red
                                  ? "bg-red-50 text-red-700 border-red-300 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800"
                                  : "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800"
                              )}
                            >
                              {chip.ratio} · {chip.label}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springSmooth, delay: 0.25 }}
          className="min-w-0"
        >
          <Card className="rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("adm.dash.trend")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig} className="h-56 w-full">
                <AreaChart data={m.bookingsTrend} margin={{ left: -18, right: 6, top: 6 }}>
                  <defs>
                    <linearGradient id="fillTrend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-bookings)" stopOpacity={0.7} />
                      <stop offset="95%" stopColor="var(--color-bookings)" stopOpacity={0.06} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    minTickGap={26}
                    tickFormatter={(k: string) => trendLabel(k, lang)}
                  />
                  <YAxis allowDecimals={false} width={30} tickLine={false} axisLine={false} />
                  <ChartTooltip
                    cursor={{ stroke: "var(--color-bookings)", strokeOpacity: 0.3 }}
                    content={
                      <ChartTooltipContent
                        labelFormatter={(label) => trendLabel(String(label), lang)}
                        indicator="dot"
                      />
                    }
                  />
                  <Area
                    dataKey="count"
                    type="monotone"
                    stroke="var(--color-bookings)"
                    strokeWidth={2.5}
                    fill="url(#fillTrend)"
                  />
                </AreaChart>
              </ChartContainer>
              <p className="text-xs text-muted-foreground text-center mt-1">
                {t("adm.dash.trendTotal", {
                  bookings: m.totals.bookings,
                  walks: m.totals.completedWalks,
                })}
              </p>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
