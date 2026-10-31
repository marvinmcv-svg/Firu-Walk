"use client";

// Owner → Live walk view (the WOW screen): big live Leaflet map fed by the
// socket GPS simulation, pulsing LIVE badge, elapsed timer + distance,
// graceful COMPLETED switch to the final report card, and WhatsApp support.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Clock,
  LifeBuoy,
  MapPin,
  MessageCircle,
  Star,
} from "lucide-react";
import { api, qk } from "@/lib/firu/api";
import { useFiruSession } from "@/lib/firu/session";
import { useT } from "@/lib/firu/i18n";
import { fmtKm } from "@/lib/firu/money";
import {
  fmtDateShort,
  fmtTime,
  fmtUntil,
} from "@/lib/firu/dates";
import type {
  AppConfig,
  PartyDTO,
  WalkDTO,
} from "@/lib/firu/types";
import { easeOutExpo, springSnappy } from "@/lib/firu/motion";
import {
  Avatar,
  EmptyState,
  whatsappHref,
} from "@/components/firu/shared/bits";
import { ChatDialog } from "@/components/firu/shared/ChatDialog";
import { ReportCardView } from "@/components/firu/shared/ReportCardView";
import { WalkMap } from "@/components/firu/shared/WalkMap";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getSocket,
  joinLiveWalk,
  leaveLiveWalk,
  type LivePoint,
} from "@/lib/firu/socket";
import { cn } from "@/lib/utils";

/** GET /api/walks/{id} shape: WalkDTO + parsed polyline + booking context. */
type WalkDetail = WalkDTO & {
  track: [number, number][];
  startLat: number | null;
  startLng: number | null;
  booking: {
    id: string;
    status: string;
    type: string;
    owner: PartyDTO | null;
    walker: PartyDTO | null;
    dog: WalkDTO["dog"];
    zone: { id: string; name: string; key: string };
    pricePerWalkCents: number;
    durationMin: number;
    notes: string | null;
  } | null;
};

const MAX_POINTS = 720;

