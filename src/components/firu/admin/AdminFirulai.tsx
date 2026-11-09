"use client";

// Admin → Operaciones → FirulAI (Milestone 9): model spend per day and the
// latest saved conversations (read-only). Caps and the on/off switch live in
// Configuración → FirulAI.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, MessageCircle } from "lucide-react";
import { api } from "@/lib/firu/api";
import { useT } from "@/lib/firu/i18n";
import { fmtRelative } from "@/lib/firu/dates";
import type { FirulaiAdminDTO, FirulaiConversationDTO } from "@/lib/firu/types";
import { EmptyState } from "@/components/firu/shared/bits";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const usd = (micro: number) => `US$ ${(micro / 1_000_000).toFixed(micro < 100_000 ? 4 : 2)}`;

export function AdminFirulai() {
  const { t } = useT();
  const [openId, setOpenId] = useState<string | null>(null);
  const data = useQuery({
    queryKey: ["admin", "firulai"],
    queryFn: () => api.get<FirulaiAdminDTO>("/api/admin/firulai"),
    refetchInterval: 60_000,
  });
  const conv = useQuery({
    queryKey: ["admin", "firulai", openId],
    queryFn: () => api.get<FirulaiConversationDTO>(`/api/admin/firulai/${openId}`),
    enabled: !!openId,
  });

  if (data.isLoading || !data.data) return <Skeleton className="h-48 rounded-2xl" />;
  const today = data.data.days[0];
  const week = data.data.days.slice(0, 7).reduce((a, d) => ({ req: a.req + d.requests, cost: a.cost + d.costMicroUsd }), { req: 0, cost: 0 });

  return (
    <div className="space-y-4" data-testid="admin-firulai">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          [t("adm.ai.today"), String(today?.requests ?? 0)],
          [t("adm.ai.todayCost"), usd(today?.costMicroUsd ?? 0)],
          [t("adm.ai.week"), String(week.req)],
          [t("adm.ai.weekCost"), usd(week.cost)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-lg font-black tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t("adm.ai.hint")}</p>

      {data.data.conversations.length === 0 ? (
        <EmptyState icon={Bot} title={t("adm.ai.empty")} description="" />
      ) : (
        <div className="space-y-2">
          {data.data.conversations.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setOpenId(c.id)}
              className="w-full text-left rounded-2xl border p-3 text-sm hover:bg-muted/40"
            >
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{fmtRelative(c.updatedAt)}</span>
                <span>· {c.userName ?? t("adm.ai.visitor")}</span>
                <span>· {c.lang.toUpperCase()}</span>
                <span>· {t("adm.ai.messages", { n: c.messageCount })}</span>
                <span className="ml-auto tabular-nums">{usd(c.costMicroUsd)}</span>
              </div>
              <p className="mt-1 truncate">{c.preview || "—"}</p>
              {c.handoff && (
                <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-green-700/10 px-2 text-[11px] font-bold text-green-800 dark:text-green-300">
                  <MessageCircle className="size-3" /> WhatsApp
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <Dialog open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="rounded-3xl max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("adm.ai.conversation")}</DialogTitle>
          </DialogHeader>
          {conv.isLoading || !conv.data ? (
            <Skeleton className="h-32 rounded-2xl" />
          ) : (
            <div className="space-y-2">
              {conv.data.messages.map((m, i) => (
                <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-line",
                      m.role === "user" ? "bg-primary text-primary-foreground" : "border bg-card"
                    )}
                  >
                    {m.content}
                    {(m.degraded || Array.isArray(m.toolCalls)) && (
                      <p className="mt-1 text-[10.5px] opacity-70">
                        {m.degraded ? `⚠ ${m.degraded}` : ""}
                        {Array.isArray(m.toolCalls)
                          ? ` 🔧 ${(m.toolCalls as { name: string }[]).map((c) => c.name).join(", ")}`
                          : ""}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
