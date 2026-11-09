"use client";

// SOS during a live walk (Milestone 8). Step 1 confirms (optional note);
// step 2 sends POST /api/walks/[id]/sos with the current GPS fix — the
// server alerts the owner and the ops team — and shows the nearest vets.
// Whatever happens, the WhatsApp support button stays available so an
// emergency never dead-ends on a network error.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Loader2, MapPin, MessageCircle, Navigation, Phone, Siren } from "lucide-react";
import { api } from "@/lib/firu/api";
import { useT, srvErr } from "@/lib/firu/i18n";
import { currentFix } from "@/lib/firu/tracker";
import type { SosResponseDTO, VetDTO } from "@/lib/firu/types";
import { whatsappHref } from "@/components/firu/shared/bits";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface SosSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  walkId: string | null;
  dogName: string;
  pickup: { lat: number; lng: number } | null;
  supportWhatsApp: string;
}

function fmtDistance(m: number | null): string {
  if (m == null) return "";
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}

function VetRow({ vet, t }: { vet: VetDTO; t: ReturnType<typeof useT>["t"] }) {
  return (
    <li className="rounded-2xl border p-3 space-y-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-bold leading-tight">{vet.name}</p>
          <p className="text-xs text-muted-foreground truncate">{vet.address}</p>
        </div>
        <div className="text-right shrink-0">
          {vet.distanceM != null && <p className="text-sm font-bold tabular-nums">{fmtDistance(vet.distanceM)}</p>}
          {vet.open24h && (
            <span className="text-[10px] font-bold uppercase rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2 py-0.5">
              24 h
            </span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button asChild size="sm" variant="outline" className="rounded-full">
          <a href={`tel:${vet.phone.replace(/[^\d+]/g, "")}`}>
            <Phone className="size-4" /> {t("wlk.sos.call")}
          </a>
        </Button>
        <Button asChild size="sm" variant="outline" className="rounded-full">
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${vet.lat},${vet.lng}`}
            target="_blank"
            rel="noreferrer"
          >
            <Navigation className="size-4" /> {t("wlk.sos.directions")}
          </a>
        </Button>
      </div>
    </li>
  );
}

export function SosSheet({ open, onOpenChange, walkId, dogName, pickup, supportWhatsApp }: SosSheetProps) {
  const { t } = useT();
  const [note, setNote] = useState("");

  const sos = useMutation({
    mutationFn: async () => {
      if (!walkId) throw new Error(t("wlk.sos.noWalk"));
      const fix = await currentFix(pickup).catch(() => null);
      return api.post<SosResponseDTO>(`/api/walks/${walkId}/sos`, {
        ...(fix ? { lat: fix.lat, lng: fix.lng, acc: fix.acc ?? null } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
    },
  });

  const pos = sos.data?.position ?? null;
  const waText = t("wlk.sos.waMsg", { name: dogName || t("wlk.sos.waFallback") }) +
    (pos ? ` — https://maps.google.com/?q=${pos.lat},${pos.lng}` : "");
  const supportHref = whatsappHref(sos.data?.supportWhatsApp || supportWhatsApp, waText);

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o && !sos.isPending) {
      sos.reset();
      setNote("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="rounded-3xl max-h-[90dvh] overflow-y-auto" data-testid="sos-sheet">
        {!sos.isSuccess ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <Siren className="size-5" /> {t("wlk.sos.title")}
              </DialogTitle>
              <DialogDescription>{t("wlk.sos.desc")}</DialogDescription>
            </DialogHeader>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 500))}
              placeholder={t("wlk.sos.notePh")}
              className="rounded-2xl min-h-20"
            />
            {sos.isError && (
              <p className="text-sm text-destructive" role="alert">
                {t("wlk.sos.errSend", { msg: srvErr((sos.error as Error).message) })}
              </p>
            )}
            <Button
              variant="destructive"
              size="lg"
              className="w-full rounded-full font-black h-14 text-base"
              disabled={sos.isPending}
              onClick={() => sos.mutate()}
              data-testid="sos-send"
            >
              {sos.isPending ? <Loader2 className="size-5 animate-spin" /> : <Siren className="size-5" />}
              {sos.isPending ? t("wlk.sos.sending") : t("wlk.sos.send")}
            </Button>
            <Button asChild variant="outline" className="w-full rounded-full">
              <a href={supportHref} target="_blank" rel="noreferrer">
                <MessageCircle className="size-4" /> {t("wlk.sos.contact")}
              </a>
            </Button>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="size-5 text-emerald-600" /> {t("wlk.sos.sentTitle")}
              </DialogTitle>
              <DialogDescription>
                {sos.data.repeated ? t("wlk.sos.sentRepeated") : t("wlk.sos.sentDesc")}
              </DialogDescription>
            </DialogHeader>
            {pos ? (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="size-3.5" /> {t("wlk.sos.locationShared")}
              </p>
            ) : (
              <p className="text-xs text-amber-700 dark:text-amber-300">{t("wlk.sos.noLocation")}</p>
            )}
            <Button asChild className="w-full rounded-full" size="lg">
              <a href={supportHref} target="_blank" rel="noreferrer">
                <MessageCircle className="size-4" /> {t("wlk.sos.contact")}
              </a>
            </Button>
            <div>
              <p className="font-bold text-sm mb-2">{t("wlk.sos.vetsTitle")}</p>
              {sos.data.vets.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("wlk.sos.vetsEmpty")}</p>
              ) : (
                <ul className="space-y-2" data-testid="sos-vets">
                  {sos.data.vets.map((v) => (
                    <VetRow key={v.id} vet={v} t={t} />
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
