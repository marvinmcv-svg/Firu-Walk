"use client";

// Owner → "Regalá un paseo": share your code; when a friend completes their
// first paid walk, you both get a gifted walk. New owners who skipped the
// code at sign-up can still enter a friend's code here before their first walk.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Gift, Loader2, Share2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/firu/api";
import { formatBOB } from "@/lib/firu/money";
import { srvErr, useT } from "@/lib/firu/i18n";
import type { ReferralSummaryDTO } from "@/lib/firu/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export const referralKey = ["referrals"] as const;

export function ReferralCard() {
  const { t } = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [friendCode, setFriendCode] = useState("");

  const { data } = useQuery({
    queryKey: referralKey,
    queryFn: () => api.get<ReferralSummaryDTO>("/api/referrals"),
  });

  const redeem = useMutation({
    mutationFn: () => api.post<{ applied: boolean }>("/api/referrals/redeem", { code: friendCode }),
    onSuccess: () => {
      setFriendCode("");
      qc.invalidateQueries({ queryKey: referralKey });
      toast({ title: t("own.ref.redeemed"), description: t("own.ref.redeemedDesc") });
    },
    onError: (e: Error) => toast({ title: t("own.ref.redeemErr"), description: srvErr(e.message), variant: "destructive" }),
  });

  if (!data?.enabled) return null;

  const gift = t("own.ref.gift", { min: data.giftDurationMin, amount: formatBOB(data.giftValueCents) });
  const message = t("own.ref.shareText", { code: data.code, url: data.shareUrl, min: data.giftDurationMin });
  const waUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: data.code });
    }
  };

  return (
    <section className="rounded-3xl border border-primary/30 bg-brand-soft/50 p-4 shadow-sm space-y-3" aria-labelledby="ref-title">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary">
          <Gift className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id="ref-title" className="font-extrabold leading-tight">{t("own.ref.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("own.ref.desc", { gift })}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-xl border bg-card px-3 py-1.5 text-lg font-black tracking-widest" data-testid="referral-code">
          {data.code}
        </code>
        <Button size="sm" variant="outline" className="rounded-full" onClick={copy}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? t("own.ref.copied") : t("own.ref.copy")}
        </Button>
        <Button size="sm" className="rounded-full font-bold" asChild>
          <a href={waUrl} target="_blank" rel="noopener noreferrer">
            <Share2 className="size-4" /> {t("own.ref.share")}
          </a>
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("own.ref.stats", { invited: data.invited, pending: data.pending, rewarded: data.rewarded })}
        {data.rewardsLeft === 0 && data.rewarded > 0 && ` · ${t("own.ref.capped")}`}
      </p>

      {data.referredBy?.status === "PENDING" && (
        <p className="text-xs font-semibold text-primary">
          {data.referredBy.partnerName
            ? t("own.ref.partnerPending", { partner: data.referredBy.partnerName })
            : t("own.ref.yoursPending")}
        </p>
      )}

      {data.canRedeem && (
        <form
          className="flex gap-2 border-t pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (friendCode.trim()) redeem.mutate();
          }}
        >
          <Input
            aria-label={t("own.ref.redeemLabel")}
            placeholder={t("own.ref.redeemLabel")}
            value={friendCode}
            onChange={(e) => setFriendCode(e.target.value.toUpperCase().slice(0, 20))}
            className="h-9"
          />
          <Button type="submit" size="sm" variant="outline" className="rounded-full" disabled={redeem.isPending || !friendCode.trim()}>
            {redeem.isPending && <Loader2 className="size-4 animate-spin" />}
            {t("own.ref.redeem")}
          </Button>
        </form>
      )}
    </section>
  );
}
