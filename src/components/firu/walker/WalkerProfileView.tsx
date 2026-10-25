"use client";

// Walker public-facing profile ("Perfil"): hero with status + reputation,
// bio/zones/prices, received reviews, transparency (strikes, trial period)
// and a WhatsApp CTA for profile updates (read-only MVP).

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  BadgeCheck,
  Clock,
  GraduationCap,
  MapPin,
  MessageCircle,
  PawPrint,
  Quote,
  Sparkles,
  Star,
  UserRound,
} from "lucide-react";
import { api, qk } from "@/lib/firu/api";
import { useFiruSession } from "@/lib/firu/session";
import { useT } from "@/lib/firu/i18n";
import { formatBOB } from "@/lib/firu/money";
import { fmtRelative } from "@/lib/firu/dates";
import type { AppConfig, WalkerDetailDTO } from "@/lib/firu/types";
import { springSmooth } from "@/lib/firu/motion";
import {
  Avatar,
  EmptyState,
  RatingStars,
  SectionHeader,
  StatusBadge,
  whatsappHref,
} from "@/components/firu/shared/bits";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export function WalkerProfileView() {
  const user = useFiruSession((s) => s.user);
  const { toast } = useToast();
  const { t } = useT();
  const walker = user?.walker ?? null;

  const { data: detail, isLoading } = useQuery({
    queryKey: qk.walker(user?.id ?? ""),
    queryFn: () => api.get<WalkerDetailDTO>(`/api/walkers/${user!.id}`),
    enabled: !!user,
  });
  const { data: config } = useQuery({
    queryKey: qk.config,
    queryFn: () => api.get<AppConfig>("/api/config"),
  });

  if (!user) return null;

  const trialWalks = config?.policy.trialWalks ?? 5;
  const reviews = detail?.reviews ?? [];

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Hero */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springSmooth}
      >
        <SectionHeader title={t("wlk.profile.title")} subtitle={t("wlk.profile.subtitle")} />
        {isLoading ? (
          <Skeleton className="h-52 rounded-3xl" />
        ) : (
          <div className="rounded-3xl border bg-card p-5 shadow-sm">
            <div className="flex items-start gap-4">
              <Avatar src={user.avatarUrl} name={user.name} size="lg" className="rounded-3xl" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-black tracking-tight truncate">{user.name}</h2>
                  {walker?.status === "ACTIVE" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft text-primary border border-primary/30 px-2 py-0.5 text-[11px] font-black">
                      <BadgeCheck className="size-3.5" /> {t("shell.verified")}
                    </span>
                  )}
                  {walker && <StatusBadge status={walker.status} kind="walker" />}
                </div>
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  <RatingStars
                    rating={walker?.rating ?? 0}
                    count={walker?.ratingCount}
                    size="md"
                  />
                  <span className="inline-flex items-center gap-1 text-sm text-muted-foreground font-semibold">
                    <MapPin className="size-4" />
                    {user.zoneName ?? walker?.zoneName ?? detail?.zoneName}
                  </span>
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-5">
              <StatChip icon={PawPrint} value={walker?.totalWalks ?? 0} label={t("wlk.profile.statWalks")} />
              <StatChip icon={Star} value={walker?.repeatOwners ?? 0} label={t("wlk.profile.statRepeat")} />
              <StatChip
                icon={Clock}
                value={`~${walker?.responseMinutes ?? 0} ${t("c.min")}`}
                label={t("wlk.profile.statResponse")}
              />
              <StatChip
                icon={GraduationCap}
                value={`${detail?.experienceYears ?? walker?.experienceYears ?? 0} ${t("wlk.profile.years")}`}
                label={t("wlk.profile.statExperience")}
              />
            </div>
          </div>
        )}
      </motion.section>

      {/* Trial period banner */}
      {walker && !walker.trialDone && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springSmooth, delay: 0.05 }}
          className="rounded-2xl border bg-sun-soft/70 border-amber-300 p-4 flex items-start gap-3"
          role="status"
        >
          <Sparkles className="size-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 dark:text-amber-400 leading-relaxed">
            <b>{t("wlk.profile.trialLabel")}</b>
            {t("wlk.profile.trialBody", { n: trialWalks })}
          </p>
        </motion.div>
      )}

      {/* Strikes transparency */}
      {(walker?.strikes ?? 0) > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springSmooth, delay: 0.05 }}
          className="rounded-2xl border bg-sun-soft/70 border-amber-300 p-4 flex items-start gap-3"
          role="alert"
        >
          <AlertTriangle className="size-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-extrabold text-amber-800 dark:text-amber-400">
              {t("wlk.profile.strikesTitle", { n: walker?.strikes ?? 0 })}
            </p>
            <p className="text-sm text-amber-800/80 dark:text-amber-400/80 mt-1 leading-relaxed">
              {t("wlk.profile.strikesBody")}
            </p>
          </div>
        </motion.div>
      )}

      {/* Bio + prices */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springSmooth, delay: 0.1 }}
        className="space-y-4"
      >
        <div className="rounded-3xl border bg-card p-5 shadow-sm">
          <p className="font-black flex items-center gap-2 mb-2">
            <UserRound className="size-4.5 text-primary" /> {t("wlk.profile.about")}
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {detail?.bio ?? walker?.bio ?? t("wlk.profile.bioPlaceholder")}
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2.5">
            {(
              [
                [detail?.price30Cents ?? walker?.price30Cents ?? 0, `30 ${t("c.min")}`],
                [detail?.price45Cents ?? walker?.price45Cents ?? 0, `45 ${t("c.min")}`],
                [detail?.price60Cents ?? walker?.price60Cents ?? 0, `60 ${t("c.min")}`],
              ] as const
            ).map(([cents, label]) => (
              <div
                key={label}
                className="rounded-2xl bg-brand-soft/70 p-3 text-center"
              >
                <p className="font-black text-primary">{formatBOB(cents)}</p>
                <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* Reviews */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springSmooth, delay: 0.15 }}
      >
        <SectionHeader
          title={t("wlk.profile.reviewsTitle")}
          subtitle={t("wlk.profile.reviewsSubtitle")}
        />
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
          </div>
        ) : reviews.length === 0 ? (
          <EmptyState
            icon={Star}
            title={t("wlk.profile.reviewsEmptyTitle")}
            description={t("wlk.profile.reviewsEmptyDesc")}
          />
        ) : (
          <div className="space-y-2.5 max-h-96 overflow-y-auto pr-0.5">
            {reviews.map((r) => (
              <div key={r.id} className="rounded-3xl border bg-card p-4 shadow-sm">
                <div className="flex items-center gap-3">
                  <Avatar src={r.ownerAvatarUrl} name={r.ownerName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold truncate">{r.ownerName}</p>
                    <p className="text-xs text-muted-foreground">{fmtRelative(r.createdAt)}</p>
                  </div>
                  <RatingStars rating={r.rating} />
                </div>
                {r.comment && (
                  <div className="mt-3 flex gap-2 rounded-2xl bg-secondary/60 p-3 text-sm leading-relaxed">
                    <Quote className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
                    <p>{r.comment}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </motion.section>

      {/* Update profile CTA (read-only MVP) */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springSmooth, delay: 0.2 }}
        className="rounded-3xl border bg-card p-5 shadow-sm"
      >
        <p className="font-black flex items-center gap-2">
          <MessageCircle className="size-4.5 text-primary" /> {t("wlk.profile.updateTitle")}
        </p>
        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
          {t("wlk.profile.updateBody")}
        </p>
        <Button
          asChild
          className="mt-3 rounded-full font-bold"
          size="sm"
        >
          <a
            href={whatsappHref(
              config?.platform.supportWhatsApp ?? "",
              t("wlk.profile.waMsg", { name: user.name })
            )}
            target="_blank"
            rel="noreferrer"
            onClick={() =>
              toast({ title: t("wlk.profile.waToastTitle"), description: t("wlk.profile.waToastDesc") })
            }
          >
            <MessageCircle className="size-4" /> {t("wlk.writeWhatsApp")}
          </a>
        </Button>
      </motion.section>
    </div>
  );
}

/* ------------------------- Stat chip ------------------------- */

function StatChip({
  icon: Icon,
  value,
  label,
}: {
  icon: React.ElementType;
  value: React.ReactNode;
  label: string;
}) {
  return (
    <div className={cn("rounded-2xl bg-brand-soft/70 p-3 text-center")}>
      <Icon className="size-4 text-primary mx-auto" />
      <p className="font-black mt-1">{value}</p>
      <p className="text-[11px] font-semibold text-muted-foreground leading-tight">{label}</p>
    </div>
  );
}
