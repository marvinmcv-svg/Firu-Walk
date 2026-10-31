"use client";

// The walker's live-walk cockpit (the money screen):
//   phase "pre"  — SCHEDULED briefing: dog/owner card, pickup notes + map, start
//   phase "live" — IN_PROGRESS: live GPS sim via socket, elapsed/distance stats,
//                  photo picker, editable report card, SOS, "Finalizar paseo"
//   phase "done" — celebration + earnings breakdown (price / 12% fee / net)

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  Camera,
  Flag,
  Footprints,
  Loader2,
  Lock,
  MapPin,
  PartyPopper,
  Siren,
  Wallet,
  X,
} from "lucide-react";
import { api, qk } from "@/lib/firu/api";
import { useFiruSession } from "@/lib/firu/session";
import { useT, srvErr } from "@/lib/firu/i18n";
import { formatBOB, fmtKm } from "@/lib/firu/money";
import { fmtTime } from "@/lib/firu/dates";
import type {
  AppConfig,
  BookingDTO,
  PartyDTO,
  PaymentDTO,
  ReportCardDTO,
  WalkDTO,
  ZoneDTO,
} from "@/lib/firu/types";
import { springSmooth } from "@/lib/firu/motion";
import { getSocket, joinLiveWalk, leaveLiveWalk, stopLiveWalkSim, type LivePoint } from "@/lib/firu/socket";
import {
  Avatar,
  EmptyState,
  StatusBadge,
  whatsappHref,
} from "@/components/firu/shared/bits";
import { WalkMap } from "@/components/firu/shared/WalkMap";
import { ReportCardView } from "@/components/firu/shared/ReportCardView";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/** WalkDTO + compact booking context (GET /api/walks shapes). */
interface WalkWithContext extends WalkDTO {
  booking: {
    id: string;
    status: string;
    type: string;
    owner: PartyDTO | null;
    walker: PartyDTO | null;
    zone: { id: string; name: string; key: string };
    pricePerWalkCents: number;
    durationMin: number;
    notes: string | null;
  } | null;
}

/** Walk detail adds start coords + parsed track (GET /api/walks/{id}). */
type WalkDetail = WalkWithContext & {
  track: [number, number][];
  startLat: number | null;
  startLng: number | null;
};

const START_WINDOW_MS = 60 * 60 * 1000;
const WALK_PHOTOS = ["/images/walks/walk-1.png", "/images/walks/walk-2.png", "/images/walks/walk-3.png"];

/** Re-render every second (ticking timers). */
function useTick(intervalMs = 1000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
}

