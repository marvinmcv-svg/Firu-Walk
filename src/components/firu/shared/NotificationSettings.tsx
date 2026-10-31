"use client";

// Notification channel preferences: in-app (always on), WhatsApp, web push
// (this browser), and the language of WhatsApp / push messages.
// Push: registers /sw.js, subscribes with the server's VAPID key and stores
// the subscription via /api/notifications/push.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Bell, Globe, Loader2, MessageCircle, Smartphone } from "lucide-react";
import { api } from "@/lib/firu/api";
import { srvErr, useT } from "@/lib/firu/i18n";
import type { NotificationPrefsDTO } from "@/lib/firu/types";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export const prefsKey = ["notification-prefs"] as const;

function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** base64url VAPID key → Uint8Array for pushManager.subscribe. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function subscribeThisBrowser(publicKey: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("permission");
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await api.post("/api/notifications/push", sub.toJSON());
}

async function unsubscribeThisBrowser(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api.del("/api/notifications/push", { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

function Row({
  icon: Icon,
  title,
  desc,
  children,
}: {
  icon: typeof Bell;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-3 border-b last:border-0">
      <span className="grid place-items-center size-9 rounded-full bg-brand-soft text-primary shrink-0">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold leading-snug">{title}</p>
        <p className="text-xs text-muted-foreground leading-snug mt-0.5">{desc}</p>
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

export function NotificationSettings({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [pushBusy, setPushBusy] = useState(false);

  const { data: prefs } = useQuery({
    queryKey: prefsKey,
    queryFn: () => api.get<NotificationPrefsDTO>("/api/notifications/preferences"),
    enabled: open,
  });

  const save = useMutation({
    mutationFn: (patch: Partial<Pick<NotificationPrefsDTO, "whatsapp" | "push" | "locale">>) =>
      api.patch<NotificationPrefsDTO>("/api/notifications/preferences", patch),
    onSuccess: (p) => qc.setQueryData(prefsKey, p),
    onError: (e: Error) =>
      toast({ title: t("sh.notif.saveErr"), description: srvErr(e.message), variant: "destructive" }),
  });

  const canPush = !!prefs?.pushPublicKey && pushSupported();

  const togglePush = async (on: boolean) => {
    if (!prefs) return;
    setPushBusy(true);
    try {
      if (on) {
        await subscribeThisBrowser(prefs.pushPublicKey!);
        await save.mutateAsync({ push: true });
        toast({ title: t("sh.notif.pushOn") });
      } else {
        await unsubscribeThisBrowser();
        await save.mutateAsync({ push: false });
      }
      await qc.invalidateQueries({ queryKey: prefsKey });
    } catch (e) {
      const denied = (e as Error).message === "permission";
      toast({
        title: denied ? t("sh.notif.pushDenied") : t("sh.notif.saveErr"),
        description: denied ? t("sh.notif.pushDeniedDesc") : srvErr((e as Error).message),
        variant: "destructive",
      });
    } finally {
      setPushBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>{t("sh.notif.title")}</DialogTitle>
          <DialogDescription>{t("sh.notif.desc")}</DialogDescription>
        </DialogHeader>

        {!prefs ? (
          <div className="grid place-items-center py-10">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div>
            <Row icon={Bell} title={t("sh.notif.inApp")} desc={t("sh.notif.inAppDesc")}>
              <Switch checked disabled aria-label={t("sh.notif.inApp")} />
            </Row>
            <Row
              icon={MessageCircle}
              title={t("sh.notif.whatsapp")}
              desc={prefs.whatsappAvailable ? t("sh.notif.whatsappDesc") : t("sh.notif.whatsappOff")}
            >
              <Switch
                data-testid="notif-whatsapp"
                checked={prefs.whatsapp}
                disabled={save.isPending}
                onCheckedChange={(v) => save.mutate({ whatsapp: v })}
                aria-label={t("sh.notif.whatsapp")}
              />
            </Row>
            <Row
              icon={Smartphone}
              title={t("sh.notif.push")}
              desc={
                canPush
                  ? t("sh.notif.pushDesc", { n: prefs.pushDevices })
                  : t("sh.notif.pushUnavailable")
              }
            >
              {pushBusy ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <Switch
                  data-testid="notif-push"
                  checked={canPush && prefs.push && prefs.pushDevices > 0}
                  disabled={!canPush}
                  onCheckedChange={(v) => void togglePush(v)}
                  aria-label={t("sh.notif.push")}
                />
              )}
            </Row>
            <Row icon={Globe} title={t("sh.notif.lang")} desc={t("sh.notif.langDesc")}>
              <div className="inline-flex rounded-full border bg-secondary/80 p-0.5" role="group">
                {(["es", "en"] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={prefs.locale === l}
                    disabled={save.isPending}
                    onClick={() => save.mutate({ locale: l })}
                    className={cn(
                      "rounded-full px-2.5 h-7 text-[11px] font-black",
                      prefs.locale === l ? "bg-background text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>
            </Row>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
