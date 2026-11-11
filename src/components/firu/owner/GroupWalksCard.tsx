"use client";

// Owner → "Paseos grupales": group walks offered in the owner's zone. Join
// with one dog (calm/energetic dogs of an allowed size), pick how to pay; the
// result is an ordinary confirmed booking (cancel it like any other).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Star, Users } from "lucide-react";
import { useState } from "react";
import { api, qk } from "@/lib/firu/api";
import { fmtDateShort, fmtTime } from "@/lib/firu/dates";
import { formatBOB } from "@/lib/firu/money";
import { srvErr, useT } from "@/lib/firu/i18n";
import type { AppConfig, BookingDTO, DogDTO, GroupSlotDTO, PaymentDTO } from "@/lib/firu/types";
import { PaymentDialog } from "@/components/firu/shared/PaymentDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Method = "QR" | "TRANSFER" | "CASH";

export function GroupWalksCard() {
  const { t } = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [joining, setJoining] = useState<GroupSlotDTO | null>(null);
  const [dogId, setDogId] = useState<string | null>(null);
  const [method, setMethod] = useState<Method>("QR");
  const [paying, setPaying] = useState<PaymentDTO | null>(null);

  const { data: config } = useQuery({ queryKey: qk.config, queryFn: () => api.get<AppConfig>("/api/config") });
  const enabled = !!config?.groupWalks.enabled;
  const { data: slots } = useQuery({
    queryKey: qk.groupSlots,
    queryFn: () => api.get<GroupSlotDTO[]>("/api/group-slots"),
    enabled,
  });
  const { data: dogs } = useQuery({ queryKey: qk.dogs(), queryFn: () => api.get<DogDTO[]>("/api/dogs"), enabled });

  const join = useMutation({
    mutationFn: () => api.post<BookingDTO>(`/api/group-slots/${joining!.id}/join`, { dogId, paymentMethod: method }),
    onSuccess: (b) => {
      setJoining(null);
      qc.invalidateQueries({ queryKey: qk.groupSlots });
      qc.invalidateQueries({ queryKey: qk.bookings });
      toast({ title: t("own.group.joined"), description: t("own.group.joinedDesc") });
      if (b.payment && (b.payment.method === "QR" || b.payment.method === "TRANSFER")) setPaying(b.payment);
    },
    onError: (e: Error) => toast({ title: t("own.group.err"), description: srvErr(e.message), variant: "destructive" }),
  });

  if (!enabled) return null;
  const visible = (slots ?? []).filter((s) => s.joinable || s.myBookingIds.length > 0);
  if (visible.length === 0) return null;

  const eligible = (s: GroupSlotDTO) =>
    (dogs ?? []).filter((d) => d.temperament !== "ANXIOUS" && s.sizes.includes(d.size as "S" | "M" | "L"));

  return (
    <section className="space-y-3" aria-labelledby="own-group-title">
      <div>
        <h2 id="own-group-title" className="flex items-center gap-2 text-lg font-black">
          <Users className="size-5 text-primary" /> {t("own.group.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("own.group.subtitle")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {visible.map((s) => (
          <div key={s.id} className="rounded-3xl border bg-card p-4 shadow-sm space-y-2 min-w-0">
            <div className="flex items-start gap-3">
              <img
                src={s.walker.avatarUrl ?? "/images/brand/logo-mark-mint.png"}
                alt=""
                className="size-11 shrink-0 rounded-full border object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="font-bold truncate">{s.walker.name}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  {s.walker.rating ? (
                    <>
                      <Star className="size-3 fill-amber-400 text-amber-400" /> {s.walker.rating.toFixed(1)} ·{" "}
                    </>
                  ) : null}
                  {s.zone.name}
                </p>
              </div>
              <Badge variant="secondary">{t("own.group.spots", { n: s.spotsLeft })}</Badge>
            </div>
            <p className="text-sm font-semibold">
              {fmtDateShort(s.startsAt)} · {fmtTime(s.startsAt)} · {s.durationMin} {t("c.min")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("own.group.sizes", { sizes: s.sizes.map((z) => t(`wlk.group.size.${z}`)).join(", ") })}
              {s.note ? ` · ${s.note}` : ""}
            </p>
            <div className="flex items-center gap-2 pt-1">
              <span className="text-xl font-black text-primary tabular-nums">{formatBOB(s.totalPerDogCents)}</span>
              <span className="text-xs text-muted-foreground">{t("own.group.perDog")}</span>
              {s.myBookingIds.length > 0 ? (
                <Badge className="ml-auto">{t("own.group.youreIn")}</Badge>
              ) : (
                <Button
                  size="sm"
                  className="ml-auto rounded-full font-bold"
                  disabled={!s.joinable}
                  onClick={() => {
                    setJoining(s);
                    setDogId(eligible(s)[0]?.id ?? null);
                    setMethod("QR");
                  }}
                >
                  {t("own.group.join")}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!joining} onOpenChange={(v) => !v && setJoining(null)}>
        <DialogContent className="rounded-3xl max-w-md">
          <DialogHeader>
            <DialogTitle>{t("own.group.joinTitle")}</DialogTitle>
            <DialogDescription>
              {joining &&
                t("own.group.joinDesc", {
                  walker: joining.walker.name,
                  when: `${fmtDateShort(joining.startsAt)} ${fmtTime(joining.startsAt)}`,
                  price: formatBOB(joining.totalPerDogCents),
                })}
            </DialogDescription>
          </DialogHeader>
          {joining && eligible(joining).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("own.group.noDog")}</p>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-2" role="radiogroup" aria-label={t("own.group.whichDog")}>
                {joining &&
                  eligible(joining).map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      role="radio"
                      aria-checked={dogId === d.id}
                      className={cn(
                        "flex items-center gap-3 rounded-2xl border p-2 text-left",
                        dogId === d.id && "border-primary bg-brand-soft/60"
                      )}
                      onClick={() => setDogId(d.id)}
                    >
                      <img src={d.photoUrl ?? "/images/brand/logo-mark-mint.png"} alt="" className="size-9 rounded-xl object-cover" />
                      <span className="font-semibold">{d.name}</span>
                      <span className="text-xs text-muted-foreground">{d.breed}</span>
                    </button>
                  ))}
              </div>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("own.group.howPay")}>
                {(["QR", "TRANSFER", "CASH"] as Method[]).map((m) => (
                  <Button
                    key={m}
                    type="button"
                    size="sm"
                    variant={method === m ? "default" : "outline"}
                    className="rounded-full"
                    role="radio"
                    aria-checked={method === m}
                    onClick={() => setMethod(m)}
                  >
                    {t(`own.group.pay.${m}`)}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{t("own.group.policy")}</p>
            </div>
          )}
          <DialogFooter>
            <Button className="rounded-full font-bold" disabled={!dogId || join.isPending} onClick={() => join.mutate()}>
              {join.isPending && <Loader2 className="size-4 animate-spin" />}
              {t("own.group.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {paying && (
        <PaymentDialog
          open={!!paying}
          onOpenChange={(v) => !v && setPaying(null)}
          payment={paying}
          title={t("own.group.payTitle")}
          description={t("own.group.payDesc")}
        />
      )}
    </section>
  );
}
