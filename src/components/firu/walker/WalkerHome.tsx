"use client";

// Walker home: greeting + status banner, "paseo en curso" resume card,
// pending requests with live accept countdown, today's agenda (start window
// logic + lazy booking notes), upcoming days and a stats strip.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock,
  Footprints,
  Hourglass,
  MapPin,
  MessageCircle,
  PawPrint,
  Star,
  Timer,
  XCircle,
  Navigation,
} from "lucide-react";
import { api, qk } from "@/lib/firu/api";
import { useFiruSession } from "@/lib/firu/session";
import { useT, srvErr } from "@/lib/firu/i18n";
import { formatBOB } from "@/lib/firu/money";
import {
  fmtDateLong,
  fmtDateShort,
  fmtSchedule,
  fmtTime,
  fmtUntil,
} from "@/lib/firu/dates";
import type { BookingDTO, DogDTO, PartyDTO, WalkDTO, ZoneDTO } from "@/lib/firu/types";
import { easeOutExpo, springSmooth } from "@/lib/firu/motion";
import {
  Avatar,
  DogSizeBadge,
  EmptyState,
  RatingStars,
  SectionHeader,
  StatusBadge,
} from "@/components/firu/shared/bits";
import { ChatDialog } from "@/components/firu/shared/ChatDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/** WalkDTO + compact booking context (shape of GET /api/walks?scope=…). */
export interface WalkWithContext extends WalkDTO {
  booking: {
    id: string;
    status: string;
    type: string;
    owner: PartyDTO | null;
    walker: PartyDTO | null;
    dog: DogDTO;
    zone: { id: string; name: string; key: string };
    pricePerWalkCents: number;
    durationMin: number;
    notes: string | null;
  } | null;
}

const START_WINDOW_MS = 60 * 60 * 1000; // walkers may start up to 60 min early

/** Re-render every `intervalMs` (for ticking timers). */
function useTick(intervalMs = 1000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
}

/** mm:ss countdown from an ISO deadline. Amber when < 30s. */
function CountdownBadge({ expiresAt }: { expiresAt: string }) {
  useTick(1000);
  const remaining = Math.max(0, new Date(expiresAt).getTime() - Date.now());
  const totalSec = Math.floor(remaining / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  const urgent = remaining < 30_000;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-black tabular-nums border",
        urgent
          ? "bg-sun-soft text-amber-700 border-amber-300 animate-pulse"
          : "bg-secondary text-secondary-foreground border-border"
      )}
    >
      <Hourglass className="size-3" />
      {mm}:{ss.toString().padStart(2, "0")}
    </span>
  );
}

/** Elapsed time since an ISO timestamp (ticking). */
function ElapsedTime({ since }: { since: string }) {
  useTick(1000);
  const sec = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000));
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return (
    <span className="tabular-nums font-black text-lg">
      {mm}:{ss.toString().padStart(2, "0")}
    </span>
  );
}

