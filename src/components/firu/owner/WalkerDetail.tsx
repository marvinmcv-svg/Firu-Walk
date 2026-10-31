"use client";

// Owner → Walker public profile: hero with trust signals, weekly availability
// grid, reviews and price bands with booking CTA.

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  BadgeCheck,
  CalendarCheck,
  Clock,
  Footprints,
  MapPin,
  Repeat2,
  Star,
  UserRound,
} from "lucide-react";
import { api, qk } from "@/lib/firu/api";
import { useFiruSession } from "@/lib/firu/session";
import { useT } from "@/lib/firu/i18n";
import { formatBOB } from "@/lib/firu/money";
import { daysShort, fmtRelative, minuteOfDay } from "@/lib/firu/dates";
import type { WalkerDetailDTO } from "@/lib/firu/types";
import { easeOutExpo } from "@/lib/firu/motion";
import {
  Avatar,
  EmptyState,
  RatingStars,
  SectionHeader,
} from "@/components/firu/shared/bits";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** Monday-first day order for the availability grid. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

export function WalkerDetail() {
  const { t, lang } = useT();
  const walkerUserId = useFiruSession((s) => s.selectedWalkerUserId);
  const startBookingFlow = useFiruSession((s) => s.startBookingFlow);
  const setOwnerView = useFiruSession((s) => s.setOwnerView);

  const { data: walker, isLoading } = useQuery({
    queryKey: qk.walker(walkerUserId ?? ""),
    queryFn: () => api.get<WalkerDetailDTO>(`/api/walkers/${walkerUserId}`),
    enabled: !!walkerUserId,
  });

  // availability slots grouped by weekday (Monday-first grid)
  const byDay = useMemo(() => {
    const m = new Map<number, { startMinute: number; endMinute: number }[]>();
    for (const a of walker?.availability ?? []) {
      const list = m.get(a.dayOfWeek) ?? [];
      list.push(a);
      m.set(a.dayOfWeek, list);
    }
    for (const list of m.values()) list.sort((a, b) => a.startMinute - b.startMinute);
    return m;
  }, [walker]);

  if (!walkerUserId) {
    return (
      <EmptyState
        icon={UserRound}
        title={t("own.detail.noneTitle")}
        description={t("own.detail.noneDesc")}
        action={
          <Button className="rounded-full font-bold" onClick={() => setOwnerView("explore")}>
            {t("own.detail.exploreCta")}
          </Button>
        }
      />
    );
  }

  if (isLoading || !walker) {
    return (
      <div className="space-y-4 max-w-3xl">
        <Skeleton className="h-9 w-32 rounded-full" />
        <div className="rounded-3xl border bg-card p-6 space-y-4">
          <div className="flex gap-4">
            <Skeleton className="size-20 rounded-full" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-4 w-56" />
            </div>
          </div>
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
        <Skeleton className="h-40 w-full rounded-3xl" />
      </div>
    );
  }

  const firstName = walker.name.split(" ")[0];

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={easeOutExpo}
      className="space-y-5 max-w-3xl"
    >
      <Button
        variant="ghost"
        className="rounded-full font-bold text-muted-foreground -ml-2"
        onClick={() => setOwnerView("explore")}
      >
        <ArrowLeft className="size-4" /> {t("shell.nav.explore")}
      </Button>

      {/* Hero */}
      <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-4">
        <div className="flex items-start gap-4">
          <Avatar src={walker.avatarUrl} name={walker.name} size="lg" className="size-20" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-black tracking-tight leading-tight">
                {walker.name}
              </h1>
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft border border-primary/30 px-2.5 py-0.5 text-[11px] font-bold text-primary">
                <BadgeCheck className="size-3.5" /> {t("shell.verified")}
              </span>
            </div>
            <div className="mt-1.5">
              <RatingStars rating={walker.rating} count={walker.ratingCount} size="md" />
            </div>
            <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1.5">
              <MapPin className="size-3.5 shrink-0" /> {t("own.detail.walkerIn", { zone: walker.zoneName })}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-2xl bg-brand-soft/60 p-3 text-center">
            <p className="text-lg font-black text-primary leading-none">
              {walker.experienceYears}
            </p>
            <p className="text-[11px] font-semibold text-muted-foreground mt-1">
              {t(
                walker.experienceYears === 1
                  ? "own.detail.experience.one"
                  : "own.detail.experience.many"
              )}
            </p>
          </div>
          <div className="rounded-2xl bg-brand-soft/60 p-3 text-center">
            <p className="text-lg font-black text-primary leading-none">
              ~{walker.responseMinutes} min
            </p>
            <p className="text-[11px] font-semibold text-muted-foreground mt-1">
              {t("own.detail.responseLabel")}
            </p>
          </div>
          <div className="rounded-2xl bg-brand-soft/60 p-3 text-center">
            <p className="text-lg font-black text-primary leading-none">
              {walker.repeatOwners}
            </p>
            <p className="text-[11px] font-semibold text-muted-foreground mt-1">
              {t(
                walker.repeatOwners === 1
                  ? "own.detail.repeatOwners.one"
                  : "own.detail.repeatOwners.many"
              )}
            </p>
          </div>
          <div className="rounded-2xl bg-brand-soft/60 p-3 text-center">
            <p className="text-lg font-black text-primary leading-none">
              {walker.totalWalks}
            </p>
            <p className="text-[11px] font-semibold text-muted-foreground mt-1">
              {t(
                walker.totalWalks === 1
                  ? "own.detail.completedWalks.one"
                  : "own.detail.completedWalks.many"
              )}
            </p>
          </div>
        </div>

        <p className="text-sm leading-relaxed text-muted-foreground">{walker.bio}</p>
      </div>

      {/* Availability */}
      <div>
        <SectionHeader
          title={t("own.detail.availabilityTitle")}
          subtitle={t("own.detail.availabilitySub")}
        />
        <div className="rounded-3xl border bg-card p-4 shadow-sm">
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
            {WEEK.map((day, i) => {
              const slots = byDay.get(day) ?? [];
              return (
                <div
                  key={day}
                  className="rounded-2xl bg-muted/40 p-2 min-h-24 text-center"
                >
                  <p
                    className="text-xs font-black text-muted-foreground mb-1.5"
                    title={daysShort(lang)[day]}
                  >
                    {daysShort(lang)[day][0]}
                  </p>
                  <div className="space-y-1">
                    {slots.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground/60">—</p>
                    ) : (
                      slots.map((s, j) => (
                        <p
                          key={j}
                          className="text-[10px] sm:text-[11px] font-bold text-primary leading-snug"
                        >
                          {minuteOfDay(s.startMinute)}–{minuteOfDay(s.endMinute)}
                        </p>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Reviews */}
      <div>
        <SectionHeader
          title={t("own.detail.reviewsTitle")}
          subtitle={t(
            walker.ratingCount === 1
              ? "own.detail.reviewsSub.one"
              : "own.detail.reviewsSub.many",
            { count: walker.ratingCount, name: firstName }
          )}
        />
        <div className="rounded-3xl border bg-card p-4 shadow-sm">
          {walker.reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              {t("own.detail.noReviews", { name: firstName })}
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto pr-1 space-y-4">
              {walker.reviews.map((r) => (
                <div key={r.id} className="flex gap-3">
                  <Avatar src={r.ownerAvatarUrl} name={r.ownerName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-sm font-bold">{r.ownerName}</p>
                      <p className="text-[11px] text-muted-foreground">{fmtRelative(r.createdAt)}</p>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <Star
                          key={i}
                          className={
                            i <= r.rating
                              ? "size-3.5 fill-sun text-sun"
                              : "size-3.5 fill-muted text-muted-foreground/40"
                          }
                        />
                      ))}
                    </div>
                    {r.comment && (
                      <p className="text-sm text-muted-foreground leading-relaxed mt-1">
                        {r.comment}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Prices + CTA */}
      <div className="rounded-3xl border-2 border-primary/25 bg-brand-soft/50 p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <CalendarCheck className="size-5 text-primary" />
          <p className="font-black text-lg">{t("own.detail.pricesTitle", { name: firstName })}</p>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {(
            [
              [30, walker.price30Cents],
              [45, walker.price45Cents],
              [60, walker.price60Cents],
            ] as const
          ).map(([mins, cents]) => (
            <div key={mins} className="rounded-2xl bg-card border p-3 text-center">
              <p className="text-xl font-black text-primary">{formatBOB(cents)}</p>
              <p className="text-[11px] font-semibold text-muted-foreground">{mins} min</p>
            </div>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            size="lg"
            className="rounded-full flex-1 font-bold text-base h-12"
            onClick={() => startBookingFlow({ walkerUserId: walker.userId })}
          >
            {t("own.detail.bookWith", { name: firstName })}
          </Button>
        </div>
        <div className="flex items-center justify-center gap-4 mt-3 text-[11px] font-semibold text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Footprints className="size-3.5" /> {t("own.detail.trustGps")}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" /> {t("own.detail.trustHeld")}
          </span>
          <span className="inline-flex items-center gap-1">
            <Repeat2 className="size-3.5" /> {t("own.detail.trustNoSpam")}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
