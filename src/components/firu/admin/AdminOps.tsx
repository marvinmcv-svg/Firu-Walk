"use client";

// Admin → Operaciones (Milestone 8): live map of walks in progress, late
// walks and their backup chain, incident queue (SOS first), walker
// leaderboard and the vet list shown to walkers on SOS. Also shows whether
// the scheduled-job worker is alive.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Siren,
  Stethoscope,
  Trash2,
  Trophy,
} from "lucide-react";
import { api } from "@/lib/firu/api";
import { srvErr, useT } from "@/lib/firu/i18n";
import { fmtRelative, fmtTime } from "@/lib/firu/dates";
import type {
  IncidentDTO,
  LeaderboardRowDTO,
  OpsLiveDTO,
  OpsLiveWalkDTO,
  VetDTO,
} from "@/lib/firu/types";
import { Avatar, EmptyState, SectionHeader } from "@/components/firu/shared/bits";
import { OpsMap } from "@/components/firu/admin/OpsMap";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const OPS_KEY = ["admin", "ops"] as const;
const WORKER_STALE_MS = 3 * 60_000;

function Tel({ phone }: { phone: string }) {
  return (
    <a href={`tel:${phone}`} className="inline-flex items-center gap-1 text-primary font-semibold">
      <Phone className="size-3" /> {phone}
    </a>
  );
}

function minutesSince(iso: string | null): number | null {
  return iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000)) : null;
}