export function WalkerHome() {
  const user = useFiruSession((s) => s.user);
  const setWalkerView = useFiruSession((s) => s.setWalkerView);
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useT();
  const walker = user?.walker ?? null;
  const isPending = walker?.status === "PENDING";
  const isSuspended = walker?.status === "SUSPENDED";
  const actionsAllowed = walker?.status === "ACTIVE";

  const { data: activeWalks, isLoading: loadingActive } = useQuery({
    queryKey: ["walks", "active"],
    queryFn: () => api.get<WalkWithContext[]>("/api/walks?scope=active"),
    refetchInterval: 10_000,
  });
  const { data: todayWalks, isLoading: loadingToday } = useQuery({
    queryKey: ["walks", "today"],
    queryFn: () => api.get<WalkWithContext[]>("/api/walks?scope=today"),
    refetchInterval: 30_000,
  });
  const { data: bookings, isLoading: loadingBookings } = useQuery({
    queryKey: qk.bookings,
    queryFn: () => api.get<BookingDTO[]>("/api/bookings"),
    refetchInterval: 5_000, // live accept/decline window
  });
  const { data: zones } = useQuery({
    queryKey: qk.zones,
    queryFn: () => api.get<ZoneDTO[]>("/api/zones"),
  });

  const activeWalk = activeWalks?.[0] ?? null;
  const requests = useMemo(
    () => (bookings ?? []).filter((b) => b.status === "REQUESTED"),
    [bookings]
  );
  const todayScheduled = useMemo(() => {
    const items = todayWalks ?? [];
    const running = items.filter((w) => w.status === "IN_PROGRESS");
    const scheduled = items.filter((w) => w.status === "SCHEDULED");
    return [...running, ...scheduled];
  }, [todayWalks]);

  // Upcoming SCHEDULED walks beyond today, grouped by day.
  const upcoming = useMemo(() => {
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const walks = (bookings ?? [])
      .filter((b) => b.status === "CONFIRMED")
      .flatMap((b) =>
        b.walks
          .filter(
            (w) =>
              w.status === "SCHEDULED" &&
              new Date(w.scheduledStart).getTime() > endOfToday.getTime()
          )
          .map((w) => ({
            walk: w,
            owner: b.owner,
            zoneName: b.zone.name,
            durationMin: b.durationMin,
          }))
      )
      .sort(
        (a, b) =>
          new Date(a.walk.scheduledStart).getTime() -
          new Date(b.walk.scheduledStart).getTime()
      )
      .slice(0, 12);
    const groups = new Map<string, typeof walks>();
    for (const item of walks) {
      const key = fmtDateShort(item.walk.scheduledStart);
      const list = groups.get(key) ?? [];
      list.push(item);
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [bookings]);

  // ---------------- mutations ----------------
  const acceptMut = useMutation({
    mutationFn: (bookingId: string) =>
      api.patch(`/api/bookings/${bookingId}`, { action: "accept" }),
    onSuccess: () => {
      toast({
        title: t("wlk.req.acceptOkTitle"),
        description: t("wlk.req.acceptOkDesc"),
      });
      qc.invalidateQueries({ queryKey: qk.bookings });
      qc.invalidateQueries({ queryKey: ["walks"] });
    },
    onError: (e: Error) =>
      toast({
        title: t("wlk.req.acceptErrTitle"),
        description: srvErr(e.message),
        variant: "destructive",
      }),
  });
  const declineMut = useMutation({
    mutationFn: (bookingId: string) =>
      api.patch(`/api/bookings/${bookingId}`, { action: "decline" }),
    onSuccess: () => {
      toast({
        title: t("wlk.req.declineOkTitle"),
        description: t("wlk.req.declineOkDesc"),
      });
      qc.invalidateQueries({ queryKey: qk.bookings });
    },
    onError: (e: Error) =>
      toast({
        title: t("wlk.req.declineErrTitle"),
        description: srvErr(e.message),
        variant: "destructive",
      }),
  });
  const startMut = useMutation({
    mutationFn: async (walk: WalkWithContext) => {
      // Simulated geofence: send zone center as the walker position.
      const zone = zones?.find((z) => z.id === walk.booking?.zone.id);
      return api.patch(`/api/walks/${walk.id}`, {
        action: "start",
        lat: zone?.centerLat ?? -17.7833,
        lng: zone?.centerLng ?? -63.1821,
      });
    },
    onSuccess: () => {
      toast({ title: t("wlk.walk.startOkTitle"), description: t("wlk.walk.startOkDescHome") });
      qc.invalidateQueries({ queryKey: ["walks"] });
      setWalkerView("walk-active");
    },
    onError: (e: Error) =>
      toast({
        title: t("wlk.walk.startErrTitle"),
        description: srvErr(e.message),
        variant: "destructive",
      }),
  });

  if (!user) return null;
  const firstName = user.name.split(" ")[0];

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Greeting + status */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springSmooth}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-tight">
              {t("wlk.home.greeting", { name: firstName })}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {fmtDateLong(new Date())} · {user.zoneName ?? walker?.zoneName ?? "Santa Cruz"}
            </p>
          </div>
          {walker && <StatusBadge status={walker.status} kind="walker" />}
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-3 gap-2.5 mt-4">
          <div className="rounded-2xl bg-brand-soft/70 p-3 text-center">
            <p className="text-xl font-black text-primary">{walker?.totalWalks ?? 0}</p>
            <p className="text-[11px] font-semibold text-muted-foreground">{t("wlk.home.statWalks")}</p>
          </div>
          <div className="rounded-2xl bg-brand-soft/70 p-3 text-center">
            <p className="flex justify-center">
              <RatingStars rating={walker?.rating ?? 0} count={walker?.ratingCount} />
            </p>
            <p className="text-[11px] font-semibold text-muted-foreground mt-0.5">{t("wlk.home.statReputation")}</p>
          </div>
          <div className="rounded-2xl bg-brand-soft/70 p-3 text-center">
            <p className="text-xl font-black text-primary">{walker?.repeatOwners ?? 0}</p>
            <p className="text-[11px] font-semibold text-muted-foreground">{t("wlk.home.statRepeat")}</p>
          </div>
        </div>
      </motion.section>

      {/* Status banners */}
      {(isPending || isSuspended) && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springSmooth, delay: 0.05 }}
          className={cn(
            "rounded-2xl border p-4 flex items-start gap-3",
            isPending
              ? "bg-sun-soft/70 border-amber-300"
              : "bg-red-50 border-red-300 dark:bg-red-950/40 dark:border-red-800"
          )}
          role="alert"
        >
          <AlertTriangle
            className={cn("size-5 shrink-0 mt-0.5", isPending ? "text-amber-600" : "text-red-600 dark:text-red-400")}
          />
          <div>
            <p className={cn("font-extrabold", isPending ? "text-amber-800 dark:text-amber-400" : "text-red-700 dark:text-red-400")}>
              {isPending ? t("wlk.home.pendingTitle") : t("wlk.home.suspendedTitle")}
            </p>
            <p className={cn("text-sm mt-1 leading-relaxed", isPending ? "text-amber-800/80 dark:text-amber-400/80" : "text-red-700/80 dark:text-red-400/80")}>
              {isPending
                ? t("wlk.home.pendingBody")
                : walker?.suspendedReason ?? t("wlk.home.suspendedBody")}
            </p>
          </div>
        </motion.div>
      )}

      {/* Paseo en curso */}
      {loadingActive ? (
        <Skeleton className="h-36 rounded-3xl" />
      ) : activeWalk ? (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springSmooth, delay: 0.05 }}
          aria-label={t("wlk.walk.live")}
        >
          <div className="relative overflow-hidden rounded-3xl firu-gloss bg-primary text-primary-foreground p-5 shadow-lg">
            <div
              className="absolute -right-8 -top-8 size-36 rounded-full bg-white/10"
              aria-hidden
            />
            <div className="flex items-center gap-2 text-sm font-bold opacity-90">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 animate-ping" />
                <span className="relative inline-flex rounded-full size-2.5 bg-white" />
              </span>
              {t("wlk.walk.live")}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Avatar src={activeWalk.dog.photoUrl} name={activeWalk.dog.name} className="size-16 border-white/40 bg-white" />
              <div className="min-w-0">
                <p className="text-lg font-black leading-tight truncate">
                  {activeWalk.dog.name}
                </p>
                <p className="text-sm opacity-90 truncate">
                  {t("wlk.home.liveOwner", { name: activeWalk.booking?.owner?.name ?? t("wlk.owner.name") })} · {activeWalk.booking?.zone.name}
                </p>
              </div>
              <div className="ml-auto text-right shrink-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide opacity-75">
                  {t("wlk.home.elapsed")}
                </p>
                <span className="text-primary-foreground">
                  <ElapsedTime since={activeWalk.startedAt ?? activeWalk.scheduledStart} />
                </span>
              </div>
            </div>
            <Button
              onClick={() => setWalkerView("walk-active")}
              className="mt-4 w-full rounded-full bg-white text-primary font-extrabold hover:bg-white/90 h-11"
              size="lg"
            >
              <Footprints className="size-4.5" /> {t("wlk.walk.continue")}
            </Button>
          </div>
        </motion.section>
      ) : null}

      {/* Solicitudes pendientes */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springSmooth, delay: 0.1 }}
      >
        <SectionHeader
          title={t("wlk.req.title")}
          subtitle={t("wlk.req.subtitle")}
          action={
            requests.length > 0 ? (
              <span className="rounded-full bg-sun-soft text-amber-700 border border-amber-300 px-2.5 py-0.5 text-xs font-black">
                {requests.length}
              </span>
            ) : undefined
          }
        />
        {loadingBookings ? (
          <div className="space-y-3">
            <Skeleton className="h-40 rounded-2xl" />
            <Skeleton className="h-40 rounded-2xl" />
          </div>
        ) : requests.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={t("wlk.req.emptyTitle")}
            description={t("wlk.req.emptyDesc")}
          />
        ) : (
          <div className="space-y-3">
            {requests.map((b) => (
              <RequestCard
                key={b.id}
                booking={b}
                disabled={!actionsAllowed}
                pending={acceptMut.isPending || declineMut.isPending}
                onAccept={() => acceptMut.mutate(b.id)}
                onDecline={() => declineMut.mutate(b.id)}
              />
            ))}
          </div>
        )}
      </motion.section>

      {/* Paseos de hoy */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springSmooth, delay: 0.15 }}
      >
        <SectionHeader title={t("wlk.today.title")} subtitle={t("wlk.today.subtitle")} />
        {loadingToday ? (
          <div className="space-y-3">
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
          </div>
        ) : todayScheduled.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title={t("wlk.today.emptyTitle")}
            description={t("wlk.today.emptyDesc")}
          />
        ) : (
          <div className="space-y-3">
            {todayScheduled.map((w) => (
              <TodayWalkCard
                key={w.id}
                walk={w}
                actionsAllowed={actionsAllowed}
                starting={startMut.isPending && startMut.variables?.id === w.id}
                onStart={() => setWalkerView("walk-active")} // TEMP-TEST: navigate only
                onContinue={() => setWalkerView("walk-active")}
              />
            ))}
          </div>
        )}
      </motion.section>

      {/* Próximos días */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springSmooth, delay: 0.2 }}
      >
        <SectionHeader title={t("wlk.upcoming.title")} subtitle={t("wlk.upcoming.subtitle")} />
        {upcoming.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title={t("wlk.upcoming.emptyTitle")}
            description={t("wlk.upcoming.emptyDesc")}
          />
        ) : (
          <div className="rounded-3xl border bg-card overflow-hidden max-h-96 overflow-y-auto">
            {upcoming.map(([day, items], gi) => (
              <div key={day} className={cn(gi > 0 && "border-t")}>
                <div className="px-4 py-2.5 bg-secondary/60 flex items-center justify-between sticky top-0">
                  <p className="text-sm font-black capitalize">{day}</p>
                  <p className="text-xs text-muted-foreground font-semibold">
                    {items.length > 1
                      ? t("wlk.upcoming.countMany", { count: items.length })
                      : t("wlk.upcoming.countOne", { count: items.length })}
                  </p>
                </div>
                {items.map(({ walk, owner, zoneName, durationMin }) => (
                  <div
                    key={walk.id}
                    className="px-4 py-3 flex items-center gap-3 border-t border-border/60"
                  >
                    <span className="grid place-items-center size-10 rounded-2xl bg-brand-soft text-primary shrink-0 text-sm font-black">
                      {fmtTime(walk.scheduledStart).split(" ")[0]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-sm truncate">
                        {walk.dog.name} · {fmtTime(walk.scheduledStart)}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {owner.name} · {zoneName} · {durationMin} {t("c.min")}
                      </p>
                    </div>
                    <PawPrint className="size-4 text-muted-foreground/50 shrink-0" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </motion.section>
    </div>
  );
}

/* ------------------------- Request card ------------------------- */

function RequestCard({
  booking,
  disabled,
  pending,
  onAccept,
  onDecline,
}: {
  booking: BookingDTO;
  disabled: boolean;
  pending: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const [chatOpen, setChatOpen] = useState(false);
  const { t } = useT();
  return (
    <div className="rounded-3xl border bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <Avatar src={booking.dog.photoUrl} name={booking.dog.name} className="size-14 rounded-2xl" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-black text-base leading-tight">{booking.dog.name}</p>
            <DogSizeBadge size={booking.dog.size} />
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold text-secondary-foreground">
              {booking.durationMin} {t("c.min")}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5 truncate">
            {booking.owner.name} · {booking.zone.name}
          </p>
        </div>
        {booking.expiresAt && <CountdownBadge expiresAt={booking.expiresAt} />}
      </div>

      <div className="mt-3 flex items-center gap-2 flex-wrap text-sm">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft text-primary px-2.5 py-1 font-bold">
          <Clock className="size-3.5" />
          {fmtSchedule(booking.schedule, booking.type)}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 font-bold text-secondary-foreground">
          <Star className="size-3.5 fill-sun text-sun" />
          {formatBOB(booking.pricePerWalkCents)} {t("wlk.req.perWalk")}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 font-bold text-secondary-foreground">
          {booking.type === "RECURRING" ? t("wlk.req.recurring") : t("wlk.req.oneOff")}
        </span>
      </div>

      {booking.notes && (
        <div className="mt-3 rounded-2xl bg-secondary/60 p-3 text-sm leading-relaxed">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            {t("wlk.req.notesFrom", { name: booking.owner.name.split(" ")[0] })}
          </p>
          <p className="mt-1">{booking.notes}</p>
        </div>
      )}

      {disabled ? (
        <p className="mt-4 text-center text-xs text-muted-foreground bg-muted/60 rounded-full py-2">
          {t("wlk.req.disabledHint")}
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-[1fr_auto_auto] gap-2">
          <Button
            onClick={() => setChatOpen(true)}
            variant="outline"
            className="rounded-full"
            aria-label={t("wlk.chatAria", { name: booking.owner.name })}
          >
            <MessageCircle className="size-4" />
          </Button>
          <Button
            onClick={onDecline}
            variant="outline"
            disabled={pending}
            className="rounded-full text-muted-foreground"
          >
            <XCircle className="size-4" /> {t("wlk.req.decline")}
          </Button>
          <Button
            onClick={onAccept}
            disabled={pending}
            className="rounded-full font-extrabold"
          >
            <CheckCircle2 className="size-4" /> {t("wlk.req.accept")}
          </Button>
        </div>
      )}

      <ChatDialog
        open={chatOpen}
        onOpenChange={setChatOpen}
        threadId={booking.id}
        otherName={booking.owner.name}
        otherAvatar={booking.owner.avatarUrl}
        contextLabel={t("wlk.req.chatContext", { dog: booking.dog.name, zone: booking.zone.name })}
      />
    </div>
  );
}

/* ------------------------- Today walk card ------------------------- */

function TodayWalkCard({
  walk,
  actionsAllowed,
  starting,
  onStart,
  onContinue,
}: {
  walk: WalkWithContext;
  actionsAllowed: boolean;
  starting: boolean;
  onStart: () => void;
  onContinue: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const { t } = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const owner = walk.booking?.owner ?? null;
  // "On my way": tells the owner once (WhatsApp + app), within the start window.
  const onTheWayMut = useMutation({
    mutationFn: () => api.patch(`/api/walks/${walk.id}`, { action: "on_the_way" }),
    onSuccess: () => {
      toast({ title: t("wlk.walk.onTheWayOkTitle"), description: t("wlk.walk.onTheWayOkDesc") });
      qc.invalidateQueries({ queryKey: ["walks"] });
    },
    onError: (e: Error) =>
      toast({ title: t("wlk.walk.onTheWayErr"), description: srvErr(e.message), variant: "destructive" }),
  });
  const zoneName = walk.booking?.zone.name ?? "";

  // Lazy-load the full booking only when expanded and the walk context
  // did not carry the owner's pickup notes.
  const { data: lazyBooking, isFetching: fetchingNotes } = useQuery({
    queryKey: qk.booking(walk.bookingId),
    queryFn: () => api.get<BookingDTO>(`/api/bookings/${walk.bookingId}`),
    enabled: expanded && !walk.booking?.notes,
    staleTime: 60_000,
  });
  const notes = walk.booking?.notes ?? lazyBooking?.notes ?? null;

  const inProgress = walk.status === "IN_PROGRESS";
  const startsIn = new Date(walk.scheduledStart).getTime() - Date.now();
  const canStart = startsIn <= START_WINDOW_MS;

  return (
    <div className="rounded-3xl border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "grid place-items-center size-12 rounded-2xl font-black shrink-0",
            inProgress ? "bg-primary text-primary-foreground" : "bg-brand-soft text-primary"
          )}
        >
          <Timer className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-black leading-tight">
              {fmtTime(walk.scheduledStart)} · {walk.dog.name}
            </p>
            {inProgress ? (
              <StatusBadge status="IN_PROGRESS" kind="walk" />
            ) : (
              <DogSizeBadge size={walk.dog.size} />
            )}
          </div>
          <p className="text-sm text-muted-foreground truncate mt-0.5">
            {owner?.name ?? t("wlk.owner.default")} · {zoneName} · {walk.durationMin} {t("c.min")}
          </p>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="rounded-full p-2 hover:bg-secondary transition-[background-color,transform] duration-200 ease-out-expo active:scale-90"
          aria-expanded={expanded}
          aria-label={t("wlk.today.expandAria")}
        >
          <ChevronDown className={cn("size-5 text-muted-foreground transition-transform duration-200 ease-out-expo", expanded && "rotate-180")} />
        </button>
      </div>

      {expanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          transition={easeOutExpo}
          className="overflow-hidden"
        >
          <div className="mt-3 rounded-2xl bg-secondary/60 p-3 text-sm leading-relaxed">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <MapPin className="size-3.5" /> {t("wlk.today.meetingPoint", { name: owner?.name.split(" ")[0] ?? t("wlk.owner.fem") })}
            </p>
            {fetchingNotes ? (
              <Skeleton className="h-4 w-3/4 mt-2" />
            ) : notes ? (
              <p className="mt-1.5">{notes}</p>
            ) : (
              <p className="mt-1.5 text-muted-foreground">
                {t("wlk.today.noNotes")}
              </p>
            )}
          </div>
        </motion.div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="outline"
          className="rounded-full"
          onClick={() => setChatOpen(true)}
          aria-label={t("wlk.chatAria", { name: owner?.name ?? t("wlk.owner.el") })}
        >
          <MessageCircle className="size-4" />
          <span className="hidden sm:inline">{t("wlk.chat")}</span>
        </Button>
        {inProgress ? (
          <Button className="rounded-full font-extrabold flex-1" onClick={onContinue}>
            <Footprints className="size-4" /> {t("wlk.walk.continue")}
          </Button>
        ) : actionsAllowed ? (
          <Button
            className="rounded-full font-extrabold flex-1"
            disabled={!canStart || starting}
            onClick={onStart}
          >
            <Footprints className="size-4" />
            {starting
              ? t("wlk.walk.starting")
              : canStart
                ? t("wlk.walk.start")
                : t("wlk.walk.startAt", { until: fmtUntil(walk.scheduledStart) })}
          </Button>
        ) : (
          <Button className="rounded-full flex-1" disabled>
            {t("wlk.walk.start")}
          </Button>
        )}

      </div>

      {!inProgress && actionsAllowed && canStart && (
        walk.onTheWayAt ? (
          <p className="mt-2 flex items-center justify-center gap-1.5 text-xs font-semibold text-primary">
            <Navigation className="size-3.5" />
            {t("wlk.walk.onTheWaySent", { time: fmtTime(walk.onTheWayAt) })}
          </p>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="mt-2 w-full rounded-full font-bold"
            disabled={onTheWayMut.isPending}
            onClick={() => onTheWayMut.mutate()}
          >
            <Navigation className="size-4 text-primary" /> {t("wlk.walk.onTheWay")}
          </Button>
        )
      )}

      <ChatDialog
        open={chatOpen}
        onOpenChange={setChatOpen}
        threadId={walk.bookingId}
        otherName={owner?.name ?? t("wlk.owner.default")}
        otherAvatar={owner?.avatarUrl}
        contextLabel={t("wlk.today.chatContext", { dog: walk.dog.name, zone: zoneName })}
      />
    </div>
  );
}
