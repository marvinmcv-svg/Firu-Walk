"use client";

// T4-d — Admin configuration ("Config").
// Every business rule is editable here (fees, pricing, policy, platform,
// payouts) via PATCH /api/admin/config — nothing is hard-coded in the app.
// Demo settings render read-only.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { springSmooth, springSnappy } from "@/lib/firu/motion";
import {
  HandCoins,
  Info,
  Percent,
  PiggyBank,
  ScrollText,
  Settings2,
  Sparkles,
  Tag,
} from "lucide-react";
import { useState } from "react";
import { api, qk } from "@/lib/firu/api";
import type { AppConfig } from "@/lib/firu/types";
import { formatBOB, parseBOB } from "@/lib/firu/money";
import { useT, getLang, srvErr } from "@/lib/firu/i18n";
import { SectionHeader } from "@/components/firu/shared/bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ------------------------- field machinery ------------------------- */

type FieldKind = "pct" | "num" | "bs" | "text" | "textarea";

interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  unit?: string; // suffix hint, e.g. "%" / "min" / "Bs"
  hint?: string;
}

/** Config value → editable string for the input. */
function valueToString(f: FieldDef, v: number | string | undefined): string {
  if (v === undefined || v === null) return "";
  if (f.kind === "bs")
    return (Number(v) / 100).toFixed(2).replace(".", getLang() === "en" ? "." : ",");
  return String(v);
}

