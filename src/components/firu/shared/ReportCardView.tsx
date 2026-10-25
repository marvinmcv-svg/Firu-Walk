"use client";

// Post-walk report card: map trace, duration, distance, photos, pee/poo/water, note.

import { Droplets, MapPin, PencilLine, Toilet } from "lucide-react";
import { WalkMap } from "./WalkMap";
import { cn } from "@/lib/utils";
import type { ReportCardDTO } from "@/lib/firu/types";
import { fmtDateShort, fmtTime } from "@/lib/firu/dates";
import { useT } from "@/lib/firu/i18n";

export function ReportCardView({
  report: initialReport,
  track,
  startedAt,
  endedAt,
  distanceMeters,
  durationMin,
  dogName,
  dogAvatar,
  walkerAvatar,
  editable,
  onChange,
  className,
}: {
  report: ReportCardDTO | null;
  track: [number, number][];
  startedAt?: string | null;
  endedAt?: string | null;
  distanceMeters: number;
  durationMin: number;
  dogName?: string;
  dogAvatar?: string | null;
  walkerAvatar?: string | null;
  editable?: boolean;
  onChange?: (patch: Partial<ReportCardDTO>) => void;
  className?: string;
}) {
  const { t, lang } = useT();
  const report = initialReport ?? {
    note: "",
    pee: false,
    poo: false,
    water: false,
    photos: [],
    createdAt: new Date().toISOString(),
  };
  const minutes =
    endedAt && startedAt
      ? Math.max(
          1,
          Math.round((+new Date(endedAt) - +new Date(startedAt)) / 60000)
        )
      : durationMin;
  const km = (distanceMeters / 1000).toFixed(2).replace(".", lang === "en" ? "." : ",");

  return (
    <div className={cn("space-y-3", className)}>
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl bg-brand-soft/70 py-2.5">
          <p className="text-lg font-black text-primary">{minutes} {t("c.min")}</p>
          <p className="text-[11px] font-semibold text-muted-foreground">{t("sh.report.duration")}</p>
        </div>
        <div className="rounded-2xl bg-brand-soft/70 py-2.5">
          <p className="text-lg font-black text-primary">{km} km</p>
          <p className="text-[11px] font-semibold text-muted-foreground">{t("sh.report.distance")}</p>
        </div>
        <div className="rounded-2xl bg-brand-soft/70 py-2.5">
          <p className="text-lg font-black text-primary">
            {startedAt ? fmtTime(startedAt) : "—"}
          </p>
          <p className="text-[11px] font-semibold text-muted-foreground">{t("sh.report.startTime")}</p>
        </div>
      </div>

      {/* Map */}
      {track.length > 0 && (
        <WalkMap
          track={track}
          walkerAvatar={walkerAvatar}
          dogAvatar={dogAvatar}
          className="h-56 w-full rounded-2xl overflow-hidden border"
          fitPadding={30}
        />
      )}
      {track.length === 0 && (
        <div className="h-40 rounded-2xl border border-dashed grid place-items-center text-sm text-muted-foreground firu-paw-pattern">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="size-4" /> {t("sh.report.trackPending")}
          </span>
        </div>
      )}

      {/* pee / poo / water */}
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["pee", t("sh.report.pee"), Toilet],
            ["poo", t("sh.report.poo"), Toilet],
            ["water", t("sh.report.water"), Droplets],
          ] as const
        ).map(([key, label, Icon]) => {
          const on = report[key];
          return (
            <button
              key={key}
              type="button"
              disabled={!editable}
              onClick={() =>
                editable && onChange?.({ [key]: !on } as Partial<ReportCardDTO>)
              }
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-2xl border-2 py-2 text-sm font-bold transition-[border-color,background-color,color,transform] duration-200 ease-out-expo",
                on
                  ? "border-primary bg-brand-soft text-primary"
                  : "border-border text-muted-foreground",
                editable && "hover:border-primary/50 cursor-pointer active:scale-[0.97]"
              )}
              aria-pressed={on}
            >
              <Icon className="size-4" />
              {label} {on ? "✓" : ""}
            </button>
          );
        })}
      </div>

      {/* Photos */}
      {report.photos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {report.photos.map((p, i) => (
            <img
              key={i}
              src={p}
              alt={t("sh.report.photoAlt", { n: i + 1, dog: dogName ?? t("sh.report.yourDog") })}
              className="size-24 rounded-xl object-cover border shrink-0"
            />
          ))}
        </div>
      )}

      {/* Note */}
      {editable ? (
        <textarea
          value={report.note ?? ""}
          onChange={(e) => onChange?.({ note: e.target.value })}
          placeholder={t("sh.report.notePlaceholder", { dog: dogName ?? t("sh.report.theDog") })}
          rows={3}
          className="w-full rounded-2xl border bg-card p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        />
      ) : (
        (report.note || "").length > 0 ? (
          <div className="rounded-2xl bg-secondary/60 p-3 text-sm leading-relaxed flex gap-2">
            <PencilLine className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
            <p>{report.note}</p>
          </div>
        ) : null
      )}

      {startedAt && (
        <p className="text-xs text-muted-foreground">
          {fmtDateShort(startedAt)} · {fmtTime(startedAt)}
          {endedAt ? ` – ${fmtTime(endedAt)}` : ""}
        </p>
      )}
    </div>
  );
}
