"use client";

// T4-d — Admin users view ("Usuarios").
// CSV export row and the full user directory with role/status filters and
// walker wallet balances (cash debt → record a deposit). Payouts moved to
// Admin → Pagos.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { springSmooth } from "@/lib/firu/motion";
import {
  Banknote,
  Download,
  Search,
  ShieldCheck,
  Users as UsersIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { api, qk } from "@/lib/firu/api";
import type { SessionUserDTO } from "@/lib/firu/types";
import { formatBOB, parseBOB } from "@/lib/firu/money";
import { fmtDateShort } from "@/lib/firu/dates";
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

/** SessionUserDTO now ships createdAt (additive); keep the superset defensive. */
type AdminUserDTO = SessionUserDTO & { createdAt?: string; walletCents?: number | null };

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

/* ================================= view ================================= */

export function AdminUsers() {
  const { toast } = useToast();
  const { t } = useT();
  const qc = useQueryClient();
  const [role, setRole] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [depositTarget, setDepositTarget] = useState<AdminUserDTO | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositRef, setDepositRef] = useState("");

  const { data: users, isLoading } = useQuery({
    queryKey: qk.adminUsers,
    queryFn: () => api.get<AdminUserDTO[]>("/api/admin/users"),
  });

  const deposit = useMutation({
    mutationFn: (v: { profileId: string; amountCents: number; reference: string }) =>
      api.post(`/api/admin/walkers/${v.profileId}/deposit`, { amountCents: v.amountCents, reference: v.reference }),
    onSuccess: () => {
      setDepositTarget(null);
      setDepositAmount("");
      setDepositRef("");
      toast({ title: t("adm.usr.depositToast") });
      qc.invalidateQueries({ queryKey: qk.adminUsers });
      qc.invalidateQueries({ queryKey: qk.adminRecon });
    },
    onError: (err: Error) =>
      toast({ title: t("adm.usr.depositErr"), description: srvErr(err.message), variant: "destructive" }),
  });

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
        subtitle={t("adm.usr.subtitle", { accounts: users?.length ?? 0 })}
      />

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
                  <TableHead>{t("adm.usr.th.walkerStatus")}</TableHead>
                  <TableHead className="pr-4 text-right">{t("adm.usr.th.wallet")}</TableHead>
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
                    <TableCell>
                      {u.walker ? (
                        <StatusBadge status={u.walker.status} kind="walker" />
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      {typeof u.walletCents === "number" ? (
                        <span className="inline-flex items-center gap-2 justify-end">
                          <span className={cn("font-bold tabular-nums", u.walletCents < 0 && "text-red-600 dark:text-red-400")}>
                            {formatBOB(u.walletCents)}
                          </span>
                          {u.walletCents < 0 && u.walker && (
                            <Button size="sm" variant="outline" className="rounded-full h-7" onClick={() => setDepositTarget(u)}>
                              <Banknote className="size-3.5" /> {t("adm.usr.deposit")}
                            </Button>
                          )}
                        </span>
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

      {/* Walker cash-debt deposit */}
      <AlertDialog open={!!depositTarget} onOpenChange={(open) => !open && setDepositTarget(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("adm.usr.depositTitle", { name: depositTarget?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("adm.usr.depositDesc", { debt: formatBOB(-(depositTarget?.walletCents ?? 0)) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <Input
              inputMode="decimal"
              placeholder={t("adm.usr.depositAmountPh")}
              aria-label={t("adm.usr.depositAmountPh")}
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
            />
            <Input
              placeholder={t("adm.usr.depositRefPh")}
              aria-label={t("adm.usr.depositRefPh")}
              value={depositRef}
              onChange={(e) => setDepositRef(e.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">{t("adm.back")}</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full"
              disabled={deposit.isPending || parseBOB(depositAmount) <= 0 || depositRef.trim().length < 3}
              onClick={(e) => {
                e.preventDefault();
                if (!depositTarget?.walker) return;
                deposit.mutate({
                  profileId: depositTarget.walker.id,
                  amountCents: parseBOB(depositAmount),
                  reference: depositRef.trim(),
                });
              }}
            >
              <Banknote className="size-4" /> {t("adm.usr.depositSave")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
