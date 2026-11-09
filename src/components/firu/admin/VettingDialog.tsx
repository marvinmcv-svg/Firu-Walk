"use client";

// Milestone 7 — admin review of a walker application: documents through
// 5-minute signed links (every open is audit-logged server-side), the last
// 4 digits of the CI, and the four-item checklist that gates approval.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, ExternalLink, FileText, IdCard, Loader2, Video } from "lucide-react";
import { api, qk } from "@/lib/firu/api";
import { srvErr, useT } from "@/lib/firu/i18n";
import type { WalkerDocKind, WalkerReviewDTO, WalkerVettingDTO } from "@/lib/firu/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const CHECKS = ["identityOk", "backgroundOk", "interviewDone", "trialWalkDone"] as const;
type CheckKey = (typeof CHECKS)[number];

export function VettingDialog({
  walker,
  onClose,
  onApprove,
}: {
  walker: { id: string; name: string } | null;
  onClose: () => void;
  onApprove: () => void;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = ["admin", "vetting", walker?.id] as const;
  const [notes, setNotes] = useState<string | null>(null);

  const { data: v, isLoading, isError } = useQuery({
    queryKey: key,
    queryFn: () => api.get<WalkerVettingDTO>(`/api/admin/walkers/${walker!.id}/vetting`),
    enabled: !!walker,
    staleTime: 60_000, // signed links last 5 min
  });

  const review = useMutation({
    mutationFn: (patch: Partial<Record<CheckKey, boolean>> & { notes?: string }) =>
      api.patch<WalkerVettingDTO>(`/api/admin/walkers/${walker!.id}/review`, patch),
    onSuccess: (next) => {
      // Keep the signed links we already have; the PATCH response has none.
      qc.setQueryData<WalkerVettingDTO>(key, (prev) => (prev ? { ...next, documents: prev.documents } : next));
      qc.invalidateQueries({ queryKey: qk.adminWalkers });
    },
    onError: (e: Error) => toast({ title: t("adm.vet.loadErr"), description: srvErr(e.message), variant: "destructive" }),
  });

  const r: WalkerReviewDTO | undefined = v?.review;
  const doneCount = r ? CHECKS.filter((c) => r[c]).length : 0;

  return (
    <Dialog open={!!walker} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("adm.vet.title", { name: walker?.name ?? "" })}</DialogTitle>
          <DialogDescription>{t("adm.vet.desc")}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-64 rounded-2xl" />
        ) : isError || !v ? (
          <p className="text-sm text-destructive font-semibold">{t("adm.vet.loadErr")}</p>
        ) : (
          <div className="space-y-5">
            {/* Documents */}
            <section>
              <h3 className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">{t("adm.vet.docs")}</h3>
              {!v.storageReady && <p className="mt-2 text-sm text-muted-foreground">{t("adm.vet.storageOff")}</p>}
              {v.missing.length > 0 && (
                <p className="mt-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
                  {t("adm.vet.missing", { list: v.missing.map((k) => t(`wlk.vet.kind.${k}`)).join(", ") })}
                </p>
              )}
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
                {v.documents.map((d) => (
                  <DocTile key={d.id} kind={d.kind} contentType={d.contentType} url={d.viewUrl} />
                ))}
              </div>
            </section>

            {/* CI */}
            <section className="flex items-center gap-2 rounded-2xl bg-secondary px-4 py-3">
              <IdCard className="size-4 text-muted-foreground" aria-hidden />
              <span className="text-sm font-bold">
                {v.idDocLast4 ? `${t("adm.vet.ci")} •••• ${v.idDocLast4}` : t("adm.vet.ciNone")}
              </span>
            </section>

            {/* Checklist */}
            <section>
              <h3 className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
                {t("adm.vet.checklist")} · {doneCount}/4
              </h3>
              <div className="mt-2 grid gap-2">
                {CHECKS.map((c) => (
                  <label key={c} className="flex items-center gap-3 rounded-xl border px-3 py-2.5 cursor-pointer hover:bg-secondary/60">
                    <Checkbox
                      checked={!!r?.[c]}
                      disabled={review.isPending}
                      onCheckedChange={(val) => review.mutate({ [c]: val === true })}
                    />
                    <span className="text-sm font-semibold">{t(`adm.vet.c.${c}`)}</span>
                  </label>
                ))}
              </div>
            </section>

            {/* Notes */}
            <section>
              <label htmlFor="vet-notes" className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
                {t("adm.vet.notes")}
              </label>
              <Textarea
                id="vet-notes"
                className="mt-2 rounded-xl"
                rows={3}
                value={notes ?? r?.notes ?? ""}
                onChange={(e) => setNotes(e.target.value)}
              />
              {notes !== null && notes !== (r?.notes ?? "") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 rounded-full"
                  disabled={review.isPending}
                  onClick={() => review.mutate({ notes }, { onSuccess: () => setNotes(null) })}
                >
                  {t("adm.vet.saveNotes")}
                </Button>
              )}
            </section>
          </div>
        )}

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <p className="text-xs font-semibold text-muted-foreground">
            {v?.readyToApprove ? t("adm.vet.ready") : t("adm.vet.notReady")}
          </p>
          <Button className="rounded-full" disabled={!v?.readyToApprove || review.isPending} onClick={onApprove}>
            {review.isPending ? <Loader2 className="size-4 animate-spin" /> : <BadgeCheck className="size-4" />}
            {t("adm.apps.approve")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocTile({ kind, contentType, url }: { kind: WalkerDocKind; contentType: string; url?: string }) {
  const { t } = useT();
  const isImage = contentType.startsWith("image/");
  const Icon = contentType.startsWith("video/") ? Video : FileText;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      referrerPolicy="no-referrer"
      className="group block overflow-hidden rounded-2xl border bg-card hover:border-primary/40"
    >
      <div className="aspect-[4/3] bg-secondary grid place-items-center overflow-hidden">
        {isImage && url ? (
          // Signed, short-lived URL — plain <img>, never cached by Next.
          <img src={url} alt={t(`wlk.vet.kind.${kind}`)} className="size-full object-cover transition-transform group-hover:scale-105" />
        ) : (
          <Icon className="size-8 text-muted-foreground" aria-hidden />
        )}
      </div>
      <p className="flex items-center justify-between gap-1 px-2.5 py-2 text-xs font-bold">
        <span className="truncate">{t(`wlk.vet.kind.${kind}`)}</span>
        <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </p>
    </a>
  );
}