/** Edited string → typed value for the PATCH body. Returns null if invalid. */
function stringToValue(f: FieldDef, s: string): number | string | null {
  const t = s.trim();
  if (f.kind === "text" || f.kind === "textarea") return t.length ? t : null;
  if (f.kind === "bs") {
    if (!/^[0-9]+([.,][0-9]{1,2})?$/.test(t)) return null;
    const cents = parseBOB(t);
    return cents >= 0 ? cents : null;
  }
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/* --------------------------- section card --------------------------- */

function ConfigSectionCard({
  section,
  icon: Icon,
  title,
  description,
  fields,
  value,
}: {
  section: string;
  icon: React.ElementType;
  title: string;
  description: string;
  fields: FieldDef[];
  value: Record<string, number | string> | undefined;
}) {
  const { toast } = useToast();
  const { t } = useT();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, valueToString(f, value?.[f.key])]))
  );

  // NOTE: the parent remounts this card (key={JSON.stringify(value)}) when the
  // server config changes, so the useState initializer re-reads fresh values
  // without effects.

  const dirty = fields.some((f) => draft[f.key] !== valueToString(f, value?.[f.key]));

  const save = useMutation({
    mutationFn: (patch: Record<string, number | string>) =>
      api.patch("/api/admin/config", { section, patch }),
    onSuccess: () => {
      toast({
        title: t("adm.cfg.savedToast"),
        description: t("adm.cfg.savedToastDesc"),
      });
      qc.invalidateQueries({ queryKey: qk.config });
    },
    onError: (err: Error) => {
      toast({
        title: t("adm.cfg.errSave"),
        description: srvErr(err.message),
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    const patch: Record<string, number | string> = {};
    for (const f of fields) {
      const parsed = stringToValue(f, draft[f.key] ?? "");
      if (parsed === null) {
        toast({
          title: t("adm.cfg.errValue"),
          description: t("adm.cfg.errValueDesc", { label: f.label }),
          variant: "destructive",
        });
        return;
      }
      // Only send changed keys — the API whitelists anyway
      if (draft[f.key] !== valueToString(f, value?.[f.key])) patch[f.key] = parsed;
    }
    if (Object.keys(patch).length === 0) return;
    save.mutate(patch);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springSmooth}
      layout
    >
      <Card className="rounded-2xl h-full">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="grid place-items-center size-8 rounded-xl bg-brand-soft text-primary">
              <Icon className="size-4" />
            </span>
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {fields.map((f) => (
            <div key={f.key} className={cn(f.kind === "textarea" && "sm:col-span-2")}>
              <Label htmlFor={`${section}-${f.key}`} className="text-xs font-bold text-muted-foreground">
                {f.label}
                {f.unit && f.kind !== "bs" ? ` (${f.unit})` : ""}
              </Label>
              {f.kind === "textarea" ? (
                <Textarea
                  id={`${section}-${f.key}`}
                  value={draft[f.key] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  rows={3}
                  className="mt-1"
                />
              ) : (
                <div className="relative mt-1">
                  <Input
                    id={`${section}-${f.key}`}
                    value={draft[f.key] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                    inputMode={f.kind === "text" ? "text" : "decimal"}
                    className={cn(
                      f.kind !== "text" && "pr-12",
                      dirty && draft[f.key] !== valueToString(f, value?.[f.key]) && "border-primary/60"
                    )}
                  />
                  {f.kind !== "text" && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground pointer-events-none">
                      {f.unit}
                    </span>
                  )}
                </div>
              )}
              {f.hint && (
                <p className="text-[11px] text-muted-foreground mt-1">{f.hint}</p>
              )}
              {f.kind === "bs" && typeof value?.[f.key] === "number" && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  {t("adm.cfg.current", { amount: formatBOB(value[f.key] as number) })}
                </p>
              )}
            </div>
          ))}
          <div className="pt-1 flex justify-end">
            <Button
              size="sm"
              className="rounded-full"
              disabled={!dirty || save.isPending}
              onClick={handleSave}
            >
              {save.isPending ? t("adm.cfg.saving") : t("adm.cfg.saveChanges")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ------------------------------ read-only ---------------------------- */

function DemoCard({ demo }: { demo: AppConfig["demo"] }) {
  const { t } = useT();
  return (
    <Card className="rounded-2xl border-dashed h-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span className="grid place-items-center size-8 rounded-xl bg-secondary text-secondary-foreground">
            <Sparkles className="size-4" />
          </span>
          {t("adm.cfg.demo")}
          <Badge variant="outline" className="text-[10px] rounded-full">{t("adm.cfg.demoOnly")}</Badge>
        </CardTitle>
        <CardDescription>{t("adm.cfg.demoDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label className="text-xs font-bold text-muted-foreground">{t("adm.cfg.otp")}</Label>
          <Input value={demo.otpCode} disabled className="mt-1 font-mono" />
        </div>
        <div>
          <Label className="text-xs font-bold text-muted-foreground">
            {t("adm.cfg.acceptWindowDemo")}
          </Label>
          <Input value={`${demo.acceptTimeoutSeconds} s`} disabled className="mt-1" />
          <p className="text-[11px] text-muted-foreground mt-1">
            {t("adm.cfg.acceptWindowHintDemo")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/* ================================= view ================================= */

export function AdminConfig() {
  const { t } = useT();
  const { data: cfg, isLoading } = useQuery({
    queryKey: qk.config,
    queryFn: () => api.get<AppConfig>("/api/config"),
  });

  if (isLoading || !cfg) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 rounded-2xl" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        title={t("adm.cfg.title")}
        subtitle={t("adm.cfg.subtitle")}
      />

      {/* Banner */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springSnappy}
      >
        <div className="rounded-2xl border border-primary/30 bg-brand-soft p-4 flex items-start gap-3">
          <span className="grid place-items-center size-10 rounded-2xl bg-primary text-primary-foreground shrink-0">
            <Settings2 className="size-5" />
          </span>
          <div>
            <p className="font-extrabold">{t("adm.cfg.bannerTitle")}</p>
            <p className="text-sm text-muted-foreground mt-0.5 leading-snug">
              {t("adm.cfg.bannerDesc")}
            </p>
          </div>
        </div>
      </motion.div>

      {/* Sections */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ConfigSectionCard
          key={JSON.stringify(cfg.fees)}
          section="fees"
          icon={Percent}
          title={t("adm.cfg.feesTitle")}
          description={t("adm.cfg.feesDesc")}
          fields={[
            { key: "commissionPct", label: t("adm.cfg.f.commission"), kind: "pct", unit: "%", hint: t("adm.cfg.f.commissionHint") },
            { key: "ownerFeePct", label: t("adm.cfg.f.ownerFee"), kind: "pct", unit: "%", hint: t("adm.cfg.f.ownerFeeHint") },
            { key: "tipPassThroughPct", label: t("adm.cfg.f.tips"), kind: "pct", unit: "%", hint: t("adm.cfg.f.tipsHint") },
          ]}
          value={cfg.fees}
        />
        <ConfigSectionCard
          key={JSON.stringify(cfg.pricing)}
          section="pricing"
          icon={Tag}
          title={t("adm.cfg.pricingTitle")}
          description={t("adm.cfg.pricingDesc")}
          fields={[
            { key: "price30Cents", label: t("adm.cfg.f.price30"), kind: "bs", unit: "Bs" },
            { key: "price45Cents", label: t("adm.cfg.f.price45"), kind: "bs", unit: "Bs" },
            { key: "price60Cents", label: t("adm.cfg.f.price60"), kind: "bs", unit: "Bs" },
          ]}
          value={cfg.pricing}
        />
        <ConfigSectionCard
          key={JSON.stringify(cfg.policy)}
          section="policy"
          icon={ScrollText}
          title={t("adm.cfg.policyTitle")}
          description={t("adm.cfg.policyDesc")}
          fields={[
            { key: "cancellationFreeHours", label: t("adm.cfg.f.cancelFree"), kind: "num", unit: "h", hint: t("adm.cfg.f.cancelFreeHint") },
            { key: "lateCancelWalkerSharePct", label: t("adm.cfg.f.lateCancel"), kind: "pct", unit: "%" },
            { key: "acceptTimeoutMinutes", label: t("adm.cfg.f.acceptWindow"), kind: "num", unit: "min", hint: t("adm.cfg.f.acceptWindowHint") },
            { key: "trialWalks", label: t("adm.cfg.f.trialWalks"), kind: "num", unit: t("adm.cfg.unit.walks"), hint: t("adm.cfg.f.trialWalksHint") },
            { key: "noShowCreditCents", label: t("adm.cfg.f.noShowCredit"), kind: "bs", unit: "Bs", hint: t("adm.cfg.f.noShowCreditHint") },
          ]}
          value={cfg.policy}
        />
        <ConfigSectionCard
          key={JSON.stringify(cfg.platform)}
          section="platform"
          icon={Info}
          title={t("adm.cfg.platformTitle")}
          description={t("adm.cfg.platformDesc")}
          fields={[
            { key: "name", label: t("adm.cfg.f.name"), kind: "text" },
            { key: "city", label: t("adm.cfg.f.city"), kind: "text" },
            { key: "supportWhatsApp", label: t("adm.cfg.f.whatsapp"), kind: "text" },
            { key: "guaranteeText", label: t("adm.cfg.f.guarantee"), kind: "textarea" },
          ]}
          value={cfg.platform}
        />
        <ConfigSectionCard
          key={JSON.stringify(cfg.payouts)}
          section="payouts"
          icon={PiggyBank}
          title={t("adm.cfg.payoutsTitle")}
          description={t("adm.cfg.payoutsDesc")}
          fields={[
            { key: "cycle", label: t("adm.cfg.f.cycle"), kind: "text", hint: t("adm.cfg.f.cycleHint") },
            { key: "minPayoutCents", label: t("adm.cfg.f.minPayout"), kind: "bs", unit: "Bs" },
          ]}
          value={cfg.payouts}
        />
        <DemoCard demo={cfg.demo} />
      </div>

      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <HandCoins className="size-3.5" />
        {t("adm.cfg.footerNote")}
      </p>
    </div>
  );
}
