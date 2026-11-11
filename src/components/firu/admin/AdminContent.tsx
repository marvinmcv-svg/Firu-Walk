"use client";

// Admin → Usuarios → "Contenido": pick the "Firu del mes" and featured
// walkers shown on the landing page, and browse the walk photos owners
// allowed for Reels / TikTok. Only consenting owners' dogs and consenting
// active walkers can be chosen; a revoked consent hides the item at once.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Eye, EyeOff, Images, Loader2, Megaphone, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/firu/api";
import { fmtDateShort } from "@/lib/firu/dates";
import { srvErr, useT } from "@/lib/firu/i18n";
import type { ContentOverviewDTO, FeatureDTO, FeatureKind } from "@/lib/firu/types";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const contentKey = ["admin", "content"] as const;
const EMPTY_FORM = { subjectId: "", month: "", headline: "", blurb: "", photoUrl: "" };

export function AdminContent() {
  const { t } = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [kind, setKind] = useState<FeatureKind | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data } = useQuery({
    queryKey: contentKey,
    queryFn: () => api.get<ContentOverviewDTO>("/api/admin/content"),
  });
  const done = () => qc.invalidateQueries({ queryKey: contentKey });
  const fail = (e: Error) => toast({ title: t("adm.cnt.err"), description: srvErr(e.message), variant: "destructive" });

  const create = useMutation({
    mutationFn: () =>
      api.post<FeatureDTO>("/api/admin/content", {
        kind,
        month: form.month,
        ...(kind === "FIRU_OF_MONTH" ? { dogId: form.subjectId } : { walkerId: form.subjectId }),
        headline: form.headline,
        blurb: form.blurb,
        photoUrl: form.photoUrl || null,
      }),
    onSuccess: () => {
      setKind(null);
      toast({ title: t("adm.cnt.saved") });
      done();
    },
    onError: fail,
  });
  const toggle = useMutation({
    mutationFn: (f: FeatureDTO) => api.patch(`/api/admin/content/${f.id}`, { published: !f.published }),
    onSuccess: done,
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (f: FeatureDTO) => api.del(`/api/admin/content/${f.id}`),
    onSuccess: () => {
      toast({ title: t("adm.cnt.deleted") });
      done();
    },
    onError: fail,
  });

  const open = (k: FeatureKind) => {
    setForm({ ...EMPTY_FORM, month: data?.month ?? "" });
    setKind(k);
  };
  const subjects =
    kind === "FIRU_OF_MONTH"
      ? (data?.dogs ?? []).map((d) => ({ id: d.id, label: `${d.name} · ${d.breed} (${d.ownerName})`, photos: d.photos }))
      : (data?.walkers ?? []).map((w) => ({ id: w.id, label: `${w.name}${w.zoneName ? ` · ${w.zoneName}` : ""}`, photos: w.photos }));
  const photos = subjects.find((s) => s.id === form.subjectId)?.photos ?? [];
  const canSave = !!form.subjectId && form.headline.trim().length >= 3 && form.blurb.trim().length >= 10 && !!form.month;
  const c = data?.consentCounts;

  return (
    <section className="space-y-3" aria-labelledby="content-title" data-testid="admin-content">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 id="content-title" className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-muted-foreground">
            <Megaphone className="size-4" /> {t("adm.cnt.title")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("adm.cnt.desc")}</p>
          {c && <p className="text-xs font-semibold mt-1">{t("adm.cnt.consent", c)}</p>}
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="rounded-full" onClick={() => open("FIRU_OF_MONTH")}>
            <Plus className="size-4" /> {t("adm.cnt.newFiru")}
          </Button>
          <Button size="sm" variant="outline" className="rounded-full" onClick={() => open("WALKER_SPOTLIGHT")}>
            <Plus className="size-4" /> {t("adm.cnt.newSpot")}
          </Button>
        </div>
      </div>

      {(data?.features ?? []).length === 0 && <p className="text-sm text-muted-foreground">{t("adm.cnt.empty")}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {(data?.features ?? []).map((f) => (
          <div key={f.id} className="rounded-2xl border bg-card p-3 flex gap-3 min-w-0">
            <img
              src={f.photoUrl ?? "/images/brand/logo-mark-mint.png"}
              alt=""
              className="size-16 shrink-0 rounded-xl object-cover border bg-muted"
            />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-start gap-2">
                <p className="text-xs font-bold text-muted-foreground flex items-center gap-1 min-w-0">
                  {f.kind === "FIRU_OF_MONTH" ? <Crown className="size-3.5 shrink-0" /> : <Megaphone className="size-3.5 shrink-0" />}
                  <span className="truncate">
                    {t(`adm.cnt.kind.${f.kind}`)} · {f.month} · {f.subjectName}
                    {f.ownerName ? ` (${f.ownerName})` : ""}
                  </span>
                </p>
                <Badge
                  variant={f.live ? "default" : "secondary"}
                  className={cn("ml-auto shrink-0", f.published && !f.consent && "bg-destructive/15 text-destructive")}
                >
                  {f.live ? t("adm.cnt.live") : f.published && !f.consent ? t("adm.cnt.noConsent") : t("adm.cnt.hidden")}
                </Badge>
              </div>
              <p className="font-bold leading-snug">{f.headline}</p>
              <p className="text-xs text-muted-foreground line-clamp-2">{f.blurb}</p>
              <div className="flex gap-1 pt-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 rounded-full text-xs"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate(f)}
                >
                  {f.published ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  {f.published ? t("adm.cnt.unpublish") : t("adm.cnt.publish")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 rounded-full text-xs text-destructive"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(f)}
                >
                  <Trash2 className="size-3.5" /> {t("adm.cnt.delete")}
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <details className="rounded-2xl border bg-card p-3">
        <summary className="cursor-pointer text-sm font-bold flex items-center gap-2">
          <Images className="size-4" /> {t("adm.cnt.mediaTitle")} ({data?.media.length ?? 0})
        </summary>
        {(data?.media ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("adm.cnt.mediaEmpty")}</p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {data!.media.map((m) => (
              <li key={m.walkId} className="space-y-1.5 min-w-0">
                <p className="text-xs text-muted-foreground truncate">
                  {fmtDateShort(m.date)} · {t("adm.cnt.mediaRow", { dog: m.dogName, walker: m.walkerName, zone: m.zoneName ?? "—" })}
                </p>
                <div className="flex gap-1.5 overflow-x-auto">
                  {m.photos.map((src) => (
                    <a key={src} href={src} target="_blank" rel="noopener noreferrer" className="shrink-0">
                      <img src={src} alt={m.dogName} className="size-20 rounded-xl object-cover border" />
                    </a>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </details>

      <Dialog open={!!kind} onOpenChange={(v) => !v && setKind(null)}>
        <DialogContent className="rounded-3xl max-w-md">
          <DialogHeader>
            <DialogTitle>{t(kind === "FIRU_OF_MONTH" ? "adm.cnt.dialogFiru" : "adm.cnt.dialogSpot")}</DialogTitle>
            <DialogDescription>{t("adm.cnt.dialogDesc")}</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSave) create.mutate();
            }}
          >
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <div className="min-w-0">
                <Label>{t(kind === "FIRU_OF_MONTH" ? "adm.cnt.f.dog" : "adm.cnt.f.walker")}</Label>
                {subjects.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">{t("adm.cnt.f.none")}</p>
                ) : (
                  <Select
                    value={form.subjectId}
                    onValueChange={(v) => {
                      const s = subjects.find((x) => x.id === v);
                      setForm({ ...form, subjectId: v, photoUrl: s?.photos[0] ?? "" });
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("adm.cnt.f.choose")} />
                    </SelectTrigger>
                    <SelectContent>
                      {subjects.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div>
                <Label htmlFor="cnt-month">{t("adm.cnt.f.month")}</Label>
                <Input
                  id="cnt-month"
                  type="month"
                  className="w-36"
                  value={form.month}
                  onChange={(e) => setForm({ ...form, month: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="cnt-headline">{t("adm.cnt.f.headline")}</Label>
              <Input
                id="cnt-headline"
                maxLength={80}
                placeholder={t("adm.cnt.f.headlinePh")}
                value={form.headline}
                onChange={(e) => setForm({ ...form, headline: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="cnt-blurb">{t("adm.cnt.f.blurb")}</Label>
              <Textarea
                id="cnt-blurb"
                maxLength={400}
                rows={3}
                placeholder={t("adm.cnt.f.blurbPh")}
                value={form.blurb}
                onChange={(e) => setForm({ ...form, blurb: e.target.value })}
              />
            </div>
            {form.subjectId && (
              <div>
                <Label>{t("adm.cnt.f.photo")}</Label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {photos.map((src) => (
                    <button
                      key={src}
                      type="button"
                      aria-pressed={form.photoUrl === src}
                      onClick={() => setForm({ ...form, photoUrl: src })}
                      className={cn(
                        "size-16 overflow-hidden rounded-xl border-2",
                        form.photoUrl === src ? "border-primary ring-2 ring-primary/30" : "border-transparent"
                      )}
                    >
                      <img src={src} alt="" className="size-full object-cover" />
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-pressed={!form.photoUrl}
                    onClick={() => setForm({ ...form, photoUrl: "" })}
                    className={cn(
                      "size-16 rounded-xl border-2 text-[11px] font-bold text-muted-foreground bg-muted",
                      !form.photoUrl ? "border-primary" : "border-transparent"
                    )}
                  >
                    {t("adm.cnt.f.noPhoto")}
                  </button>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button type="submit" className="rounded-full font-bold" disabled={create.isPending || !canSave}>
                {create.isPending && <Loader2 className="size-4 animate-spin" />}
                {t("adm.cnt.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
