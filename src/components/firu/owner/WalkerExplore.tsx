"use client";

// Owner → Explore: browse verified walkers by zone.
// Zone chips (default = user's zone) + rating-sorted walker cards with
// trust signals (verified badge, repeat owners, response time) and CTAs.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { motion } from "framer-motion";
import {
  BadgeCheck,
  Clock,
  Footprints,
  MapPin,
  Repeat2,
  Search,
} from "lucide-react";
import { api, qk } from "@/lib/firu/api";
import { useFiruSession } from "@/lib/firu/session";
import { useT } from "@/lib/firu/i18n";
import { formatBOB } from "@/lib/firu/money";
import type { WalkerCardDTO, ZoneDTO } from "@/lib/firu/types";
import { staggerContainer, staggerItem } from "@/lib/firu/motion";
import {
  Avatar,
  EmptyState,
  RatingStars,
  SectionHeader,
} from "@/components/firu/shared/bits";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function WalkerExplore() {
  const { t } = useT();
  const user = useFiruSession((s) => s.user);
  const startBookingFlow = useFiruSession((s) => s.startBookingFlow);
  const openWalker = useFiruSession((s) => s.openWalker);
  const [zoneId, setZoneId] = useState<string | null>(null);

  const { data: zones } = useQuery({
    queryKey: qk.zones,
    queryFn: () => api.get<ZoneDTO[]>("/api/zones"),
  });

  const effectiveZoneId = zoneId ?? user?.zoneId ?? zones?.[0]?.id ?? null;

  const { data: walkers, isLoading } = useQuery({
    queryKey: qk.walkers(effectiveZoneId ?? undefined),
    queryFn: () =>
      api.get<WalkerCardDTO[]>(
        `/api/walkers${effectiveZoneId ? `?zoneId=${effectiveZoneId}` : ""}`
      ),
    enabled: !!effectiveZoneId,
  });

  const zoneName =
    zones?.find((z) => z.id === effectiveZoneId)?.name ?? t("own.yourZone");

  return (
    <motion.div
      variants={staggerContainer(0.05)}
      initial="hidden"
      animate="show"
      className="space-y-5"
    >
      <motion.div variants={staggerItem}>
        <SectionHeader
          title={t("own.explore.title")}
          subtitle={t("own.explore.subtitle", { zone: zoneName })}
        />
      </motion.div>

      {/* Zone chips */}
      <motion.div variants={staggerItem} className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {(zones ?? []).map((z) => {
          const active = z.id === effectiveZoneId;
          return (
            <button
              key={z.id}
              onClick={() => setZoneId(z.id)}
              className={cn(
                "shrink-0 rounded-full border px-4 py-1.5 text-sm font-bold transition-[color,background-color,border-color,transform] duration-200 ease-out-expo active:scale-[0.97]",
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
              )}
              aria-pressed={active}
            >
              {z.name}
            </button>
          );
        })}
        {zones === undefined && (
          <>
            <Skeleton className="h-9 w-24 rounded-full shrink-0" />
            <Skeleton className="h-9 w-28 rounded-full shrink-0" />
            <Skeleton className="h-9 w-20 rounded-full shrink-0" />
          </>
        )}
      </motion.div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="rounded-3xl border bg-card p-5 space-y-3">
              <div className="flex gap-3">
                <Skeleton className="size-16 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-24" />
                </div>
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <div className="flex gap-2 pt-2">
                <Skeleton className="h-10 flex-1 rounded-full" />
                <Skeleton className="h-10 w-28 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      ) : (walkers ?? []).length === 0 ? (
        <EmptyState
          icon={Search}
          title={t("own.explore.emptyTitle", { zone: zoneName })}
          description={t("own.explore.emptyDesc")}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(walkers ?? []).map((w) => (
            <motion.div
              key={w.userId}
              variants={staggerItem}
              className="rounded-3xl border bg-card p-5 shadow-sm flex flex-col gap-3 transition-[transform,box-shadow] duration-200 ease-out-expo hover:shadow-raise hover:-translate-y-0.5"
            >
              <div className="flex items-start gap-3">
                <Avatar src={w.avatarUrl} name={w.name} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="font-extrabold text-lg leading-tight truncate">
                      {w.name}
                    </p>
                    {w.trialDone && (
                      <span
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-primary"
                        title={t("own.verifiedBy")}
                      >
                        <BadgeCheck className="size-4" /> {t("own.verifiedChip")}
                      </span>
                    )}
                  </div>
                  <RatingStars rating={w.rating} count={w.ratingCount} />
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                    <MapPin className="size-3 shrink-0" /> {w.zoneName}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-black text-primary leading-none">
                    {formatBOB(w.price30Cents)}
                  </p>
                  <p className="text-[11px] font-semibold text-muted-foreground mt-0.5">
                    30 min
                  </p>
                </div>
              </div>

              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
                {w.bio}
              </p>

              <div className="flex flex-wrap gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold text-secondary-foreground">
                  <Footprints className="size-3" />{" "}
                  {t(w.totalWalks === 1 ? "own.walks.one" : "own.walks.many", {
                    count: w.totalWalks,
                  })}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold text-secondary-foreground">
                  <Repeat2 className="size-3" />{" "}
                  {t(
                    w.repeatOwners === 1
                      ? "own.repeatOwners.one"
                      : "own.repeatOwners.many",
                    { count: w.repeatOwners }
                  )}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold text-secondary-foreground">
                  <Clock className="size-3" /> {t("own.respondsIn", { mins: w.responseMinutes })}
                </span>
              </div>

              <div className="mt-auto flex gap-2 pt-1">
                <Button
                  className="rounded-full flex-1 font-bold"
                  onClick={() => startBookingFlow({ walkerUserId: w.userId })}
                >
                  {t("own.reservar")}
                </Button>
                <Button
                  variant="outline"
                  className="rounded-full font-bold"
                  onClick={() => openWalker(w.userId)}
                >
                  {t("own.viewProfile")}
                </Button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
