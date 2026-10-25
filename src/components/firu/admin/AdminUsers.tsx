"use client";

// T4-d — Admin users view ("Usuarios").
// Payout queue (mark paid / cancel) at the top, CSV export row,
// and the full user directory with role/status filters.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { springSmooth } from "@/lib/firu/motion";
import {
  Banknote,
  Download,
  Search,
  ShieldCheck,
  Users as UsersIcon,
  Wallet,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { api, qk } from "@/lib/firu/api";
import type { PayoutDTO, SessionUserDTO } from "@/lib/firu/types";
import { formatBOB } from "@/lib/firu/money";
import { fmtDateShort, fmtRelative } from "@/lib/firu/dates";
import { useT, srvErr } from "@/lib/firu/i18n";
import {
  Avatar,
  EmptyState,
  SectionHeader,
  StatusBadge,
} from "@/components/firu/shared/bits";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/** Payouts carry additive walkerId/walkerName in the admin list payload. */
type AdminPayoutDTO = PayoutDTO & { walkerId?: string; walkerName?: string | null };

/** SessionUserDTO now ships createdAt (additive); keep the superset defensive. */
type AdminUserDTO = SessionUserDTO & { createdAt?: string };

const ROLE_OPTIONS = [
  { value: "ALL", key: "adm.usr.roleAll" },
  { value: "OWNER", key: "adm.usr.roleOwners" },
  { value: "WALKER", key: "adm.usr.roleWalkers" },
  { value: "ADMIN", key: "adm.usr.roleAdmin" },
] as const;

const EXPORTS = [
  { type: "bookings", key: "adm.usr.exportBookings" },
  { type: "walkers", key: "adm.usr.exportWalkers" },
  { type: "ledger", key: "adm.usr.exportLedger" },
  { type: "payouts", key: "adm.usr.exportPayouts" },
] as const;

const ROLE_CHIP: Record<string, { key: string; cls: string }> = {
  OWNER: { key: "shell.role.owner", cls: "bg-brand-soft text-primary border-primary/30" },
  WALKER: { key: "shell.role.walker", cls: "bg-sun-soft text-amber-700 border-amber-300 dark:bg-sun-soft dark:text-amber-400 dark:border-amber-800" },
  ADMIN: { key: "adm.usr.roleAdmin", cls: "bg-secondary text-secondary-foreground border-border" },
};

const METHOD_LABEL: Record<string, string> = {
  QR: "adm.pay.qr",
  BANK: "adm.pay.bank",
};

/* ------------------------------ payout card ----------------------------- */

function PayoutCard({
  p,
  busy,
  onPaid,
  onCancel,
}: {
  p: AdminPayoutDTO;
  busy: boolean;
  onPaid: (p: AdminPayoutDTO) => void;
  onCancel: (p: AdminPayoutDTO) => void;
}) {
  const { t } = useT();
  const methodKey = METHOD_LABEL[p.method];
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springSmooth}
      layout
      className="rounded-2xl border border-primary/30 bg-brand-soft overflow-hidden"
    >
      <CardContent className="flex flex-wrap items-center gap-3">
        <span className="grid place-items-center size-11 rounded-2xl bg-primary text-primary-foreground shrink-0">
          <Wallet className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="font-extrabold leading-tight">{p.walkerName ?? t("adm.usr.walkerFallback")}</p>
          <p className="text-xs text-muted-foreground font-semibold">
            {methodKey ? t(methodKey) : p.method}
            {t("adm.usr.payoutMeta", { ago: fmtRelative(p.requestedAt) })}
          </p>
        </div>
        <p className="text-2xl font-black tabular-nums ml-auto">{formatBOB(p.amountCents)}</p>
        <div className="flex gap-2 w-full sm:w-auto">
          <Button size="sm" className="rounded-full flex-1 sm:flex-none" disabled={busy} onClick={() => onPaid(p)}>
            <Banknote className="size-4" /> {t("adm.usr.markPaid")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="rounded-full text-destructive border-destructive/40 hover:bg-destructive/10 flex-1 sm:flex-none"
            disabled={busy}
            onClick={() => onCancel(p)}
          >
            <XCircle className="size-4" /> {t("c.cancel")}
          </Button>
        </div>
      </CardContent>
    </motion.div>
  );
}

/* ================================= view ================================= */