export function AdminOps() {
  const { t } = useT();
  const live = useQuery({
    queryKey: [...OPS_KEY, "live"],
    queryFn: () => api.get<OpsLiveDTO>("/api/admin/ops/live"),
    refetchInterval: 15_000,
  });
  const openCount = live.data?.openIncidents ?? 0;

  return (
    <div className="space-y-5 max-w-5xl">
      <SectionHeader title={t("adm.ops.title")} subtitle={t("adm.ops.subtitle")} />
      <WorkerStatus data={live.data} />
      <Tabs defaultValue="live">
        <TabsList className="w-full grid grid-cols-4 rounded-full">
          <TabsTrigger value="live" className="rounded-full">{t("adm.ops.tab.live")}</TabsTrigger>
          <TabsTrigger value="incidents" className="rounded-full">
            {t("adm.ops.tab.incidents")}
            {openCount > 0 && (
              <span className="ml-1 rounded-full bg-destructive text-destructive-foreground px-1.5 text-[10px] font-black">
                {openCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="board" className="rounded-full">{t("adm.ops.tab.board")}</TabsTrigger>
          <TabsTrigger value="vets" className="rounded-full">{t("adm.ops.tab.vets")}</TabsTrigger>
        </TabsList>
        <TabsContent value="live" className="mt-4">
          <LiveTab data={live.data} loading={live.isLoading} />
        </TabsContent>
        <TabsContent value="incidents" className="mt-4">
          <IncidentsTab />
        </TabsContent>
        <TabsContent value="board" className="mt-4">
          <LeaderboardTab />
        </TabsContent>
        <TabsContent value="vets" className="mt-4">
          <VetsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------

function WorkerStatus({ data }: { data: OpsLiveDTO | undefined }) {
  const { t } = useT();
  if (!data) return null;
  const minute = data.jobs.find((j) => j.job === "minute");
  const lastOk = minute?.lastOkAt ? new Date(minute.lastOkAt).getTime() : 0;
  const healthy = Date.now() - lastOk < WORKER_STALE_MS;
  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3 text-sm flex items-start gap-2",
        healthy ? "bg-emerald-500/5 border-emerald-500/30" : "bg-amber-500/10 border-amber-500/40"
      )}
      data-testid="worker-status"
    >
      {healthy ? (
        <CheckCircle2 className="size-4 text-emerald-600 shrink-0 mt-0.5" />
      ) : (
        <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
      )}
      <div>
        <p className="font-bold">
          {healthy ? t("adm.ops.worker.ok") : t("adm.ops.worker.stale")}
          {minute?.lastRunAt && (
            <span className="font-normal text-muted-foreground">
              {" · "}{t("adm.ops.worker.last", { when: fmtRelative(minute.lastRunAt), by: minute.lastTrigger ?? "—" })}
            </span>
          )}
        </p>
        {!healthy && <p className="text-muted-foreground">{t("adm.ops.worker.staleHint")}</p>}
        {data.jobs
          .filter((j) => j.lastError)
          .map((j) => (
            <p key={j.job} className="text-destructive text-xs mt-1">
              {j.job}: {j.lastError}
            </p>
          ))}
      </div>
    </div>
  );
}

function LiveTab({ data, loading }: { data: OpsLiveDTO | undefined; loading: boolean }) {
  const { t } = useT();
  const [selected, setSelected] = useState<string | null>(null);
  if (loading || !data) return <Skeleton className="h-80 rounded-2xl" />;
  const sorted = [...data.inProgress].sort((a, b) => Number(b.openSos) - Number(a.openSos));
  return (
    <div className="space-y-5">
      <OpsMap walks={data.inProgress} selectedId={selected} onSelect={setSelected} className="h-80 lg:h-96 w-full rounded-2xl overflow-hidden border" />
      <div>
        <p className="font-extrabold mb-2">{t("adm.ops.live.inProgress", { count: data.inProgress.length })}</p>
        {sorted.length === 0 ? (
          <EmptyState icon={MapPin} title={t("adm.ops.live.emptyTitle")} description={t("adm.ops.live.emptyDesc")} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {sorted.map((w) => (
              <LiveWalkCard key={w.walkId} w={w} selected={w.walkId === selected} onSelect={() => setSelected(w.walkId)} />
            ))}
          </div>
        )}
      </div>
      <div>
        <p className="font-extrabold mb-2">{t("adm.ops.late.title", { count: data.late.length })}</p>
        {data.late.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("adm.ops.late.empty")}</p>
        ) : (
          <div className="space-y-2">
            {data.late.map((l) => (
              <div key={l.walkId} className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <Clock className="size-4 text-amber-600" />
                  <span className="font-bold">{l.dogName}</span>
                  <span className="text-muted-foreground">· {l.zoneName} · {fmtTime(l.scheduledStart)}</span>
                  <span className="ml-auto rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-black text-amber-800 dark:text-amber-300">
                    {t("adm.ops.late.minutes", { n: l.minutesLate })}
                  </span>
                </div>
                <div className="mt-1 grid gap-1 sm:grid-cols-2 text-xs">
                  <span>{t("adm.ops.walker")}: {l.walkerName} · <Tel phone={l.walkerPhone} /></span>
                  <span>{t("adm.ops.owner")}: {l.ownerName} · <Tel phone={l.ownerPhone} /></span>
                </div>
                <p className="mt-1 text-xs font-semibold">
                  {l.backupWalkerName
                    ? t("adm.ops.late.offered", { name: l.backupWalkerName, until: fmtTime(l.backupExpiresAt) })
                    : l.backupExhausted
                      ? t("adm.ops.late.exhausted")
                      : t("adm.ops.late.pending")}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LiveWalkCard({ w, selected, onSelect }: { w: OpsLiveWalkDTO; selected: boolean; onSelect: () => void }) {
  const { t } = useT();
  const elapsed = minutesSince(w.startedAt);
  const fixAge = minutesSince(w.lastFixAt);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "text-left rounded-2xl border p-3 text-sm transition-colors",
        w.openSos ? "border-destructive bg-destructive/5" : "bg-card",
        selected && "ring-2 ring-primary"
      )}
    >
      <div className="flex items-center gap-2">
        {w.openSos && <Siren className="size-4 text-destructive" />}
        <span className="font-bold">{w.dogName}</span>
        <span className="text-muted-foreground truncate">· {w.zoneName}</span>
        {w.mockLocation && (
          <span className="ml-auto rounded-full bg-amber-500/20 px-2 text-[10px] font-black text-amber-800">GPS?</span>
        )}
      </div>
      <p className="mt-1 text-xs">
        {w.walkerName} · <Tel phone={w.walkerPhone} />
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {elapsed != null && t("adm.ops.live.elapsed", { n: elapsed, of: w.durationMin })}
        {" · "}
        {fixAge == null ? t("adm.ops.live.noFix") : t("adm.ops.live.fixAge", { n: fixAge })}
      </p>
    </button>
  );
}

// ---------------------------------------------------------------------------

function IncidentsTab() {
  const { t } = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState<"OPEN" | "RESOLVED">("OPEN");
  const [resolving, setResolving] = useState<IncidentDTO | null>(null);
  const [resolution, setResolution] = useState("");

  const list = useQuery({
    queryKey: [...OPS_KEY, "incidents", status],
    queryFn: () => api.get<IncidentDTO[]>(`/api/admin/incidents?status=${status}`),
    refetchInterval: status === "OPEN" ? 15_000 : false,
  });
  const resolve = useMutation({
    mutationFn: (v: { id: string; resolution: string }) =>
      api.patch(`/api/admin/incidents/${v.id}`, { resolution: v.resolution }),
    onSuccess: () => {
      setResolving(null);
      setResolution("");
      void qc.invalidateQueries({ queryKey: OPS_KEY });
      toast({ title: t("adm.ops.inc.resolved") });
    },
    onError: (e: Error) => toast({ title: t("adm.ops.err"), description: srvErr(e.message), variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(["OPEN", "RESOLVED"] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={status === s ? "default" : "outline"}
            className="rounded-full"
            onClick={() => setStatus(s)}
          >
            {t(s === "OPEN" ? "adm.ops.inc.open" : "adm.ops.inc.closed")}
          </Button>
        ))}
      </div>
      {list.isLoading ? (
        <Skeleton className="h-32 rounded-2xl" />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState icon={CheckCircle2} title={t("adm.ops.inc.emptyTitle")} description={t("adm.ops.inc.emptyDesc")} />
      ) : (
        <div className="space-y-3" data-testid="incident-queue">
          {list.data!.map((i) => (
            <div
              key={i.id}
              className={cn("rounded-2xl border p-4 text-sm", i.type === "SOS" && i.status === "OPEN" && "border-destructive bg-destructive/5")}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-black",
                    i.type === "SOS" ? "bg-destructive text-destructive-foreground" : "bg-amber-500/20 text-amber-800 dark:text-amber-300"
                  )}
                >
                  {t(`adm.ops.inc.type.${i.type}`)}
                </span>
                <span className="text-muted-foreground">{fmtRelative(i.createdAt)} · {i.reporterName}</span>
              </div>
              <p className="mt-2">{i.note}</p>
              {i.walk && (
                <div className="mt-2 grid gap-1 sm:grid-cols-2 text-xs">
                  <span>{i.walk.dogName} · {i.walk.zoneName} · {fmtTime(i.walk.scheduledStart)}</span>
                  <span>{t("adm.ops.walker")}: {i.walk.walkerName} · <Tel phone={i.walk.walkerPhone} /></span>
                  <span>{t("adm.ops.owner")}: {i.walk.ownerName} · <Tel phone={i.walk.ownerPhone} /></span>
                </div>
              )}
              <div className="mt-3 flex gap-2 flex-wrap">
                {i.mapsUrl && (
                  <Button asChild size="sm" variant="outline" className="rounded-full">
                    <a href={i.mapsUrl} target="_blank" rel="noreferrer">
                      <MapPin className="size-4" /> {t("adm.ops.inc.map")}
                    </a>
                  </Button>
                )}
                {i.status === "OPEN" ? (
                  <Button size="sm" className="rounded-full" onClick={() => setResolving(i)}>
                    <CheckCircle2 className="size-4" /> {t("adm.ops.inc.resolve")}
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("adm.ops.inc.resolution")}: {i.resolution}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!resolving} onOpenChange={(o) => !o && setResolving(null)}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>{t("adm.ops.inc.resolveTitle")}</DialogTitle>
            <DialogDescription>{resolving?.note}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            placeholder={t("adm.ops.inc.resolutionPh")}
            className="rounded-2xl"
          />
          <DialogFooter>
            <Button
              className="rounded-full"
              disabled={resolution.trim().length < 3 || resolve.isPending}
              onClick={() => resolving && resolve.mutate({ id: resolving.id, resolution: resolution.trim() })}
            >
              {t("adm.ops.inc.resolve")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------

function LeaderboardTab() {
  const { t } = useT();
  const [days, setDays] = useState(30);
  const board = useQuery({
    queryKey: [...OPS_KEY, "board", days],
    queryFn: () => api.get<LeaderboardRowDTO[]>(`/api/admin/ops/leaderboard?days=${days}`),
  });
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {[7, 30, 90].map((d) => (
          <Button key={d} size="sm" variant={days === d ? "default" : "outline"} className="rounded-full" onClick={() => setDays(d)}>
            {t("adm.ops.board.days", { n: d })}
          </Button>
        ))}
      </div>
      {board.isLoading ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : (board.data ?? []).length === 0 ? (
        <EmptyState icon={Trophy} title={t("adm.ops.board.empty")} description="" />
      ) : (
        <div className="rounded-2xl border overflow-x-auto">
          <table className="w-full text-sm" data-testid="leaderboard">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="p-2 text-left">#</th>
                <th className="p-2 text-left">{t("adm.ops.walker")}</th>
                <th className="p-2 text-right">{t("adm.ops.board.onTime")}</th>
                <th className="p-2 text-right">{t("adm.ops.board.rating")}</th>
                <th className="p-2 text-right">{t("adm.ops.board.noShows")}</th>
                <th className="p-2 text-right">SOS</th>
                <th className="p-2 text-right">{t("adm.ops.board.walks")}</th>
              </tr>
            </thead>
            <tbody>
              {board.data!.map((r, idx) => (
                <tr key={r.userId} className="border-t">
                  <td className="p-2 font-black tabular-nums">{idx + 1}</td>
                  <td className="p-2">
                    <div className="flex items-center gap-2 min-w-40">
                      <Avatar src={r.avatarUrl} name={r.name} className="size-8" />
                      <div className="min-w-0">
                        <p className="font-bold truncate">{r.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {r.zoneName}{r.status === "SUSPENDED" ? ` · ${t("adm.ops.board.suspended")}` : ""}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className={cn("p-2 text-right tabular-nums font-bold", r.onTimePct != null && r.onTimePct < 85 && "text-amber-700")}>
                    {r.onTimePct == null ? "—" : `${r.onTimePct}%`}
                  </td>
                  <td className="p-2 text-right tabular-nums">{r.ratingCount ? r.rating.toFixed(1) : "—"}</td>
                  <td className={cn("p-2 text-right tabular-nums", r.noShows > 0 && "text-destructive font-bold")}>{r.noShows}</td>
                  <td className="p-2 text-right tabular-nums">{r.sosCount}</td>
                  <td className="p-2 text-right tabular-nums">{r.walksStarted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t("adm.ops.board.hint")}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface VetForm {
  id?: string;
  name: string;
  phone: string;
  address: string;
  lat: string;
  lng: string;
  open24h: boolean;
  notes: string;
  active: boolean;
}

const EMPTY_VET: VetForm = { name: "", phone: "", address: "", lat: "", lng: "", open24h: false, notes: "", active: true };

function VetsTab() {
  const { t } = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<VetForm | null>(null);
  const vets = useQuery({ queryKey: [...OPS_KEY, "vets"], queryFn: () => api.get<VetDTO[]>("/api/admin/vets") });

  const done = (title: string) => {
    void qc.invalidateQueries({ queryKey: [...OPS_KEY, "vets"] });
    setForm(null);
    toast({ title });
  };
  const onError = (e: Error) => toast({ title: t("adm.ops.err"), description: srvErr(e.message), variant: "destructive" });
  const save = useMutation({
    mutationFn: (f: VetForm) => {
      const body = {
        name: f.name,
        phone: f.phone,
        address: f.address,
        lat: Number(f.lat),
        lng: Number(f.lng),
        open24h: f.open24h,
        notes: f.notes.trim() || null,
        active: f.active,
      };
      return f.id ? api.patch(`/api/admin/vets/${f.id}`, body) : api.post("/api/admin/vets", body);
    },
    onSuccess: () => done(t("adm.ops.vets.saved")),
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/vets/${id}`),
    onSuccess: () => done(t("adm.ops.vets.deleted")),
    onError,
  });
  const valid = useMemo(() => {
    if (!form) return false;
    const lat = Number(form.lat);
    const lng = Number(form.lng);
    return form.name.trim().length >= 2 && form.phone.trim().length >= 6 && form.address.trim().length >= 3 &&
      form.lat !== "" && form.lng !== "" && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  }, [form]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-sm text-muted-foreground flex-1">{t("adm.ops.vets.hint")}</p>
        <Button size="sm" className="rounded-full" onClick={() => setForm({ ...EMPTY_VET })}>
          <Plus className="size-4" /> {t("adm.ops.vets.add")}
        </Button>
      </div>
      {vets.isLoading ? (
        <Skeleton className="h-32 rounded-2xl" />
      ) : (vets.data ?? []).length === 0 ? (
        <EmptyState icon={Stethoscope} title={t("adm.ops.vets.empty")} description={t("adm.ops.vets.emptyDesc")} />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {vets.data!.map((v) => (
            <div key={v.id} className={cn("rounded-2xl border p-3 text-sm", !v.active && "opacity-60")}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-bold">
                    {v.name}
                    {v.open24h && <span className="ml-1 text-[10px] font-black text-emerald-700">24 h</span>}
                    {!v.active && <span className="ml-1 text-[10px] font-black text-muted-foreground">{t("adm.ops.vets.inactive")}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">{v.address}</p>
                  <p className="text-xs"><Tel phone={v.phone} /></p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("adm.ops.vets.edit")}
                  onClick={() =>
                    setForm({ id: v.id, name: v.name, phone: v.phone, address: v.address, lat: String(v.lat), lng: String(v.lng), open24h: v.open24h, notes: v.notes ?? "", active: v.active })
                  }
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("adm.ops.vets.delete")}
                  disabled={remove.isPending}
                  onClick={() => window.confirm(t("adm.ops.vets.confirmDelete", { name: v.name })) && remove.mutate(v.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="rounded-3xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form?.id ? t("adm.ops.vets.edit") : t("adm.ops.vets.add")}</DialogTitle>
            <DialogDescription>{t("adm.ops.vets.coordsHint")}</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              {(["name", "phone", "address"] as const).map((k) => (
                <div key={k} className="space-y-1">
                  <Label htmlFor={`vet-${k}`}>{t(`adm.ops.vets.f.${k}`)}</Label>
                  <Input id={`vet-${k}`} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                </div>
              ))}
              <div className="grid grid-cols-2 gap-2">
                {(["lat", "lng"] as const).map((k) => (
                  <div key={k} className="space-y-1">
                    <Label htmlFor={`vet-${k}`}>{t(`adm.ops.vets.f.${k}`)}</Label>
                    <Input id={`vet-${k}`} inputMode="decimal" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value.replace(",", ".") })} />
                  </div>
                ))}
              </div>
              <div className="space-y-1">
                <Label htmlFor="vet-notes">{t("adm.ops.vets.f.notes")}</Label>
                <Textarea id="vet-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="rounded-xl" />
              </div>
              <label className="flex items-center justify-between gap-2 text-sm">
                {t("adm.ops.vets.f.open24h")}
                <Switch checked={form.open24h} onCheckedChange={(v) => setForm({ ...form, open24h: v })} />
              </label>
              <label className="flex items-center justify-between gap-2 text-sm">
                {t("adm.ops.vets.f.active")}
                <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
              </label>
            </div>
          )}
          <DialogFooter>
            <Button className="rounded-full" disabled={!valid || save.isPending} onClick={() => form && save.mutate(form)}>
              {t("adm.ops.vets.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
