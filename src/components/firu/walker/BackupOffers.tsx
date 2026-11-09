"use client";

// Urgent backup walks offered to this walker (Milestone 8): another walker
// didn't start on time, so the walk is offered down the candidate chain, one
// walker at a time. Polls every 20 s; hidden when there is nothing on offer.

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, Hourglass, Siren, XCircle } from "lucide-react";
import { api, qk } from "@/lib/firu/api";
import { useT, srvErr } from "@/lib/firu/i18n";
import { fmtTime } from "@/lib/firu/dates";
import type { BackupOfferDTO } from "@/lib/firu/types";
import { Avatar } from "@/components/firu/shared/bits";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

function Countdown({ until }: { until: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((new Date(until).getTime() - Date.now()) / 1000));
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 dark:bg-red-950/40 px-2.5 py-0.5 text-xs font-black tabular-nums text-red-700 dark:text-red-300">
      <Hourglass className="size-3" />
      {Math.floor(s / 60)}:{`${s % 60}`.padStart(2, "0")}
    </span>
  );
}

export function BackupOffers() {
  const { t } = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: offers } = useQuery({
    queryKey: ["walks", "backup-offers"],
    queryFn: () => api.get<BackupOfferDTO[]>("/api/walks/backup-offers"),
    refetchInterval: 20_000,
  });

  const answer = useMutation({
    mutationFn: (v: { walkId: string; action: "accept" | "decline" }) =>
      api.post(`/api/walks/${v.walkId}/backup`, { action: v.action }),
    onSuccess: (_d, v) => {
      if (v.action === "accept") toast({ title: t("wlk.backup.acceptedTitle"), description: t("wlk.backup.acceptedDesc") });
      void qc.invalidateQueries({ queryKey: ["walks"] });
      void qc.invalidateQueries({ queryKey: qk.bookings });
    },
    onError: (e: Error) => {
      toast({ title: t("wlk.backup.errTitle"), description: srvErr(e.message), variant: "destructive" });
      void qc.invalidateQueries({ queryKey: ["walks", "backup-offers"] });
    },
  });

  const live = (offers ?? []).filter((o) => new Date(o.expiresAt).getTime() > Date.now());
  if (live.length === 0) return null;

  return (
    <section className="space-y-3" data-testid="backup-offers">
      {live.map((o) => (
        <div key={o.walkId} className="rounded-3xl border-2 border-red-300 dark:border-red-800 bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-300 font-black text-sm">
            <Siren className="size-4" /> {t("wlk.backup.title")}
            <span className="ml-auto">
              <Countdown until={o.expiresAt} />
            </span>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Avatar src={o.dogPhotoUrl} name={o.dogName} className="size-12 rounded-2xl" />
            <div className="min-w-0">
              <p className="font-black leading-tight">{o.dogName}</p>
              <p className="text-sm text-muted-foreground truncate">
                {o.zoneName} · {o.durationMin} {t("c.min")}
              </p>
            </div>
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-brand-soft text-primary px-2.5 py-1 text-sm font-bold">
              <Clock className="size-3.5" /> {fmtTime(o.scheduledStart)}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("wlk.backup.desc")}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="rounded-full text-muted-foreground"
              disabled={answer.isPending}
              onClick={() => answer.mutate({ walkId: o.walkId, action: "decline" })}
            >
              <XCircle className="size-4" /> {t("wlk.backup.decline")}
            </Button>
            <Button
              className="rounded-full font-extrabold"
              disabled={answer.isPending}
              onClick={() => answer.mutate({ walkId: o.walkId, action: "accept" })}
            >
              <CheckCircle2 className="size-4" /> {t("wlk.backup.accept")}
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}
