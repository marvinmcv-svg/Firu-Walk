"use client";

// Admin → Usuarios → "Aliados": vets, pet shops, groomers, condominiums and
// relocation agencies that send owners with their own code. Create one, print
// its QR for the counter / lobby, follow sign-ups → first walks, and pay the
// referral fees owed.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Copy, HandCoins, Loader2, Plus, QrCode } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/firu/api";
import { formatBOB, parseBOB } from "@/lib/firu/money";
import { srvErr, useT } from "@/lib/firu/i18n";
import type { PartnerDTO, PartnerKind } from "@/lib/firu/types";
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
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

const partnersKey = ["admin", "partners"] as const;
const KINDS: PartnerKind[] = ["VET", "PETSHOP", "GROOMER", "CONDO", "RELOCATION", "OTHER"];

export function AdminPartners() {
  const { t } = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<PartnerDTO | null>(null);
  const [reference, setReference] = useState("");
  const [form, setForm] = useState({ name: "", kind: "VET" as PartnerKind, code: "", fee: "", contactName: "", contactPhone: "", giftWalk: true });

  const { data: partners } = useQuery({
    queryKey: partnersKey,
    queryFn: () => api.get<PartnerDTO[]>("/api/admin/partners"),
  });
  const done = () => qc.invalidateQueries({ queryKey: partnersKey });
  const fail = (e: Error) => toast({ title: t("adm.prt.err"), description: srvErr(e.message), variant: "destructive" });

  const create = useMutation({
    mutationFn: () =>
      api.post<PartnerDTO>("/api/admin/partners", {
        name: form.name,
        kind: form.kind,
        ...(form.code.trim() ? { code: form.code.trim() } : {}),
        referralFeeCents: parseBOB(form.fee),
        contactName: form.contactName.trim() || null,
        contactPhone: form.contactPhone.trim() || null,
        giftWalk: form.giftWalk,
      }),
    onSuccess: (p) => {
      setCreating(false);
      setForm({ name: "", kind: "VET", code: "", fee: "", contactName: "", contactPhone: "", giftWalk: true });
      toast({ title: t("adm.prt.created", { code: p.code }) });
      done();
    },
    onError: fail,
  });
  const toggle = useMutation({
    mutationFn: (p: PartnerDTO) => api.patch(`/api/admin/partners/${p.id}`, { active: !p.active }),
    onSuccess: done,
    onError: fail,
  });
  const pay = useMutation({
    mutationFn: () => api.post<{ paidCents: number }>(`/api/admin/partners/${paying!.id}/payout`, { reference }),
    onSuccess: (r) => {
      toast({ title: t("adm.prt.paid", { amount: formatBOB(r.paidCents) }) });
      setPaying(null);
      setReference("");
      done();
    },
    onError: fail,
  });

  return (
    <section className="space-y-3" aria-labelledby="partners-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="partners-title" className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-muted-foreground">
            <Building2 className="size-4" /> {t("adm.prt.title")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("adm.prt.desc")}</p>
        </div>
        <Button size="sm" className="rounded-full" onClick={() => setCreating(true)}>
          <Plus className="size-4" /> {t("adm.prt.new")}
        </Button>
      </div>

      {(partners ?? []).length === 0 && <p className="text-sm text-muted-foreground">{t("adm.prt.empty")}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {(partners ?? []).map((p) => (
          <div key={p.id} className="rounded-2xl border bg-card p-3 space-y-2 min-w-0">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-bold truncate">{p.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t(`adm.prt.kind.${p.kind}`)}
                  {p.contactName ? ` · ${p.contactName}` : ""}
                  {p.contactPhone ? ` · ${p.contactPhone}` : ""}
                </p>
              </div>
              <Badge variant={p.active ? "default" : "secondary"}>{p.active ? t("adm.prt.active") : t("adm.prt.paused")}</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-lg border px-2 py-0.5 font-black tracking-widest">{p.code}</code>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 rounded-full text-xs"
                onClick={() => navigator.clipboard?.writeText(p.shareUrl).then(() => toast({ title: t("adm.prt.copied") }))}
              >
                <Copy className="size-3.5" /> {t("adm.prt.copyLink")}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 rounded-full text-xs" asChild>
                <a href={`/api/admin/partners/${p.id}/qr`} target="_blank" rel="noopener noreferrer">
                  <QrCode className="size-3.5" /> {t("adm.prt.qr")}
                </a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("adm.prt.stats", { owners: p.owners, activated: p.activated, walks: p.walks })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("adm.prt.terms", {
                fee: formatBOB(p.referralFeeCents),
                gift: p.giftWalk ? t("adm.prt.withGift") : t("adm.prt.noGift"),
              })}
            </p>
            <div className="flex flex-wrap items-center gap-2 border-t pt-2">
              <span className="text-xs">
                {t("adm.prt.owed")} <strong className="tabular-nums">{formatBOB(p.owedCents)}</strong>
                <span className="text-muted-foreground"> · {t("adm.prt.earned", { amount: formatBOB(p.earnedCents) })}</span>
              </span>
              <div className="ml-auto flex gap-1">
                {p.owedCents > 0 && (
                  <Button size="sm" variant="outline" className="h-7 rounded-full text-xs" onClick={() => setPaying(p)}>
                    <HandCoins className="size-3.5" /> {t("adm.prt.pay")}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 rounded-full text-xs"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate(p)}
                >
                  {p.active ? t("adm.prt.pause") : t("adm.prt.resume")}
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="rounded-3xl max-w-md">
          <DialogHeader>
            <DialogTitle>{t("adm.prt.new")}</DialogTitle>
            <DialogDescription>{t("adm.prt.newDesc")}</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (form.name.trim()) create.mutate();
            }}
          >
            <div>
              <Label htmlFor="prt-name">{t("adm.prt.f.name")}</Label>
              <Input id="prt-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("adm.prt.f.kind")}</Label>
                <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as PartnerKind })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {t(`adm.prt.kind.${k}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="prt-code">{t("adm.prt.f.code")}</Label>
                <Input
                  id="prt-code"
                  placeholder={t("adm.prt.f.codeAuto")}
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().slice(0, 20) })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="prt-contact">{t("adm.prt.f.contact")}</Label>
                <Input id="prt-contact" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="prt-phone">{t("adm.prt.f.phone")}</Label>
                <Input id="prt-phone" inputMode="tel" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
              </div>
            </div>
            <div>
              <Label htmlFor="prt-fee">{t("adm.prt.f.fee")}</Label>
              <Input id="prt-fee" inputMode="decimal" placeholder="10" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} />
              <p className="mt-1 text-xs text-muted-foreground">{t("adm.prt.f.feeHint")}</p>
            </div>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>{t("adm.prt.f.gift")}</span>
              <Switch checked={form.giftWalk} onCheckedChange={(v) => setForm({ ...form, giftWalk: v })} />
            </label>
            <DialogFooter>
              <Button type="submit" className="rounded-full font-bold" disabled={create.isPending || !form.name.trim()}>
                {create.isPending && <Loader2 className="size-4 animate-spin" />}
                {t("adm.prt.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!paying} onOpenChange={(v) => !v && setPaying(null)}>
        <DialogContent className="rounded-3xl max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("adm.prt.payTitle", { name: paying?.name ?? "" })}</DialogTitle>
            <DialogDescription>{t("adm.prt.payDesc", { amount: formatBOB(paying?.owedCents ?? 0) })}</DialogDescription>
          </DialogHeader>
          <Label htmlFor="prt-ref">{t("adm.prt.ref")}</Label>
          <Input id="prt-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
          <DialogFooter>
            <Button className="rounded-full font-bold" disabled={pay.isPending || !reference.trim()} onClick={() => pay.mutate()}>
              {pay.isPending && <Loader2 className="size-4 animate-spin" />}
              {t("adm.prt.confirmPay")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
