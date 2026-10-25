"use client";

// T4-d — Admin walker applications queue ("Solicitudes").
// Review pending applications (approve/reject) and manage the walker
// roster (suspend/reactivate). One shared mutation → toast + invalidations.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { springSmooth } from "@/lib/firu/motion";
import {
  BadgeCheck,
  Ban,
  ClipboardList,
  IdCard,
  MapPin,
  Phone,
  RefreshCw,
  ShieldOff,
  Star,
} from "lucide-react";
import { useState } from "react";
import { api, qk } from "@/lib/firu/api";
import type { WalkerProfileDTO } from "@/lib/firu/types";
import { fmtRating } from "@/lib/firu/money";
import { fmtRelative } from "@/lib/firu/dates";
import { useT, getLang, srvErr } from "@/lib/firu/i18n";
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
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/** WalkerProfileDTO + additive user fields sent by /api/admin/walkers. */
type AdminWalkerDTO = WalkerProfileDTO & {
  name: string;
  phone: string;
  avatarUrl?: string | null;
};

type TabKey = "PENDING" | "ACTIVE" | "SUSPENDED" | "ALL";

type ActVars = {
  id: string;
  action: "approve" | "reject" | "suspend" | "reactivate";
  reason?: string;
  name: string;
};

const TOAST_KEY: Record<string, string> = {
  approve: "adm.apps.toast.approve",
  reject: "adm.apps.toast.reject",
  suspend: "adm.apps.toast.suspend",
  reactivate: "adm.apps.toast.reactivate",
};

/* --------------------------- application card --------------------------- */

