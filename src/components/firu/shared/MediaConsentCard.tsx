"use client";

// Phase 3 content consent. Owners: allow their dogs' walk photos on social
// media and the landing ("Firu del mes"). Walkers: agree to be a featured
// walker. Off by default, revocable anytime (PATCH /api/users/me).

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Megaphone } from "lucide-react";
import { api, qk } from "@/lib/firu/api";
import { useFiruSession } from "@/lib/firu/session";
import { srvErr, useT } from "@/lib/firu/i18n";
import type { SessionUserDTO } from "@/lib/firu/types";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

export function MediaConsentCard() {
  const { t } = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const user = useFiruSession((s) => s.user);
  const setUser = useFiruSession((s) => s.setUser);
  const isWalker = user?.role === "WALKER";
  const field = isWalker ? "spotlightConsent" : "mediaConsent";
  const p = isWalker ? "wlk.spot" : "own.media";
  const checked = isWalker ? !!user?.walker?.spotlightConsent : !!user?.mediaConsent;

  const save = useMutation({
    mutationFn: (value: boolean) => api.patch<SessionUserDTO>("/api/users/me", { [field]: value }),
    onSuccess: (u, value) => {
      setUser(u);
      qc.invalidateQueries({ queryKey: qk.me });
      toast({ title: t(value ? `${p}.on` : `${p}.off`) });
    },
    onError: (e: Error) => toast({ title: t(`${p}.err`), description: srvErr(e.message), variant: "destructive" }),
  });

  if (!user || (user.role !== "OWNER" && !isWalker)) return null;
  const Icon = isWalker ? Megaphone : Camera;

  return (
    <div className="rounded-3xl border bg-card p-5 shadow-sm" data-testid="media-consent">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-brand-soft text-primary">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-extrabold">{t(`${p}.title`)}</p>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{t(`${p}.desc`)}</p>
          <label className="mt-3 flex items-center justify-between gap-3 rounded-2xl border bg-muted/40 px-3 py-2.5 cursor-pointer">
            <span className="text-sm font-bold">{t(`${p}.label`)}</span>
            <Switch
              checked={checked}
              disabled={save.isPending}
              onCheckedChange={(v) => save.mutate(v)}
              aria-label={t(`${p}.label`)}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