export function AdminUsers() {
  const { toast } = useToast();
  const { t } = useT();
  const qc = useQueryClient();
  const [role, setRole] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [cancelTarget, setCancelTarget] = useState<AdminPayoutDTO | null>(null);
  const [pendingPayoutId, setPendingPayoutId] = useState<string | null>(null);

  const { data: payouts, isLoading: payoutsLoading } = useQuery({
    queryKey: qk.payouts,
    queryFn: () => api.get<AdminPayoutDTO[]>("/api/payouts"),
  });
  const { data: users, isLoading } = useQuery({
    queryKey: qk.adminUsers,
    queryFn: () => api.get<AdminUserDTO[]>("/api/admin/users"),
  });

  const payoutAct = useMutation({
    mutationFn: (v: { id: string; action: "paid" | "cancel" }) =>
      api.patch(`/api/payouts/${v.id}`, { action: v.action }),
    onMutate: (v) => setPendingPayoutId(v.id),
    onSuccess: (_d, v) => {
      setPendingPayoutId(null);
      toast({
        title: v.action === "paid" ? t("adm.usr.paidToast") : t("adm.usr.cancelToast"),
        description:
          v.action === "paid" ? t("adm.usr.paidToastDesc") : t("adm.usr.cancelToastDesc"),
      });
      qc.invalidateQueries({ queryKey: qk.payouts });
      qc.invalidateQueries({ queryKey: qk.adminMetrics });
      qc.invalidateQueries({ queryKey: ["wallet"] });
      qc.invalidateQueries({ queryKey: qk.payments });
    },
    onError: (err: Error) => {
      setPendingPayoutId(null);
      toast({ title: t("adm.usr.errPayout"), description: srvErr(err.message), variant: "destructive" });
    },
  });

  const requestedPayouts = (payouts ?? []).filter((p) => p.status === "REQUESTED");

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (users ?? []).filter((u) => {
      if (role !== "ALL" && u.role !== role) return false;
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        u.phone.toLowerCase().includes(q) ||
        (u.zoneName ?? "").toLowerCase().includes(q)
      );
    });
  }, [users, role, search]);

  return (
    <div className="space-y-6">
      <SectionHeader
        title={t("adm.usr.title")}
        subtitle={
          requestedPayouts.length === 1
            ? t("adm.usr.subtitle.one", { accounts: users?.length ?? 0, count: requestedPayouts.length })
            : t("adm.usr.subtitle.many", { accounts: users?.length ?? 0, count: requestedPayouts.length })
        }
      />

      {/* Pending payouts */}
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-muted-foreground">
          <Wallet className="size-4" /> {t("adm.usr.pendingPayouts")}
        </h3>
        {payoutsLoading ? (
          <Skeleton className="h-20 rounded-2xl" />
        ) : requestedPayouts.length === 0 ? (
          <div className="rounded-2xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
            {t("adm.usr.noPayouts")}
          </div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {requestedPayouts.map((p) => (
              <PayoutCard
                key={p.id}
                p={p}
                busy={pendingPayoutId === p.id || payoutAct.isPending}
                onPaid={(pp) => payoutAct.mutate({ id: pp.id, action: "paid" })}
                onCancel={setCancelTarget}
              />
            ))}
          </div>
        )}
      </section>

      {/* Exports */}
      <section className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-black uppercase tracking-wide text-muted-foreground">
          <Download className="size-4" /> {t("adm.exportCsv")}
        </span>
        {EXPORTS.map((e) => (
          <Button
            key={e.type}
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={() => window.open(`/api/admin/export?type=${e.type}`, "_blank")}
          >
            {t(e.key)}
          </Button>
        ))}
      </section>

      {/* Users table */}
      <section className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="w-44 rounded-full">
              <SelectValue placeholder={t("adm.usr.role")} />
            </SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {t(o.key)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative flex-1 min-w-52">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("adm.usr.searchPh")}
              className="rounded-full pl-9"
            />
          </div>
        </div>

        {isLoading ? (
          <Skeleton className="h-96 rounded-2xl" />
        ) : filteredUsers.length === 0 ? (
          <EmptyState
            icon={UsersIcon}
            title={t("adm.usr.empty")}
            description={t("adm.usr.emptyDesc")}
          />
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springSmooth, delay: 0.05 }}
            className="max-h-[70vh] overflow-auto rounded-2xl border bg-card"
          >
            <table className="w-full caption-bottom text-sm">
              <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--color-border)]">
                <TableRow>
                  <TableHead className="pl-4">{t("adm.usr.th.user")}</TableHead>
                  <TableHead>{t("adm.usr.role")}</TableHead>
                  <TableHead>{t("adm.usr.th.phone")}</TableHead>
                  <TableHead>{t("adm.zone")}</TableHead>
                  <TableHead>{t("adm.usr.th.created")}</TableHead>
                  <TableHead className="pr-4">{t("adm.usr.th.walkerStatus")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="pl-4">
                      <span className="flex items-center gap-2.5">
                        <Avatar src={u.avatarUrl} name={u.name} size="sm" />
                        <span className="font-bold">{u.name}</span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold",
                          ROLE_CHIP[u.role]?.cls ?? "bg-muted text-muted-foreground border-border"
                        )}
                      >
                        {u.role === "ADMIN" && <ShieldCheck className="size-3 mr-0.5" />}
                        {ROLE_CHIP[u.role] ? t(ROLE_CHIP[u.role].key) : u.role}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{u.phone}</TableCell>
                    <TableCell className="text-muted-foreground">{u.zoneName ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {fmtDateShort(u.createdAt ?? u.walker?.appliedAt ?? null)}
                    </TableCell>
                    <TableCell className="pr-4">
                      {u.walker ? (
                        <StatusBadge status={u.walker.status} kind="walker" />
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </motion.div>
        )}
      </section>

      {/* Cancel payout confirmation */}
      <AlertDialog open={!!cancelTarget} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("adm.usr.cancelTitle", {
                name: cancelTarget?.walkerName ?? t("adm.usr.thisWalker"),
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("adm.usr.cancelDesc", { amount: formatBOB(cancelTarget?.amountCents ?? 0) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">{t("adm.back")}</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-destructive text-white hover:bg-destructive/90"
              disabled={payoutAct.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (!cancelTarget) return;
                payoutAct.mutate({ id: cancelTarget.id, action: "cancel" });
                setCancelTarget(null);
              }}
            >
              <XCircle className="size-4" /> {t("adm.usr.cancelPayout")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
