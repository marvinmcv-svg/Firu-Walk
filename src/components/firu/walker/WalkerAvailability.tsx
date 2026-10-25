"use client";

// Walker availability ("Mi agenda"): Mon–Sun weekly grid showing availability
// ranges (read-only for the MVP) + scheduled walk chips per day, plus a
// WhatsApp CTA for slot changes (in-app editing is P1).

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  CalendarClock,
  CalendarDays,
  Clock,
  MessageCircle,
  PawPrint,
  Sparkles,
} from "lucide-react";
import { api, qk } from "@/lib/firu/api";
import { useFiruSession } from "@/lib/firu/session";
import { useT } from "@/lib/firu/i18n";
import { daysShort, fmtTime, minuteOfDay } from "@/lib/firu/dates";
import type { AppConfig, BookingDTO, WalkerDetailDTO } from "@/lib/firu/types";
import { springSmooth } from "@/lib/firu/motion";
import { EmptyState, SectionHeader, whatsappHref } from "@/components/firu/shared/bits";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Grid order: Monday → Sunday (JS getDay convention: 0 = Sunday). */
const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 0];

interface DayWalk {
  key: string;
  dogName: string;
  time: string;
  zoneName: string;
  today: boolean;
}

export function WalkerAvailability() {
  const user = useFiruSession((s) => s.user);
  const { t, lang } = useT();

  const { data: detail, isLoading } = useQuery({
    queryKey: qk.walker(user?.id ?? ""),
    queryFn: () => api.get<WalkerDetailDTO>(`/api/walkers/${user!.id}`),
    enabled: !!user,
  });
  const { data: bookings } = useQuery({
    queryKey: qk.bookings,
    queryFn: () => api.get<BookingDTO[]>("/api/bookings"),
  });
  const { data: config } = useQuery({
    queryKey: qk.config,
    queryFn: () => api.get<AppConfig>("/api/config"),
  });

  // Upcoming reserved walks (confirmed bookings), bucketed by weekday.
  const walksByDay = new Map<number, DayWalk[]>();
  const today = new Date();
  const todayDow = today.getDay();
  for (const b of bookings ?? []) {
    if (b.status !== "CONFIRMED") continue;
    for (const w of b.walks) {
      if (w.status !== "SCHEDULED" && w.status !== "IN_PROGRESS") continue;
      const start = new Date(w.scheduledStart);
      const sameDay =
        start.getFullYear() === today.getFullYear() &&
        start.getMonth() === today.getMonth() &&
        start.getDate() === today.getDate();
      const list = walksByDay.get(start.getDay()) ?? [];
      list.push({
        key: w.id,
        dogName: w.dog.name,
        time: fmtTime(w.scheduledStart),
        zoneName: b.zone.name,
        today: sameDay,
      });
      walksByDay.set(start.getDay(), list);
    }
  }
  for (const list of walksByDay.values()) {
    list.sort((a, b) => a.time.localeCompare(b.time));
  }

  if (!user) return null;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springSmooth}
      >
        <SectionHeader
          title={t("wlk.agenda.title")}
          subtitle={t("wlk.agenda.subtitle")}
        />
      </motion.section>

      {/* Legend */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springSmooth, delay: 0.05 }}
        className="flex items-center gap-4 flex-wrap text-xs font-semibold text-muted-foreground"
      >
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-full bg-secondary border" /> {t("wlk.agenda.legendAvail")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-full bg-brand-soft border border-primary/30" /> {t("wlk.agenda.legendWalk")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-full bg-primary" /> {t("c.today")}
        </span>
      </motion.div>

      {/* Weekly grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {WEEK_DAYS.map((d) => (
            <Skeleton key={d} className="h-44 rounded-3xl" />
          ))}
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springSmooth, delay: 0.1 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3"
        >
          {WEEK_DAYS.map((d) => {
            const slots = (detail?.availability ?? []).filter((s) => s.dayOfWeek === d);
            const walks = walksByDay.get(d) ?? [];
            const isToday = d === todayDow;
            return (
              <div
                key={d}
                className={cn(
                  "rounded-3xl border bg-card p-4 shadow-sm flex flex-col gap-3 min-h-40",
                  isToday && "border-primary ring-2 ring-primary/20"
                )}
              >
                <div className="flex items-center justify-between">
                  <p className="font-black capitalize">{daysShort(lang)[d]}</p>
                  {isToday && (
                    <span className="rounded-full bg-primary text-primary-foreground px-2 py-0.5 text-[10px] font-black uppercase">
                      {t("c.today")}
                    </span>
                  )}
                </div>

                {/* Availability ranges */}
                <div className="flex flex-wrap gap-1.5">
                  {slots.length === 0 && (
                    <span className="text-xs text-muted-foreground">{t("wlk.agenda.noAvail")}</span>
                  )}
                  {slots.map((s, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 rounded-full bg-secondary border px-2.5 py-1 text-xs font-bold text-secondary-foreground"
                    >
                      <Clock className="size-3" />
                      {minuteOfDay(s.startMinute)} – {minuteOfDay(s.endMinute)}
                    </span>
                  ))}
                </div>

                {/* Reserved walks */}
                {walks.length > 0 && (
                  <div className="mt-auto space-y-1.5">
                    {walks.map((w) => (
                      <span
                        key={w.key}
                        className={cn(
                          "flex items-center gap-2 rounded-2xl bg-brand-soft border border-primary/30 px-2.5 py-1.5 text-xs font-bold text-primary",
                          w.today && "bg-primary text-primary-foreground border-transparent"
                        )}
                      >
                        <PawPrint className="size-3.5 shrink-0" />
                        <span className="truncate">
                          {w.dogName} · {w.time}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </motion.div>
      )}

      {/* Editing CTA (read-only MVP) */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springSmooth, delay: 0.15 }}
        className="rounded-3xl border bg-card p-5 shadow-sm"
      >
        <div className="flex items-start gap-3">
          <span className="grid place-items-center size-11 rounded-2xl bg-brand-soft text-primary shrink-0">
            <CalendarClock className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="font-black flex items-center gap-2 flex-wrap">
              {t("wlk.agenda.ctaTitle")}
              <span className="inline-flex items-center gap-1 rounded-full bg-sun-soft border border-amber-300 text-amber-700 px-2 py-0.5 text-[10px] font-black uppercase">
                <Sparkles className="size-3" /> {t("wlk.agenda.ctaSoon")}
              </span>
            </p>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              {t("wlk.agenda.ctaBody")}
            </p>
            <Button
              asChild
              className="mt-3 rounded-full font-bold"
              size="sm"
            >
              <a
                href={whatsappHref(
                  config?.platform.supportWhatsApp ?? "",
                  t("wlk.agenda.waMsg")
                )}
                target="_blank"
                rel="noreferrer"
              >
                <MessageCircle className="size-4" /> {t("wlk.writeWhatsApp")}
              </a>
            </Button>
          </div>
        </div>
      </motion.section>

      {/* Empty state when no availability at all */}
      {!isLoading && (detail?.availability ?? []).length === 0 && (
        <EmptyState
          icon={CalendarDays}
          title={t("wlk.agenda.emptyTitle")}
          description={t("wlk.agenda.emptyDesc")}
        />
      )}
    </div>
  );
}
