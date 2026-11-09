"use client";

// Milestone 7 — pending walkers upload their vetting documents here.
// Photos are compressed on the phone, uploaded straight to private storage
// through a short-lived signed URL, then verified by the server.

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Camera, CheckCircle2, FileText, Loader2, Lock, ShieldCheck, Upload, Video } from "lucide-react";
import { api } from "@/lib/firu/api";
import { uploadWalkerDocument } from "@/lib/firu/documentUpload";
import { srvErr, useT } from "@/lib/firu/i18n";
import { springSmooth } from "@/lib/firu/motion";
import type { WalkerDocKind, WalkerVettingDTO } from "@/lib/firu/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const KINDS: { kind: WalkerDocKind; accept: string; icon: typeof Camera; capture?: "user" | "environment" }[] = [
  { kind: "CI_FRONT", accept: "image/*", icon: Camera, capture: "environment" },
  { kind: "CI_BACK", accept: "image/*", icon: Camera, capture: "environment" },
  { kind: "SELFIE", accept: "image/*", icon: Camera, capture: "user" },
  { kind: "BACKGROUND_CERT", accept: "image/*,application/pdf", icon: FileText },
  { kind: "VIDEO_INTRO", accept: "video/mp4,video/webm,video/quicktime", icon: Video },
];
const REQUIRED = 5; // 4 documents + CI number

export const vettingKey = ["walker", "vetting"] as const;

export function VerificationCard() {
  const { t } = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busyKind, setBusyKind] = useState<WalkerDocKind | null>(null);
  const [ci, setCi] = useState("");

  const { data: v } = useQuery({
    queryKey: vettingKey,
    queryFn: () => api.get<WalkerVettingDTO>("/api/walkers/me/vetting"),
  });

  const upload = useMutation({
    mutationFn: ({ kind, file }: { kind: WalkerDocKind; file: File }) => uploadWalkerDocument(kind, file),
    onMutate: ({ kind }) => setBusyKind(kind),
    onSettled: () => setBusyKind(null),
    onSuccess: (next) => {
      qc.setQueryData(vettingKey, next);
      toast({ title: t("wlk.vet.toastOk") });
    },
    onError: (e: Error) =>
      toast({ title: t("wlk.vet.toastErr"), description: srvErr(e.message), variant: "destructive" }),
  });

  const saveCi = useMutation({
    mutationFn: () => api.put<WalkerVettingDTO>("/api/walkers/me/id-number", { idNumber: ci }),
    onSuccess: (next) => {
      qc.setQueryData(vettingKey, next);
      setCi("");
      toast({ title: t("wlk.vet.toastCi") });
    },
    onError: (e: Error) =>
      toast({ title: t("wlk.vet.toastErr"), description: srvErr(e.message), variant: "destructive" }),
  });

  if (!v) return null;
  const have = new Set(v.documents.map((d) => d.kind));
  const done = [...have].filter((k) => k !== "VIDEO_INTRO").length + (v.idDocLast4 ? 1 : 0);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...springSmooth, delay: 0.08 }}
      className="rounded-3xl border bg-card p-5 shadow-card"
      aria-labelledby="vet-title"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand-soft text-primary">
          <ShieldCheck className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="vet-title" className="font-extrabold text-lg leading-tight">{t("wlk.vet.title")}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t("wlk.vet.subtitle")}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Progress value={(done / REQUIRED) * 100} className="h-2 flex-1" />
        <span className="text-xs font-extrabold text-primary tabular-nums">
          {t("wlk.vet.progress", { done, total: REQUIRED })}
        </span>
      </div>

      {!v.storageReady ? (
        <p className="mt-4 rounded-2xl bg-secondary px-4 py-3 text-sm font-semibold text-muted-foreground">
          {t("wlk.vet.unavailable")}
        </p>
      ) : (
        <ul className="mt-4 divide-y rounded-2xl border">
          {KINDS.map((k) => (
            <DocRow
              key={k.kind}
              {...k}
              uploaded={have.has(k.kind)}
              busy={busyKind === k.kind}
              disabled={!!busyKind}
              onFile={(file) => upload.mutate({ kind: k.kind, file })}
            />
          ))}
        </ul>
      )}

      {/* CI number — encrypted server-side, only the last 4 come back */}
      <form
        className="mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ci.trim()) saveCi.mutate();
        }}
      >
        <label htmlFor="vet-ci" className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
          {t("wlk.vet.ci")}
        </label>
        {v.idDocLast4 && (
          <p className="mt-1 flex items-center gap-1.5 text-sm font-bold text-primary">
            <CheckCircle2 className="size-4" aria-hidden /> {t("wlk.vet.ciSaved", { last4: v.idDocLast4 })}
          </p>
        )}
        <div className="mt-2 flex gap-2">
          <Input
            id="vet-ci"
            value={ci}
            onChange={(e) => setCi(e.target.value)}
            placeholder={t("wlk.vet.ciPh")}
            inputMode="text"
            autoComplete="off"
            className="rounded-xl"
          />
          <Button type="submit" className="rounded-full font-bold" disabled={!ci.trim() || saveCi.isPending}>
            {saveCi.isPending && <Loader2 className="size-4 animate-spin" />}
            {t("wlk.vet.ciSave")}
          </Button>
        </div>
      </form>

      <p className="mt-4 flex items-start gap-1.5 text-xs text-muted-foreground">
        <Lock className="size-3.5 mt-0.5 shrink-0" aria-hidden /> {t("wlk.vet.privacy")}
      </p>
      {v.documentsComplete && (
        <p className="mt-3 rounded-2xl bg-brand-soft px-4 py-3 text-sm font-bold text-primary">{t("wlk.vet.done")}</p>
      )}
    </motion.section>
  );
}

function DocRow({
  kind,
  accept,
  icon: Icon,
  capture,
  uploaded,
  busy,
  disabled,
  onFile,
}: {
  kind: WalkerDocKind;
  accept: string;
  icon: typeof Camera;
  capture?: "user" | "environment";
  uploaded: boolean;
  busy: boolean;
  disabled: boolean;
  onFile: (f: File) => void;
}) {
  const { t } = useT();
  const input = useRef<HTMLInputElement>(null);
  return (
    <li className="flex items-center gap-3 p-3">
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-xl",
          uploaded ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
        )}
      >
        {uploaded ? <CheckCircle2 className="size-5" aria-hidden /> : <Icon className="size-5" aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold leading-tight">{t(`wlk.vet.kind.${kind}`)}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {uploaded ? t("wlk.vet.uploaded") : t(`wlk.vet.hint.${kind}`)}
        </p>
      </div>
      <input
        ref={input}
        type="file"
        accept={accept}
        {...(capture ? { capture } : {})}
        className="sr-only"
        aria-label={t(`wlk.vet.kind.${kind}`)}
        data-doc-kind={kind}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
      <Button
        type="button"
        size="sm"
        variant={uploaded ? "outline" : "default"}
        className="rounded-full font-bold shrink-0"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        {busy ? t("wlk.vet.uploading") : uploaded ? t("wlk.vet.replace") : t("wlk.vet.upload")}
      </Button>
    </li>
  );
}