export function ActiveWalkScreen() {
  const user = useFiruSession((s) => s.user);
  const setWalkerView = useFiruSession((s) => s.setWalkerView);
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useT();

  const [startedWalkId, setStartedWalkId] = useState<string | null>(null);
  const [finishedWalk, setFinishedWalk] = useState<WalkDetail | null>(null);
  // Payment snapshot AT FINISH TIME — after a recurring walk the booking gets a
  // fresh PENDING payment for the next occurrence, so the live query can no
  // longer tell us how THIS walk was settled.
  const [finishedPayment, setFinishedPayment] = useState<PaymentDTO | null>(null);
  const [points, setPoints] = useState<LivePoint[]>([]);
  const [photoPickerOpen, setPhotoPickerOpen] = useState(false);
  const [backOpen, setBackOpen] = useState(false);
  const [sosOpen, setSosOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [report, setReport] = useState<ReportCardDTO>({
    note: "",
    pee: false,
    poo: false,
    water: false,
    photos: [],
    createdAt: new Date().toISOString(),
  });
  const joinedRef = useRef<string | null>(null);

  // ---------------- data ----------------
  const { data: activeWalks, isLoading: loadingActive } = useQuery({
    queryKey: ["walks", "active"],
    queryFn: () => api.get<WalkWithContext[]>("/api/walks?scope=active"),
    refetchInterval: 10_000,
  });
  const { data: config } = useQuery({
    queryKey: qk.config,
    queryFn: () => api.get<AppConfig>("/api/config"),
  });
  const { data: bookings } = useQuery({
    queryKey: qk.bookings,
    queryFn: () => api.get<BookingDTO[]>("/api/bookings"),
    staleTime: 5_000,
  });
  const { data: zones } = useQuery({
    queryKey: qk.zones,
    queryFn: () => api.get<ZoneDTO[]>("/api/zones"),
  });

  const activeWalk = activeWalks?.[0] ?? null;
  // Fallback: most relevant SCHEDULED walk starting within the 60-min window
  // (from confirmed bookings — robust across the server's UTC-4 "today" cut).
  const candidate = useMemo(() => {
    const now = Date.now();
    return (bookings ?? [])
      .filter((b) => b.status === "CONFIRMED")
      .flatMap((b) => b.walks)
      .filter(
        (w) =>
          w.status === "SCHEDULED" &&
          new Date(w.scheduledStart).getTime() - now <= START_WINDOW_MS
      )
      .sort(
        (a, b) =>
          new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime()
      )[0];
  }, [bookings]);

  const phase: "none" | "pre" | "live" | "done" = finishedWalk
    ? "done"
    : activeWalk || startedWalkId
      ? "live"
      : candidate
        ? "pre"
        : "none";

  const walkId =
    finishedWalk?.id ?? activeWalk?.id ?? startedWalkId ?? candidate?.id ?? null;

  // Full walk detail (startLat/Lng for the map + sim origin). In the pre-start
  // phase the detail itself carries the dog + booking context for rendering.
  const { data: detail, isLoading: loadingDetail } = useQuery({
    queryKey: qk.walk(walkId ?? ""),
    queryFn: () => api.get<WalkDetail>(`/api/walks/${walkId}`),
    enabled: !!walkId,
    staleTime: 5_000,
  });

  // Render context: finished walk → live walk → candidate walk detail.
  const contextWalk: WalkWithContext | null =
    finishedWalk ?? activeWalk ?? detail ?? null;

  // Booking detail (payment method + pickup notes).
  const { data: booking, refetch: refetchBooking } = useQuery({
    queryKey: qk.booking(contextWalk?.bookingId ?? ""),
    queryFn: () => api.get<BookingDTO>(`/api/bookings/${contextWalk!.bookingId}`),
    enabled: !!contextWalk?.bookingId,
    staleTime: 5_000,
  });

  const dog = contextWalk?.dog ?? null;
  const owner = contextWalk?.booking?.owner ?? null;
  const zoneId = contextWalk?.booking?.zone.id ?? null;
  const zoneCenter = zones?.find((z) => z.id === zoneId) ?? null;
  const startLat = detail?.startLat ?? zoneCenter?.centerLat ?? -17.7833;
  const startLng = detail?.startLng ?? zoneCenter?.centerLng ?? -63.1821;
  const payment = booking?.payment ?? null;
  const isCash = payment?.method === "CASH";
  const commissionPct = config?.fees.commissionPct ?? 12;

  // ---------------- socket: live GPS sim ----------------
  const detailLoaded = !!detail;
  useEffect(() => {
    if (phase !== "live" || !walkId || !detailLoaded) return;
    // Join once per walk; walk:state resends full history for rejoinders.
    if (joinedRef.current === walkId) return;
    joinedRef.current = walkId;
    setPoints([]);
    joinLiveWalk({ walkId, startLat, startLng });
    return () => {
      leaveLiveWalk(walkId);
    };
  }, [phase, walkId, detailLoaded]);

  useEffect(() => {
    if (phase !== "live" || !walkId) return;
    const socket = getSocket();
    const onState = (p: { walkId: string; points: LivePoint[]; distMeters: number }) => {
      if (p.walkId !== walkId) return;
      setPoints(p.points ?? []);
    };
    const onPoint = (p: LivePoint & { walkId?: string }) => {
      if (p.walkId && p.walkId !== walkId) return;
      setPoints((prev) =>
        prev.length > 0 && prev[prev.length - 1].seq >= p.seq
          ? prev
          : [...prev, p]
      );
    };
    socket.on("walk:state", onState);
    socket.on("walk:point", onPoint);
    return () => {
      socket.off("walk:state", onState);
      socket.off("walk:point", onPoint);
    };
  }, [phase, walkId]);

  // ---------------- mutations ----------------
  const startMut = useMutation({
    mutationFn: () =>
      api.patch<WalkDetail>(`/api/walks/${walkId}`, {
        action: "start",
        lat: startLat,
        lng: startLng,
      }),
    onSuccess: (res) => {
      setStartedWalkId(res.id);
      qc.setQueryData(qk.walk(res.id), res);
      qc.invalidateQueries({ queryKey: ["walks"] });
      toast({
        title: t("wlk.walk.startOkTitle"),
        description: t("wlk.walk.startOkDescLive"),
      });
    },
    onError: (e: Error) =>
      toast({ title: t("wlk.walk.startErrTitle"), description: srvErr(e.message), variant: "destructive" }),
  });

  const finishMut = useMutation({
    mutationFn: async () => {
      // Snapshot the current walk's payment before settling (see note above).
      const paymentSnapshot = payment;
      // Stop the GPS sim BEFORE recording the final track.
      if (walkId) stopLiveWalkSim(walkId);
      const track = points.map((p) => [p.lat, p.lng] as [number, number]);
      const res = await api.patch<WalkDetail>(`/api/walks/${walkId}`, {
        action: "finish",
        ...(track.length > 0 ? { track } : {}),
        distanceMeters: points.length > 0 ? points[points.length - 1].distMeters : 0,
        report: {
          note: report.note,
          pee: report.pee,
          poo: report.poo,
          water: report.water,
          photos: report.photos,
        },
      });
      return { walk: res, paymentSnapshot };
    },
    onSuccess: ({ walk, paymentSnapshot }) => {
      setFinishedWalk(walk);
      setFinishedPayment(paymentSnapshot);
      setFinishOpen(false);
      qc.invalidateQueries({ queryKey: ["walks"] });
      qc.invalidateQueries({ queryKey: qk.bookings });
      qc.invalidateQueries({ queryKey: qk.wallet });
      refetchBooking();
      toast({
        title: t("wlk.walk.finishOkTitle"),
        description: t("wlk.walk.finishOkDesc"),
      });
    },
    onError: (e: Error) => {
      setFinishOpen(false);
      toast({ title: t("wlk.walk.finishErrTitle"), description: srvErr(e.message), variant: "destructive" });
    },
  });

  if (!user) return null;

  // ---------------- render ----------------
  if (loadingActive) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-8 w-40 rounded-full" />
        <Skeleton className="h-64 rounded-3xl" />
        <Skeleton className="h-48 rounded-3xl" />
      </div>
    );
  }

  if (phase === "none") {
    return (
      <div className="max-w-2xl mx-auto">
        <EmptyState
          icon={Footprints}
          title={t("wlk.cockpit.emptyTitle")}
          description={t("wlk.cockpit.emptyDesc")}
          action={
            <Button className="rounded-full font-bold" onClick={() => setWalkerView("home")}>
              <ArrowLeft className="size-4" /> {t("wlk.backHome")}
            </Button>
          }
        />
      </div>
    );
  }

  const loading = loadingDetail && phase !== "done";
  const liveTrack = points.map((p) => [p.lat, p.lng] as [number, number]);

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Header: back + title + SOS */}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          className="rounded-full shrink-0"
          aria-label={t("wlk.cockpit.backAria")}
          onClick={() => {
            if (phase === "live") setBackOpen(true);
            else setWalkerView("home");
          }}
        >
          <ArrowLeft className="size-4.5" />
        </Button>
        <div className="min-w-0">
          <h1 className="text-lg font-black tracking-tight truncate">
            {phase === "done"
              ? t("wlk.cockpit.doneTitle")
              : phase === "live"
                ? t("wlk.cockpit.liveTitle", { name: dog?.name ?? "…" })
                : t("wlk.cockpit.preTitle", { name: dog?.name ?? "…" })}
          </h1>
          <p className="text-xs text-muted-foreground truncate">
            {owner?.name ? `${t("wlk.cockpit.withOwner", { name: owner.name })} · ` : ""}
            {contextWalk?.booking?.zone.name ?? ""}
          </p>
        </div>
        {phase === "live" && (
          <Button
            variant="destructive"
            className="ml-auto rounded-full font-black animate-pulse shrink-0"
            onClick={() => setSosOpen(true)}
          >
            <Siren className="size-4" /> SOS
          </Button>
        )}
      </div>

      {/* ============ PHASE A — PRE-START ============ */}
      {phase === "pre" && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springSmooth}
          className="space-y-5"
        >
          <div className="rounded-3xl border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <Avatar src={dog?.photoUrl} name={dog?.name} className="size-16 rounded-2xl" />
              <div className="min-w-0">
                <p className="text-lg font-black leading-tight">{dog?.name}</p>
                <p className="text-sm text-muted-foreground">
                  {dog?.breed} · {contextWalk?.durationMin ?? 30} {t("c.min")} ·{" "}
                  {fmtTime(contextWalk?.scheduledStart)}
                </p>
                <div className="flex items-center gap-2 mt-1.5">
                  <StatusBadge status="SCHEDULED" kind="walk" />
                  {payment && <StatusBadge status={payment.status} kind="payment" />}
                </div>
              </div>
              <div className="ml-auto text-right shrink-0">
                <p className="text-[11px] font-semibold uppercase text-muted-foreground">{t("wlk.cockpit.youEarn")}</p>
                <p className="font-black text-primary">
                  {formatBOB(contextWalk?.booking?.pricePerWalkCents ?? 0)}
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3 rounded-2xl bg-secondary/60 p-3">
              <Avatar src={owner?.avatarUrl} name={owner?.name} size="sm" />
              <div className="min-w-0">
                <p className="text-sm font-bold truncate">{owner?.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {t("wlk.cockpit.meetAt", { zone: contextWalk?.booking?.zone.name ?? "" })}
                </p>
              </div>
            </div>
          </div>

          {/* Payment notice */}
          {payment && (
            <div
              className={cn(
                "rounded-3xl border p-4 flex items-start gap-3",
                isCash
                  ? "bg-sun-soft/70 border-amber-300"
                  : payment.status === "HELD"
                    ? "bg-brand-soft/70 border-primary/30"
                    : "bg-secondary border-border"
              )}
            >
              {isCash ? (
                <Banknote className="size-5 text-amber-600 shrink-0 mt-0.5" />
              ) : (
                <Lock className="size-5 text-primary shrink-0 mt-0.5" />
              )}
              <p className="text-sm leading-relaxed">
                {isCash
                  ? t("wlk.cockpit.cashNotice", { amount: formatBOB(payment.amountCents), pct: commissionPct })
                  : payment.status === "HELD"
                    ? t("wlk.cockpit.heldNotice")
                    : t("wlk.cockpit.pendingNotice")}
              </p>
            </div>
          )}

          {/* Pickup point + notes */}
          <div className="rounded-3xl border bg-card p-4 shadow-sm space-y-3">
            <p className="font-black flex items-center gap-2">
              <MapPin className="size-4.5 text-primary" /> {t("wlk.meetingPoint")}
            </p>
            {loading ? (
              <Skeleton className="h-48 rounded-2xl" />
            ) : (
              <WalkMap
                track={[]}
                center={[startLat, startLng]}
                zoom={16}
                className="h-48 w-full rounded-2xl overflow-hidden border"
              />
            )}
            {(contextWalk?.booking?.notes ?? booking?.notes) && (
              <div className="rounded-2xl bg-secondary/60 p-3 text-sm leading-relaxed">
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  {t("wlk.cockpit.notesFrom", { name: owner?.name.split(" ")[0] ?? t("wlk.owner.fem") })}
                </p>
                <p className="mt-1">{contextWalk?.booking?.notes ?? booking?.notes}</p>
              </div>
            )}
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <MapPin className="size-3.5" />
              {t("wlk.cockpit.geofenceHint")}
            </p>
            <Button
              className="w-full rounded-full font-extrabold h-12 text-base"
              size="lg"
              disabled={startMut.isPending}
              onClick={() => startMut.mutate()}
            >
              {startMut.isPending ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <Footprints className="size-5" />
              )}
              {t("wlk.walk.start")}
            </Button>
          </div>
        </motion.div>
      )}

      {/* ============ PHASE B — IN PROGRESS ============ */}
      {phase === "live" && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springSmooth}
          className="space-y-5"
        >
          {/* Live stats */}
          <LiveStats
            startedAt={detail?.startedAt ?? activeWalk?.startedAt ?? new Date().toISOString()}
            durationMin={contextWalk?.durationMin ?? 30}
            distMeters={points.length > 0 ? points[points.length - 1].distMeters : 0}
          />

          {/* Live map */}
          <div className="rounded-3xl border bg-card p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-black flex items-center gap-2">
                <span className="relative flex size-2.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 animate-ping" />
                  <span className="relative inline-flex rounded-full size-2.5 bg-primary" />
                </span>
                {t("wlk.cockpit.liveTrack")}
              </p>
              <span className="text-xs text-muted-foreground font-semibold">{t("wlk.cockpit.gpsActive")}</span>
            </div>
            <WalkMap
              track={liveTrack}
              live
              walkerAvatar={user.avatarUrl}
              dogAvatar={dog?.photoUrl}
              center={[startLat, startLng]}
              className="h-72 w-full rounded-2xl overflow-hidden border"
            />
            {points.length === 0 && (
              <p className="text-xs text-center text-muted-foreground">
                {t("wlk.cockpit.gpsWaiting")}
              </p>
            )}
          </div>

          {/* Report builder */}
          <div className="rounded-3xl border bg-card p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-black flex items-center gap-2">
                <Camera className="size-4.5 text-primary" /> {t("wlk.cockpit.reportTitle")}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="rounded-full font-bold shrink-0"
                onClick={() => setPhotoPickerOpen(true)}
              >
                <Camera className="size-4" /> {t("wlk.cockpit.addPhoto")}
              </Button>
            </div>
            <ReportCardView
              report={report}
              track={liveTrack}
              startedAt={detail?.startedAt ?? null}
              distanceMeters={points.length > 0 ? points[points.length - 1].distMeters : 0}
              durationMin={contextWalk?.durationMin ?? 30}
              dogName={dog?.name}
              dogAvatar={dog?.photoUrl}
              walkerAvatar={user.avatarUrl}
              editable
              onChange={(patch) => setReport((r) => ({ ...r, ...patch }))}
            />
            {report.photos.length === 0 && (
              <p className="text-xs text-muted-foreground text-center">
                {t("wlk.cockpit.photoHint")}
              </p>
            )}
          </div>

          {/* Finish */}
          <Button
            className="w-full rounded-full font-extrabold h-14 text-lg shadow-lg"
            size="lg"
            disabled={finishMut.isPending}
            onClick={() => setFinishOpen(true)}
          >
            {finishMut.isPending ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <Flag className="size-5" />
            )}
            {t("wlk.walk.finishBtn")}
          </Button>
        </motion.div>
      )}

      {/* ============ PHASE C — COMPLETED ============ */}
      {phase === "done" && finishedWalk && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={springSmooth}
          className="space-y-5"
        >
          <div className="rounded-3xl bg-primary text-primary-foreground p-8 text-center shadow-lg relative overflow-hidden">
            <div className="absolute -left-8 -bottom-8 size-36 rounded-full bg-white/10" aria-hidden />
            <PartyPopper className="size-14 mx-auto" />
            <p className="text-2xl font-black mt-3">{t("wlk.walk.finishOkTitle")}</p>
            <p className="text-sm opacity-90 mt-1">
              {t("wlk.cockpit.doneBody", {
                dog: dog?.name ?? "",
                owner: owner?.name.split(" ")[0] ?? t("wlk.owner.su"),
              })}
            </p>
          </div>

          <EarningsBreakdown
            grossCents={finishedWalk.booking?.pricePerWalkCents ?? 0}
            commissionPct={commissionPct}
            isCash={finishedPayment?.method === "CASH" || (!finishedPayment && isCash)}
            paymentPending={
              !!finishedPayment &&
              finishedPayment.method !== "CASH" &&
              finishedPayment.status === "PENDING"
            }
            minPayoutCents={config?.payouts.minPayoutCents ?? 2000}
          />

          <Button
            className="w-full rounded-full font-extrabold h-12"
            size="lg"
            onClick={() => setWalkerView("home")}
          >
            <ArrowLeft className="size-4.5" /> {t("wlk.backHome")}
          </Button>
        </motion.div>
      )}

      {/* ============ DIALOGS ============ */}

      {/* Photo picker (demo camera) */}
      <Dialog open={photoPickerOpen} onOpenChange={setPhotoPickerOpen}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle>{t("wlk.cockpit.photosTitle")}</DialogTitle>
            <DialogDescription>
              {t("wlk.cockpit.photosDesc", { name: dog?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-2">
            {WALK_PHOTOS.map((src) => {
              const added = report.photos.includes(src);
              return (
                <button
                  key={src}
                  type="button"
                  onClick={() =>
                    setReport((r) => ({
                      ...r,
                      photos: added
                        ? r.photos.filter((p) => p !== src)
                        : [...r.photos, src].slice(0, 6),
                    }))
                  }
                  className={cn(
                    "relative rounded-2xl overflow-hidden border-2 transition-[border-color,box-shadow] duration-200 ease-out-expo active:scale-[0.97] aspect-square",
                    added ? "border-primary ring-2 ring-primary/30" : "border-transparent hover:border-primary/40"
                  )}
                  aria-pressed={added}
                  aria-label={added ? t("wlk.cockpit.removePhoto") : t("wlk.cockpit.addPhotoShort")}
                >
                  <img src={src} alt={t("wlk.cockpit.photoAlt")} className="size-full object-cover" />
                  <span
                    className={cn(
                      "absolute top-1 right-1 grid place-items-center size-6 rounded-full text-xs font-black",
                      added ? "bg-primary text-primary-foreground" : "bg-white/85 text-foreground"
                    )}
                  >
                    {added ? <X className="size-3.5" /> : "+"}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground text-center">
            {t("wlk.cockpit.photoDemoNote")}
          </p>
        </DialogContent>
      </Dialog>

      {/* SOS confirm */}
      <AlertDialog open={sosOpen} onOpenChange={setSosOpen}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Siren className="size-5" /> {t("wlk.sos.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("wlk.sos.desc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">{t("c.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                window
                  .open(
                    whatsappHref(
                      config?.platform.supportWhatsApp ?? "",
                      t("wlk.sos.waMsg", { name: dog?.name ?? t("wlk.sos.waFallback") })
                    ),
                    "_blank"
                  )
                  ?.focus();
                toast({ title: t("wlk.sos.toastTitle"), description: t("wlk.sos.toastDesc") });
              }}
            >
              {t("wlk.sos.contact")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Back while in progress */}
      <AlertDialog open={backOpen} onOpenChange={setBackOpen}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("wlk.back.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("wlk.back.desc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">{t("wlk.back.stay")}</AlertDialogCancel>
            <AlertDialogAction className="rounded-full" onClick={() => setWalkerView("home")}>
              {t("wlk.back.leave")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Finish confirm */}
      <AlertDialog open={finishOpen} onOpenChange={setFinishOpen}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("wlk.finish.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {report.photos.length === 1
                ? t("wlk.finish.descOne", {
                    count: report.photos.length,
                    owner: owner?.name ?? t("wlk.owner.el"),
                  })
                : t("wlk.finish.descMany", {
                    count: report.photos.length,
                    owner: owner?.name ?? t("wlk.owner.el"),
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">{t("wlk.finish.keep")}</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full"
              onClick={() => finishMut.mutate()}
            >
              <Flag className="size-4" /> {t("wlk.finish.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ------------------------- Live stats strip ------------------------- */

function LiveStats({
  startedAt,
  durationMin,
  distMeters,
}: {
  startedAt: string;
  durationMin: number;
  distMeters: number;
}) {
  useTick(1000);
  const { t } = useT();
  const sec = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  const km = fmtKm(distMeters).replace(" km", "");
  return (
    <div className="grid grid-cols-3 gap-2.5">
      <div className="rounded-2xl bg-primary text-primary-foreground p-3 text-center shadow-sm">
        <p className="text-xl font-black tabular-nums">
          {mm}:{ss.toString().padStart(2, "0")}
        </p>
        <p className="text-[11px] font-semibold opacity-80">{t("wlk.cockpit.elapsedOf", { n: durationMin })}</p>
      </div>
      <div className="rounded-2xl bg-brand-soft/70 p-3 text-center">
        <p className="text-xl font-black text-primary tabular-nums">{km} km</p>
        <p className="text-[11px] font-semibold text-muted-foreground">{t("wlk.cockpit.traveled")}</p>
      </div>
      <div className="rounded-2xl bg-brand-soft/70 p-3 text-center">
        <p className="text-xl font-black text-primary">{fmtTime(startedAt)}</p>
        <p className="text-[11px] font-semibold text-muted-foreground">{t("wlk.cockpit.startTime")}</p>
      </div>
    </div>
  );
}

/* ------------------------- Earnings breakdown ------------------------- */

function EarningsBreakdown({
  grossCents,
  commissionPct,
  isCash,
  paymentPending,
  minPayoutCents,
}: {
  grossCents: number;
  commissionPct: number;
  isCash: boolean;
  paymentPending: boolean;
  minPayoutCents: number;
}) {
  const { t } = useT();
  const feeCents = Math.round((grossCents * commissionPct) / 100);
  const netCents = grossCents - feeCents;
  return (
    <div className="rounded-3xl border bg-card p-5 shadow-sm">
      <p className="font-black flex items-center gap-2">
        <Wallet className="size-4.5 text-primary" /> {t("wlk.settle.title")}
      </p>
      <div className="mt-3 space-y-2.5 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">
            {isCash ? t("wlk.settle.grossCash") : t("wlk.settle.grossPrice")}
          </span>
          <span className="font-bold">{formatBOB(grossCents)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{t("wlk.settle.commission", { pct: commissionPct })}</span>
          <span className="font-bold text-red-600 dark:text-red-400">
            −{formatBOB(feeCents)}
          </span>
        </div>
        <div className="border-t pt-2.5 flex items-center justify-between">
          <span className="font-bold">{isCash ? t("wlk.settle.netCash") : t("wlk.settle.net")}</span>
          <span className="font-black text-lg text-primary">{formatBOB(netCents)}</span>
        </div>
      </div>
      <div className="mt-3 rounded-2xl bg-secondary/60 p-3 text-xs leading-relaxed text-muted-foreground">
        {isCash ? (
          <>
            {t("wlk.settle.cashNoteA")}{" "}
            <AlertTriangle className="inline size-3.5 text-amber-600" /> {t("wlk.settle.cashNoteB")}
          </>
        ) : paymentPending ? (
          t("wlk.settle.pendingNote")
        ) : (
          <>
            {t("wlk.settle.walletNote", { amount: formatBOB(minPayoutCents) })}
          </>
        )}
      </div>
    </div>
  );
}