function WalkerCard({
  w,
  busy,
  onApprove,
  onReason,
  onReactivate,
}: {
  w: AdminWalkerDTO;
  busy: boolean;
  onApprove: (w: AdminWalkerDTO) => void;
  onReason: (w: AdminWalkerDTO, action: "reject" | "suspend") => void;
  onReactivate: (w: AdminWalkerDTO) => void;
}) {
  const { t } = useT();
  const isPending = w.status === "PENDING";
  const prices = [w.price30Cents, w.price45Cents, w.price60Cents]
    .map((c) => formatBOBShortLocal(c))
    .join(" / ");

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springSmooth}
      layout
    >
      <Card
        className={cn(
          "rounded-2xl overflow-hidden",
          isPending && "border-amber-300 dark:border-amber-800"
        )}
      >
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start gap-3">
            <Avatar src={w.selfieUrl ?? w.avatarUrl} name={w.name} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">{w.name}</CardTitle>
                <StatusBadge status={w.status} kind="walker" />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground font-semibold">
                <span className="inline-flex items-center gap-1">
                  <Phone className="size-3" /> {w.phone}
                </span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3" /> {w.zoneName ?? "—"}
                </span>
                <span className="inline-flex items-center gap-1">
                  <ClipboardList className="size-3" /> {t("adm.apps.appliedAgo", { ago: fmtRelative(w.appliedAt) })}
                </span>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm leading-relaxed">{w.bio}</p>

          <div className="grid gap-2 sm:grid-cols-2 text-xs">
            <div className="rounded-xl bg-secondary px-3 py-2">
              <span className="text-muted-foreground font-semibold">{t("adm.apps.experience")} · </span>
              <span className="font-bold">
                {w.experienceYears === 1
                  ? t("adm.apps.years.one", { count: w.experienceYears })
                  : t("adm.apps.years.many", { count: w.experienceYears })}
              </span>
            </div>
            <div className="rounded-xl bg-secondary px-3 py-2 flex items-center gap-1.5 min-w-0">
              <IdCard className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="font-bold truncate">{w.idDocNumber ?? t("adm.apps.noId")}</span>
            </div>
          </div>

          {w.referencesText && (
            <p className="text-xs text-muted-foreground italic border-l-2 border-primary/40 pl-3 leading-relaxed">
              «{w.referencesText}»
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="text-xs text-muted-foreground font-semibold">
              {t("adm.apps.prices")} <span className="font-bold text-foreground">Bs {prices}</span>
              {w.status === "ACTIVE" && (
                <span className="ml-2 inline-flex items-center gap-1 text-primary font-bold">
                  <Star className="size-3 fill-sun text-sun" />
                  {fmtRating(w.rating)} ·{" "}
                  {w.totalWalks === 1
                    ? t("adm.apps.walks.one", { count: w.totalWalks })
                    : t("adm.apps.walks.many", { count: w.totalWalks })}
                </span>
              )}
            </span>
            <div className="flex flex-wrap gap-2">
              {isPending && (
                <>
                  <Button
                    size="sm"
                    className="rounded-full"
                    disabled={busy}
                    onClick={() => onApprove(w)}
                  >
                    <BadgeCheck className="size-4" /> {t("adm.apps.approve")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full text-destructive border-destructive/40 hover:bg-destructive/10"
                    disabled={busy}
                    onClick={() => onReason(w, "reject")}
                  >
                    <Ban className="size-4" /> {t("adm.apps.reject")}
                  </Button>
                </>
              )}
              {w.status === "ACTIVE" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full text-destructive border-destructive/40 hover:bg-destructive/10"
                  disabled={busy}
                  onClick={() => onReason(w, "suspend")}
                >
                  <ShieldOff className="size-4" /> {t("adm.apps.suspend")}
                </Button>
              )}
              {w.status === "SUSPENDED" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  disabled={busy}
                  onClick={() => onReactivate(w)}
                >
                  <RefreshCw className="size-4" /> {t("adm.apps.reactivate")}
                </Button>
              )}
            </div>
          </div>

          {w.suspendedReason && (
            <p className="text-xs text-red-700 dark:text-red-400 font-semibold">
              {t("adm.apps.suspendReason", { reason: w.suspendedReason })}
            </p>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

/** Local short money ("15" from 1500 cents) — prices read compactly here. */
function formatBOBShortLocal(cents: number): string {
  return (cents / 100).toLocaleString(getLang() === "en" ? "en-US" : "es-BO", {
    maximumFractionDigits: 2,
  });
}

/* ================================ view ================================ */

export function AdminApplications() {
  const { toast } = useToast();
  const { t } = useT();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>("PENDING");

  const { data: walkers, isLoading } = useQuery({
    queryKey: qk.adminWalkers,
    queryFn: () => api.get<AdminWalkerDTO[]>("/api/admin/walkers"),
  });

  // Shared mutation for approve / reject / suspend / reactivate
  const [pendingId, setPendingId] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: (v: ActVars) =>
      api.patch(`/api/admin/walkers/${v.id}`, {
        action: v.action,
        ...(v.reason ? { reason: v.reason } : {}),
      }),
    onMutate: (v) => setPendingId(v.id),
    onSuccess: (_data, v) => {
      setPendingId(null);
      toast({
        title:
          v.action === "approve"
            ? `✅ ${v.name} ${t("adm.apps.toast.approve")}`
            : `${v.name} ${t(TOAST_KEY[v.action] ?? "")}`,
      });
      // Roster + marketplace listing + ops metrics + users table all shift
      qc.invalidateQueries({ queryKey: qk.adminWalkers });
      qc.invalidateQueries({ queryKey: qk.adminMetrics });
      qc.invalidateQueries({ queryKey: qk.adminUsers });
      qc.invalidateQueries({ queryKey: ["walkers"] });
    },
    onError: (err: Error, v: ActVars) => {
      setPendingId(null);
      toast({
        title:
          v.action === "approve"
            ? t("adm.apps.errApprove", { name: v.name })
            : t("adm.apps.errAction", { name: v.name }),
        description: srvErr(err.message),
        variant: "destructive",
      });
    },
  });

  // Dialogs state
  const [approveTarget, setApproveTarget] = useState<AdminWalkerDTO | null>(null);
  const [reasonTarget, setReasonTarget] = useState<{
    walker: AdminWalkerDTO;
    action: "reject" | "suspend";
  } | null>(null);
  const [reason, setReason] = useState("");

  const all = walkers ?? [];
  const counts = {
    PENDING: all.filter((w) => w.status === "PENDING").length,
    ACTIVE: all.filter((w) => w.status === "ACTIVE").length,
    SUSPENDED: all.filter((w) => w.status === "SUSPENDED").length,
    ALL: all.length,
  };
  const list =
    tab === "ALL"
      ? [...all].sort((a, b) => a.appliedAt.localeCompare(b.appliedAt))
      : all.filter((w) => w.status === tab);

  const openReason = (walker: AdminWalkerDTO, action: "reject" | "suspend") => {
    setReason("");
    setReasonTarget({ walker, action });
  };

  const confirmReason = () => {
    if (!reasonTarget) return;
    act.mutate({
      id: reasonTarget.walker.id,
      action: reasonTarget.action,
      reason: reason.trim() || undefined,
      name: reasonTarget.walker.name,
    });
    setReasonTarget(null);
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title={t("adm.apps.title")}
        subtitle={t("adm.apps.subtitle")}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList className="rounded-full h-auto p-1 flex-wrap">
          <TabsTrigger value="PENDING" className="rounded-full">
            {t("adm.apps.tab.pending")}
            <span className="ml-1.5 rounded-full bg-sun-soft px-1.5 text-[10px] font-black text-amber-700">
              {counts.PENDING}
            </span>
          </TabsTrigger>
          <TabsTrigger value="ACTIVE" className="rounded-full">
            {t("adm.apps.tab.active")} <span className="ml-1.5 text-[10px] font-black text-muted-foreground">{counts.ACTIVE}</span>
          </TabsTrigger>
          <TabsTrigger value="SUSPENDED" className="rounded-full">
            {t("adm.apps.tab.suspended")} <span className="ml-1.5 text-[10px] font-black text-muted-foreground">{counts.SUSPENDED}</span>
          </TabsTrigger>
          <TabsTrigger value="ALL" className="rounded-full">
            {t("adm.apps.tab.all")} <span className="ml-1.5 text-[10px] font-black text-muted-foreground">{counts.ALL}</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="grid gap-4">
          <Skeleton className="h-56 rounded-2xl" />
          <Skeleton className="h-56 rounded-2xl" />
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={
            tab === "PENDING"
              ? t("adm.apps.emptyPending")
              : tab === "SUSPENDED"
                ? t("adm.apps.emptySuspended")
                : t("adm.apps.emptyNone")
          }
          description={
            tab === "PENDING" ? t("adm.apps.emptyPendingDesc") : t("adm.apps.emptyDesc")
          }
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {list.map((w) => (
            <WalkerCard
              key={w.id}
              w={w}
              busy={pendingId === w.id || act.isPending}
              onApprove={setApproveTarget}
              onReason={openReason}
              onReactivate={(walker) =>
                act.mutate({ id: walker.id, action: "reactivate", name: walker.name })
              }
            />
          ))}
        </div>
      )}

      {/* Approve confirmation */}
      <AlertDialog
        open={!!approveTarget}
        onOpenChange={(open) => !open && setApproveTarget(null)}
      >
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("adm.apps.approveTitle", { name: approveTarget?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("adm.apps.approveDesc", {
                zone: approveTarget?.zoneName ?? t("adm.apps.theirZone"),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">{t("adm.back")}</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full"
              disabled={act.isPending}
              onClick={(e) => {
                e.preventDefault(); // keep the dialog open until mutation settles
                if (!approveTarget) return;
                act.mutate({
                  id: approveTarget.id,
                  action: "approve",
                  name: approveTarget.name,
                });
                setApproveTarget(null);
              }}
            >
              <BadgeCheck className="size-4" /> {t("adm.apps.approveCta")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reason prompt (reject / suspend) */}
      <Dialog open={!!reasonTarget} onOpenChange={(open) => !open && setReasonTarget(null)}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {reasonTarget?.action === "reject"
                ? t("adm.apps.rejectTitle", { name: reasonTarget?.walker.name ?? "" })
                : t("adm.apps.suspendTitle", { name: reasonTarget?.walker.name ?? "" })}
            </DialogTitle>
            <DialogDescription>
              {reasonTarget?.action === "reject"
                ? t("adm.apps.rejectDesc")
                : t("adm.apps.suspendDesc")}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              reasonTarget?.action === "reject" ? t("adm.apps.rejectPh") : t("adm.apps.suspendPh")
            }
            rows={3}
            maxLength={300}
          />
          <DialogFooter>
            <Button variant="outline" className="rounded-full" onClick={() => setReasonTarget(null)}>
              {t("c.cancel")}
            </Button>
            <Button
              variant="destructive"
              className="rounded-full"
              disabled={act.isPending}
              onClick={confirmReason}
            >
              {reasonTarget?.action === "reject" ? t("adm.apps.reject") : t("adm.apps.suspend")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