export function LiveWalkView() {
  const { t } = useT();
  const activeWalkId = useFiruSession((s) => s.activeWalkId);
  const setOwnerView = useFiruSession((s) => s.setOwnerView);
  const openBooking = useFiruSession((s) => s.openBooking);

  const [track, setTrack] = useState<[number, number][]>([]);
  const [liveDist, setLiveDist] = useState<number | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const qc = useQueryClient();

  const { data: walk, isLoading } = useQuery({
    queryKey: qk.walk(activeWalkId ?? ""),
    queryFn: () => api.get<WalkDetail>(`/api/walks/${activeWalkId}`),
    enabled: !!activeWalkId,
    // safety poll: the walker may finish from another device
    refetchInterval: (query) =>
      query.state.data?.status === "IN_PROGRESS" ? 8000 : false,
  });

  const { data: config } = useQuery({
    queryKey: qk.config,
    queryFn: () => api.get<AppConfig>("/api/config"),
  });

  const status = walk?.status;
  const inProgress = status === "IN_PROGRESS";

  // ----- live GPS sim wiring -----
  useEffect(() => {
    if (!walk || walk.status !== "IN_PROGRESS") return;
    const socket = getSocket();
    joinLiveWalk({
      walkId: walk.id,
      startLat: walk.startLat ?? undefined,
      startLng: walk.startLng ?? undefined,
    });

    const onState = (p: {
      walkId: string;
      points: LivePoint[];
      distMeters?: number;
    }) => {
      if (p.walkId !== walk.id) return;
      setTrack(
        p.points
          .slice(0, MAX_POINTS)
          .map((pt) => [pt.lat, pt.lng] as [number, number])
      );
      if (typeof p.distMeters === "number") setLiveDist(p.distMeters);
    };
    const onPoint = (pt: LivePoint & { walkId?: string }) => {
      if (pt.walkId && pt.walkId !== walk.id) return;
      setTrack((prev) => {
        const next: [number, number][] = [...prev, [pt.lat, pt.lng]];
        return next.length > MAX_POINTS ? next.slice(next.length - MAX_POINTS) : next;
      });
      if (typeof pt.distMeters === "number") setLiveDist(pt.distMeters);
    };
    const onEnded = (p: { walkId?: string }) => {
      if (p.walkId && p.walkId !== walk.id) return;
      // the walker finished the walk — refetch and show the final report
      qc.invalidateQueries({ queryKey: qk.walk(walk.id) });
    };

    socket.on("walk:state", onState);
    socket.on("walk:point", onPoint);
    socket.on("walk:ended", onEnded);
    return () => {
      socket.off("walk:state", onState);
      socket.off("walk:point", onPoint);
      socket.off("walk:ended", onEnded);
      leaveLiveWalk(walk.id);
    };
  }, [walk?.id, walk?.status, walk?.startLat, walk?.startLng]);

  // elapsed timer (ticks only while the walk is running)
  useEffect(() => {
    if (!inProgress) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [inProgress]);

  const elapsed = (() => {
    if (!walk?.startedAt) return "00:00";
    const s = Math.max(0, Math.floor((now - new Date(walk.startedAt).getTime()) / 1000));
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    if (mm >= 60) {
      const h = Math.floor(mm / 60);
      return `${h}:${String(mm % 60).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
    }
    return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  })();

  const distanceKm = useMemo(() => {
    const m = liveDist ?? walk?.distanceMeters ?? 0;
    return fmtKm(m).replace(" km", "");
  }, [liveDist, walk?.distanceMeters]);

  if (!activeWalkId) {
    return (
      <EmptyState
        icon={MapPin}
        title={t("own.live.noneTitle")}
        description={t("own.live.noneDesc")}
        action={
          <Button
            className="rounded-full font-bold"
            onClick={() => setOwnerView("bookings")}
          >
            {t("own.live.goBookings")}
          </Button>
        }
      />
    );
  }

  if (isLoading || !walk) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-40 rounded-full" />
        <Skeleton className="h-[52vh] w-full rounded-3xl" />
        <Skeleton className="h-24 w-full rounded-3xl" />
      </div>
    );
  }

  const dog = walk.dog;
  const walker = walk.booking?.walker ?? null;
  const walkerFirst = walker?.name.split(" ")[0] ?? t("own.theWalker");
  const liveTrack = inProgress ? track : walk.track;
  const center: [number, number] = [
    walk.startLat ?? -17.7931,
    walk.startLng ?? -63.1998,
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={easeOutExpo}
      className="space-y-4 max-w-4xl mx-auto"
    >
      {/* top bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          variant="ghost"
          className="rounded-full font-bold text-muted-foreground -ml-2"
          onClick={() => setOwnerView("bookings")}
        >
          <ArrowLeft className="size-4" /> {t("own.backVolver")}
        </Button>
        <h1 className="text-xl font-black tracking-tight">
          {inProgress
            ? t("own.live.titleLive")
            : status === "COMPLETED"
              ? t("own.live.titleDone")
              : t("own.live.titleScheduled")}
        </h1>
        {inProgress && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-3 py-1 text-xs font-black uppercase tracking-wide">
            <span className="relative flex size-2">
              <span className="animate-ping absolute inline-flex size-full rounded-full bg-primary-foreground opacity-60" />
              <span className="relative inline-flex rounded-full size-2 bg-primary-foreground" />
            </span>
            {t("own.live.badge")}
          </span>
        )}
      </div>

      {/* MAP */}
      <div className="relative">
        <WalkMap
          track={liveTrack}
          live={inProgress}
          walkerAvatar={walker?.avatarUrl}
          dogAvatar={dog.photoUrl}
          className="h-[52vh] w-full rounded-3xl overflow-hidden border shadow-lg"
          center={center}
        />
        {inProgress && (
          <div className="absolute bottom-4 inset-x-4 sm:inset-x-6">
            <div className="rounded-3xl bg-card/95 backdrop-blur border shadow-xl p-4 flex items-center gap-3 flex-wrap">
              <Avatar src={walker?.avatarUrl} name={walker?.name} />
              <div className="min-w-0 flex-1">
                <p className="font-extrabold leading-tight truncate">
                  {t("own.live.walking", { walker: walkerFirst, dog: dog.name })}
                </p>
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Clock className="size-3" />
                  {t("own.elapsed", { time: elapsed })} · {distanceKm} km
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-center">
                  <p className="text-xl font-black tabular-nums leading-none text-primary">
                    {elapsed}
                  </p>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mt-0.5">
                    {t("own.live.timeWord")}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-black tabular-nums leading-none text-primary">
                    {distanceKm}
                  </p>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mt-0.5">
                    km
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* STATUS FOOTER */}
      <AnimatePresence mode="wait">
        <motion.div
          key={status ?? "unknown"}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={springSnappy}
        >
          {inProgress && (
            <div className="rounded-3xl border bg-card p-4 shadow-sm flex items-center gap-3 flex-wrap">
              <span className="grid place-items-center size-10 rounded-2xl bg-brand-soft text-primary shrink-0">
                <MapPin className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-sm">
                  {t("own.live.inProgress", { time: fmtTime(walk.startedAt) })}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("own.live.updateNote", { dog: dog.name })}
                </p>
              </div>
              {config?.platform.supportWhatsApp && (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full font-bold"
                  onClick={() =>
                    window.open(
                      whatsappHref(
                        config.platform.supportWhatsApp,
                        t("own.live.supportMsg", { dog: dog.name })
                      ),
                      "_blank"
                    )
                  }
                >
                  <LifeBuoy className="size-3.5 text-primary" /> {t("own.live.support")}
                </Button>
              )}
            </div>
          )}

          {status === "COMPLETED" && (
            <div className="rounded-3xl border bg-card p-5 shadow-sm space-y-4">
              <div className="flex items-center gap-3">
                <span className="grid place-items-center size-11 rounded-2xl bg-brand-soft text-primary shrink-0">
                  <CheckCircle2 className="size-6" />
                </span>
                <div>
                  <p className="font-black text-lg leading-tight">
                    {t("own.live.thanks", { walker: walkerFirst })}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {fmtDateShort(walk.startedAt ?? walk.scheduledStart)} · {t("own.live.durationWord")}{" "}
                    {walk.durationMin} min · {distanceKm} km
                  </p>
                </div>
              </div>
              <ReportCardView
                report={walk.report ?? null}
                track={walk.track}
                startedAt={walk.startedAt}
                endedAt={walk.endedAt}
                distanceMeters={walk.distanceMeters}
                durationMin={walk.durationMin}
                dogName={dog.name}
                dogAvatar={dog.photoUrl}
                walkerAvatar={walker?.avatarUrl}
              />
              <div className="flex gap-2 flex-wrap">
                <Button
                  className="rounded-full font-bold"
                  onClick={() => openBooking(walk.bookingId)}
                >
                  <Star className="size-4" /> {t("own.live.viewBookingReview")}
                </Button>
                {walker && (
                  <Button
                    variant="outline"
                    className="rounded-full font-bold"
                    onClick={() => setChatOpen(true)}
                  >
                    <MessageCircle className="size-4 text-primary" /> {t("own.live.chatWith", { walker: walkerFirst })}
                  </Button>
                )}
              </div>
            </div>
          )}

          {(status === "SCHEDULED" || status === "CANCELLED" || status === "NO_SHOW") && (
            <div className="rounded-3xl border bg-card p-5 shadow-sm space-y-3">
              <div className="flex items-center gap-3">
                <span className="grid place-items-center size-11 rounded-2xl bg-brand-soft text-primary shrink-0">
                  <CalendarClock className="size-6" />
                </span>
                <div>
                  <p className="font-black text-lg leading-tight">
                    {status === "SCHEDULED"
                      ? t("own.live.startsIn", { until: fmtUntil(walk.scheduledStart) })
                      : status === "NO_SHOW"
                        ? t("own.live.noShow")
                        : t("own.live.cancelled")}
                  </p>
                  {status === "SCHEDULED" && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {fmtDateShort(walk.scheduledStart)} · {fmtTime(walk.scheduledStart)} ·{" "}
                      {walk.booking?.zone.name ?? walk.durationMin + " min"}
                    </p>
                  )}
                </div>
              </div>
              {walker && (
                <div className="flex items-center gap-3 rounded-2xl bg-muted/40 p-3">
                  <Avatar src={walker.avatarUrl} name={walker.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">{walker.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {walk.booking?.zone.name ?? t("own.yourZone")} · {walk.durationMin} min
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full font-bold"
                    onClick={() => setChatOpen(true)}
                  >
                    <MessageCircle className="size-3.5 text-primary" /> {t("own.chat")}
                  </Button>
                </div>
              )}
              {status === "SCHEDULED" && (
                <p className={cn("text-xs text-muted-foreground leading-relaxed")}>
                  {t("own.live.rescheduleNote")}
                </p>
              )}
              {config?.platform.supportWhatsApp && (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full font-bold"
                  onClick={() =>
                    window.open(
                      whatsappHref(
                        config.platform.supportWhatsApp,
                        t("own.live.supportMsg", { dog: dog.name })
                      ),
                      "_blank"
                    )
                  }
                >
                  <LifeBuoy className="size-3.5 text-primary" /> {t("own.live.supportWhats")}
                </Button>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* chat */}
      {walker && (
        <ChatDialog
          open={chatOpen}
          onOpenChange={setChatOpen}
          threadId={walk.bookingId}
          otherName={walker.name}
          otherAvatar={walker.avatarUrl}
          otherPhone={walker.phone}
          contextLabel={t("own.chatCtxWalk", {
            dog: dog.name,
            zone: walk.booking?.zone.name ?? "",
          })}
        />
      )}
    </motion.div>
  );
}
