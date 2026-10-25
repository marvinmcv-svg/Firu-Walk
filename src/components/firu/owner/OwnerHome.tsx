"use client";

// Owner → Home dashboard: greeting, LIVE walk banner (the wow moment),
// upcoming walks with quick actions, and the "reservar de nuevo" retention
// engine + primary booking CTA.

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CalendarClock,
  MapPin,
  MessageCircle,
  PawPrint,
  Plus,
  Repeat2,
  UserRound,
} from "lucide-react";
import { api, qk } from "@/lib/firu/api";
import { useFiruSession } from "@/lib/firu/session";
import { useT } from "@/lib/firu/i18n";
import {
  fmtDateLong,
  fmtDateShort,
  fmtTime,
  fmtUntil,
} from "@/lib/firu/dates";
import type { BookingDTO, DogDTO } from "@/lib/firu/types";
import { staggerContainer, staggerItem } from "@/lib/firu/motion";
import {
  Avatar,
  EmptyState,
  SectionHeader,
} from "@/components/firu/shared/bits";
import { ChatDialog } from "@/components/firu/shared/ChatDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** Elapsed mm:ss (or h:mm:ss) since an ISO timestamp, ticking each second. */
function useElapsed(iso: string | null | undefined): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return useMemo(() => {
    if (!iso) return "00:00";
    const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    if (mm >= 60) {
      const h = Math.floor(mm / 60);
      return `${h}:${String(mm % 60).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
    }
    return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }, [iso, now]);
}

export function OwnerHome() {
  const { t } = useT();
  const user = useFiruSession((s) => s.user);
  const openWalk = useFiruSession((s) => s.openWalk);
  const openWalker = useFiruSession((s) => s.openWalker);
  const startBookingFlow = useFiruSession((s) => s.startBookingFlow);
  const setOwnerView = useFiruSession((s) => s.setOwnerView);

  const { data: bookings, isLoading } = useQuery({
    queryKey: qk.bookings,
    queryFn: () => api.get<BookingDTO[]>("/api/bookings"),
  });
  const { data: dogs } = useQuery({
    queryKey: qk.dogs(),
    queryFn: () => api.get<DogDTO[]>("/api/dogs"),
  });

  const [chatBooking, setChatBooking] = useState<BookingDTO | null>(null);

  // scan every booking for a walk that is IN_PROGRESS right now
  let live: { walk: BookingDTO["walks"][number]; booking: BookingDTO } | null = null;
  for (const b of bookings ?? []) {
    const w = b.walks.find((x) => x.status === "IN_PROGRESS");
    if (w) {
      live = { walk: w, booking: b };
      break;
    }
  }

  const upcoming = useMemo(() => {
    const items: { walk: BookingDTO["walks"][number]; booking: BookingDTO }[] = [];
    for (const b of bookings ?? []) {
      if (b.status !== "CONFIRMED" && b.status !== "REQUESTED") continue;
      for (const w of b.walks) {
        if (w.status === "SCHEDULED") items.push({ walk: w, booking: b });
      }
    }
    return items
      .sort(
        (a, b) =>
          new Date(a.walk.scheduledStart).getTime() -
          new Date(b.walk.scheduledStart).getTime()
      )
      .slice(0, 4);
  }, [bookings]);

  // unique dogs from past/confirmed bookings — the one-tap rebook engine
  const rebookDogs = useMemo(() => {
    const seen = new Set<string>();
    const out: { dog: DogDTO; walkerName?: string }[] = [];
    for (const b of bookings ?? []) {
      if (b.status !== "CONFIRMED" && b.status !== "COMPLETED") continue;
      if (seen.has(b.dog.id)) continue;
      seen.add(b.dog.id);
      out.push({ dog: b.dog, walkerName: b.walker?.name });
    }
    return out.slice(0, 3);
  }, [bookings]);

  const elapsed = useElapsed(live?.walk.startedAt);
  if (!user) return null;

  const firstName = user.name.split(" ")[0];
  const summaryParts: string[] = [];
  if (live) summaryParts.push(t("own.home.liveSummary"));
  if (upcoming.length > 0)
    summaryParts.push(
      t(
        upcoming.length > 1 ? "own.home.upcoming.many" : "own.home.upcoming.one",
        { count: upcoming.length }
      )
    );

  return (
    <motion.div
      variants={staggerContainer(0.05)}
      initial="hidden"
      animate="show"
      className="space-y-6"
    >
      {/* Greeting */}
      <motion.div variants={staggerItem}>
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
          {t("own.home.greeting", { name: firstName })}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {fmtDateLong(new Date())}
          {summaryParts.length > 0 && (
            <> · {summaryParts.join(" · ")}</>
          )}
          {!live && upcoming.length === 0 && t("own.home.askToday")}
        </p>
      </motion.div>

      {/* LIVE walk banner */}
      {live && (
        <motion.button
          variants={staggerItem}
          onClick={() => openWalk(live.walk.id)}
          className="w-full text-left rounded-3xl firu-gloss bg-primary text-primary-foreground p-5 shadow-lg shadow-primary/25 relative transition-[transform,box-shadow] duration-200 ease-out-expo hover:-translate-y-0.5 hover:shadow-float active:scale-[0.98]"
        >
          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative shrink-0">
              <Avatar
                src={live.booking.walker?.avatarUrl}
                name={live.booking.walker?.name}
                className="size-16 border-primary-foreground/40"
              />
              <span className="absolute -bottom-1 -right-1">
                <img
                  src={live.walk.dog.photoUrl ?? "/images/brand/logo-mark-mint.png"}
                  alt=""
                  className="size-8 rounded-full object-cover border-2 border-primary bg-background"
                />
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-wide">
                <span className="relative flex size-2.5">
                  <span className="animate-ping absolute inline-flex size-full rounded-full bg-primary-foreground opacity-60" />
                  <span className="relative inline-flex rounded-full size-2.5 bg-primary-foreground" />
                </span>
                {t("own.home.liveTitle")}
              </p>
              <p className="font-extrabold text-lg leading-tight mt-1">
                {t("own.home.liveWalking", {
                  walker: live.booking.walker?.name ?? t("own.walkerFallback"),
                  dog: live.walk.dog.name,
                })}
              </p>
              <p className="text-sm text-primary-foreground/80">
                {t("own.elapsed", { time: elapsed })} · {live.booking.zone.name}
              </p>
            </div>
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-primary-foreground text-primary font-bold text-sm px-4 py-2.5">
              {t("own.viewLive")} <ArrowRight className="size-4" />
            </span>
          </div>
        </motion.button>
      )}

      {/* No dogs yet */}
      {dogs !== undefined && dogs.length === 0 && (
        <motion.div
          variants={staggerItem}
          className="rounded-3xl border-2 border-primary/30 bg-brand-soft/50 p-6 text-center"
        >
          <p className="font-black text-xl">{t("own.home.noDogsTitle")}</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto leading-relaxed">
            {t("own.home.noDogsDesc")}
          </p>
          <Button
            className="rounded-full font-bold mt-4"
            size="lg"
            onClick={() => setOwnerView("profile")}
          >
            <Plus className="size-4" /> {t("own.home.addDogCta")}
          </Button>
        </motion.div>
      )}

      {/* Primary CTA */}
      {dogs !== undefined && dogs.length > 0 && (
        <motion.div
          variants={staggerItem}
          className="rounded-3xl border-2 border-primary/25 bg-brand-soft/50 p-6 flex items-center gap-4 flex-wrap shadow-sm"
        >
          <span className="grid place-items-center size-14 rounded-2xl bg-primary text-primary-foreground shrink-0">
            <PawPrint className="size-7" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-black text-xl">{t("own.bookWalk")}</p>
            <p className="text-sm text-muted-foreground leading-snug mt-0.5">
              {t("own.home.ctaDesc")}
            </p>
          </div>
          <Button
            size="lg"
            className="rounded-full font-bold text-base h-12"
            onClick={() => startBookingFlow()}
          >
            {t("own.start")} <ArrowRight className="size-4" />
          </Button>
        </motion.div>
      )}

      {/* Upcoming walks */}
      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-7 w-44" />
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-3xl" />
          ))}
        </div>
      )}

      {upcoming.length > 0 && (
        <motion.div variants={staggerItem}>
          <SectionHeader
            title={t("own.home.upcomingTitle")}
            subtitle={t("own.home.upcomingSub")}
          />
          <div className="space-y-3">
            {upcoming.map(({ walk, booking }) => (
              <div
                key={walk.id}
                className="rounded-3xl border bg-card p-4 shadow-sm flex items-center gap-3 flex-wrap"
              >
                <Avatar
                  src={booking.walker?.avatarUrl}
                  name={booking.walker?.name}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold leading-tight">
                    {booking.walker?.name ?? t("own.searchingWalker")}{" "}
                    <span className="font-semibold text-muted-foreground">
                      {t("own.withDog", { dog: walk.dog.name })}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5 flex-wrap mt-0.5">
                    <CalendarClock className="size-3.5 shrink-0" />
                    {fmtDateShort(walk.scheduledStart)} · {fmtTime(walk.scheduledStart)}
                    <span className="text-muted-foreground/60">({fmtUntil(walk.scheduledStart)})</span>
                  </p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <MapPin className="size-3" /> {booking.zone.name} ·{" "}
                    {booking.durationMin} min
                  </p>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                  {booking.walker && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full font-bold flex-1 sm:flex-none"
                      onClick={() => openWalker(booking.walker!.id)}
                    >
                      <UserRound className="size-3.5" /> {t("own.viewWalker")}
                    </Button>
                  )}
                  {booking.status === "CONFIRMED" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full font-bold flex-1 sm:flex-none"
                      onClick={() => setChatBooking(booking)}
                    >
                      <MessageCircle className="size-3.5 text-primary" /> {t("own.chat")}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Rebook engine */}
      {rebookDogs.length > 0 && (
        <motion.div variants={staggerItem}>
          <SectionHeader
            title={t("own.home.rebookTitle")}
            subtitle={t("own.home.rebookSub")}
          />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rebookDogs.map(({ dog, walkerName }) => (
              <div
                key={dog.id}
                className="rounded-3xl border bg-card p-4 shadow-sm flex items-center gap-3"
              >
                <img
                  src={dog.photoUrl ?? "/images/brand/logo-mark-mint.png"}
                  alt={t("own.dogPhotoAlt", { name: dog.name })}
                  className="size-14 rounded-2xl object-cover border bg-muted shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold leading-tight">{dog.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {walkerName
                      ? t("own.home.walkedWith", { name: walkerName.split(" ")[0] })
                      : dog.breed}
                  </p>
                </div>
                <Button
                  size="sm"
                  className="rounded-full font-bold shrink-0"
                  onClick={() => startBookingFlow({ dogId: dog.id })}
                >
                  <Repeat2 className="size-3.5" /> {t("own.repeat")}
                </Button>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Empty state */}
      {!isLoading && (bookings ?? []).length === 0 && (
        <motion.div variants={staggerItem}>
          <EmptyState
            icon={PawPrint}
            title={t("own.home.emptyTitle")}
            description={t("own.home.emptyDesc")}
            action={
              <Button
                className="rounded-full font-bold"
                size="lg"
                onClick={() => startBookingFlow()}
              >
                {t("own.home.emptyCta")}
              </Button>
            }
          />
        </motion.div>
      )}

      {/* Chat */}
      {chatBooking && chatBooking.walker && (
        <ChatDialog
          open={!!chatBooking}
          onOpenChange={(v) => !v && setChatBooking(null)}
          threadId={chatBooking.id}
          otherName={chatBooking.walker.name}
          otherAvatar={chatBooking.walker.avatarUrl}
          otherPhone={chatBooking.walker.phone}
          contextLabel={t("own.chatCtxWalks", {
            dog: chatBooking.dog.name,
            zone: chatBooking.zone.name,
          })}
        />
      )}
    </motion.div>
  );
}
