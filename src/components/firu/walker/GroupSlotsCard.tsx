"use client";

// Walker → "Paseos grupales": publish a group walk (date, time, 2–N dogs,
// sizes), see who joined, cancel the whole group (everyone is refunded).
// Each dog then appears as its own walk in the agenda and the walk screen.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Loader2, Plus, Users } from "lucide-react";
import { useState } from "react";
import { api, qk } from "@/lib/firu/api";
import { fmtDateShort, fmtTime } from "@/lib/firu/dates";
import { formatBOB } from "@/lib/firu/money";
import { srvErr, useT } from "@/lib/firu/i18n";
import type { AppConfig, DogSizeCode, GroupSlotDTO } from "@/lib/firu/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const SIZES: DogSizeCode[] = ["S", "M", "L"];

/** "YYYY-MM-DD" for `days` from today (Bolivia, UTC−4). */
const boDate = (days: number) => new Date(Date.now() - 4 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);

export function GroupSlotsCard() {
  const { t } = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(boDate(1));
  const [time, setTime] = useState("07:00");
  const [capacity, setCapacity] = useState(3);
  const [sizes, setSizes] = useState<DogSizeCode[]>(SIZES);

  const { data: config } = useQuery({ queryKey: qk.config, queryFn: () => api.get<AppConfig>("/api/config") });
  const { data: slots } = useQuery({
    queryKey: qk.groupSlots,
    queryFn: () => api.get<GroupSlotDTO[]>("/api/group-slots"),
    enabled: !!config?.groupWalks.enabled,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.groupSlots });
    qc.invalidateQueries({ queryKey: qk.bookings });
  };

  const create = useMutation({
    mutationFn: () => {
      const [h, m] = time.split(":").map(Number);
      return api.post<GroupSlotDTO>("/api/group-slots", { date, minute: h * 60 + m, capacity, sizes });
    },
    onSuccess: () => {
      setOpen(false);
      toast({ title: t("wlk.group.created") });
      refresh();
    },
    onError: (e: Error) => toast({ title: t("wlk.group.err"), description: srvErr(e.message), variant: "destructive" }),
  });
  const cancel = useMutation({
    mutationFn: (s: GroupSlotDTO) => api.patch(`/api/group-slots/${s.id}`, { action: "cancel" }),
    onSuccess: () => {
      toast({ title: t("wlk.group.cancelled") });
      refresh();
    },
    onError: (e: Error) => toast({ title: t("wlk.group.err"), description: srvErr(e.message), variant: "destructive" }),
  });

  const g = config?.groupWalks;
  if (!g?.enabled) return null;
  const upcoming = (slots ?? []).filter((s) => s.status === "OPEN" && new Date(s.startsAt).getTime() > Date.now() - s.durationMin * 60_000);
  const maxDogs = Math.min(4, Math.max(2, g.maxDogs));

  return (
    <section className="rounded-3xl border bg-card p-4 shadow-sm space-y-3" aria-labelledby="wlk-group-title">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary">
          <Users className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="wlk-group-title" className="font-extrabold leading-tight">{t("wlk.group.cardTitle")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("wlk.group.cardDesc", { min: g.durationMin, share: formatBOB(g.walkerPerDogCents), max: maxDogs })}
          </p>
        </div>
        {!open && (
          <Button size="sm" className="rounded-full shrink-0" onClick={() => setOpen(true)}>
            <Plus className="size-4" /> {t("wlk.group.new")}
          </Button>
        )}
      </div>

      {open && (
        <form
          className="grid gap-3 rounded-2xl border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="grp-date">{t("wlk.group.date")}</Label>
              <Input id="grp-date" type="date" min={boDate(0)} max={boDate(14)} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="grp-time">{t("wlk.group.time")}</Label>
              <Input id="grp-time" type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>{t("wlk.group.dogs")}</Label>
            <div className="mt-1 flex gap-2">
              {Array.from({ length: maxDogs - 1 }, (_, i) => i + 2).map((n) => (
                <Button key={n} type="button" size="sm" variant={capacity === n ? "default" : "outline"} className="rounded-full" onClick={() => setCapacity(n)}>
                  {n}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <Label>{t("wlk.group.sizes")}</Label>
            <div className="mt-1 flex gap-2">
              {SIZES.map((s) => {
                const on = sizes.includes(s);
                return (
                  <Button
                    key={s}
                    type="button"
                    size="sm"
                    variant={on ? "default" : "outline"}
                    className="rounded-full"
                    aria-pressed={on}
                    onClick={() => setSizes(on ? sizes.filter((x) => x !== s) : [...sizes, s])}
                  >
                    {t(`wlk.group.size.${s}`)}
                  </Button>
                );
              })}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("wlk.group.rules", { hours: Math.round(g.joinCloseMinutes / 60) })}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" className="rounded-full" onClick={() => setOpen(false)}>
              {t("c.cancel")}
            </Button>
            <Button type="submit" className="rounded-full font-bold" disabled={create.isPending || sizes.length === 0}>
              {create.isPending && <Loader2 className="size-4 animate-spin" />}
              {t("wlk.group.publish")}
            </Button>
          </div>
        </form>
      )}

      {upcoming.length === 0 && !open && <p className="text-sm text-muted-foreground">{t("wlk.group.none")}</p>}
      {upcoming.map((s) => (
        <div key={s.id} className="rounded-2xl border p-3 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold">
              {fmtDateShort(s.startsAt)} · {fmtTime(s.startsAt)}
            </p>
            <Badge variant={s.spotsLeft === 0 ? "default" : "secondary"}>
              {t("wlk.group.taken", { taken: s.taken, capacity: s.capacity })}
            </Badge>
            <span className="ml-auto text-xs font-semibold text-primary tabular-nums">
              {formatBOB((s.walkerPerDogCents ?? 0) * s.taken)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {s.dogs.length ? s.dogs.map((d) => `${d.dogName} (${d.ownerName.split(" ")[0]})`).join(" · ") : t("wlk.group.waiting")}
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 rounded-full text-xs text-destructive"
            disabled={cancel.isPending}
            onClick={() => {
              if (window.confirm(s.taken > 0 ? t("wlk.group.cancelConfirmDogs", { n: s.taken }) : t("wlk.group.cancelConfirm"))) cancel.mutate(s);
            }}
          >
            <Ban className="size-3.5" /> {t("wlk.group.cancel")}
          </Button>
        </div>
      ))}
    </section>
  );
}
