"use client";

// Admin → Configuración → "Ciudades y zonas" (Phase 3 expansion).
// Each city sets its walk lengths, base prices and peak hours. New cities
// start switched off: add zones, recruit walkers, then launch. The banner
// shows the expansion rule (existing zones ≥70 % busy at peak).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building, Loader2, MapPinned, Pencil, Plus, Rocket } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/firu/api";
import { formatBOB, parseBOB } from "@/lib/firu/money";
import { srvErr, useT } from "@/lib/firu/i18n";
import type { AdminCityDTO, AppConfig } from "@/lib/firu/types";
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
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const citiesKey = ["admin", "cities"] as const;
type Overview = { cities: AdminCityDTO[]; occupancy: { thresholdPct: number; zones: number; busyZones: number } };

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const peaksToText = (ws: [number, number][]) => ws.map(([a, b]) => `${hhmm(a)}-${hhmm(b)}`).join(", ");
/** "06:00-09:00, 17:30-20:00" → [[360,540],[1050,1200]] (null when invalid). */
export function parsePeaks(text: string): [number, number][] | null {
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const out: [number, number][] = [];
  for (const p of parts) {
    const m = p.match(/^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const a = Number(m[1]) * 60 + Number(m[2]);
    const b = Number(m[3]) * 60 + Number(m[4]);
    if (a >= b || b > 1440 || Number(m[2]) > 59 || Number(m[4]) > 59) return null;
    out.push([a, b]);
  }
  return out;
}

type CityForm = {
  key: string;
  name: string;
  lat: string;
  lng: string;
  p30: string;
  p45: string;
  p60: string;
  durations: number[];
  peaks: string;
};
type ZoneForm = { key: string; name: string; lat: string; lng: string };

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

export function AdminCities({ cfg }: { cfg: AppConfig }) {
  const { t } = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [cityDialog, setCityDialog] = useState<{ city: AdminCityDTO | null } | null>(null);
  const [cityForm, setCityForm] = useState<CityForm | null>(null);
  const [zoneCity, setZoneCity] = useState<AdminCityDTO | null>(null);
  const [zoneForm, setZoneForm] = useState<ZoneForm>({ key: "", name: "", lat: "", lng: "" });

  const { data } = useQuery({ queryKey: citiesKey, queryFn: () => api.get<Overview>("/api/admin/cities") });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: citiesKey });
    qc.invalidateQueries({ queryKey: ["zones"] });
  };
  const fail = (e: Error) => toast({ title: t("adm.city.err"), description: srvErr(e.message), variant: "destructive" });

  const openCity = (city: AdminCityDTO | null) => {
    setCityForm(
      city
        ? {
            key: city.key,
            name: city.name,
            lat: String(city.centerLat),
            lng: String(city.centerLng),
            p30: String(city.price30Cents / 100),
            p45: String(city.price45Cents / 100),
            p60: String(city.price60Cents / 100),
            durations: city.durations,
            peaks: peaksToText(city.peaks),
          }
        : {
            key: "",
            name: "",
            lat: "",
            lng: "",
            p30: String(cfg.pricing.price30Cents / 100),
            p45: String(cfg.pricing.price45Cents / 100),
            p60: String(cfg.pricing.price60Cents / 100),
            durations: [30, 45, 60],
            peaks: "06:00-09:00, 17:30-20:00",
          }
    );
    setCityDialog({ city });
  };

  const saveCity = useMutation({
    mutationFn: () => {
      const f = cityForm!;
      const peaks = parsePeaks(f.peaks);
      if (!peaks) throw new Error(t("adm.city.badPeaks"));
      const body = {
        name: f.name.trim(),
        centerLat: Number(f.lat),
        centerLng: Number(f.lng),
        price30Cents: parseBOB(f.p30),
        price45Cents: parseBOB(f.p45),
        price60Cents: parseBOB(f.p60),
        durations: f.durations,
        peaks,
      };
      return cityDialog?.city
        ? api.patch(`/api/admin/cities/${cityDialog.city.id}`, body)
        : api.post("/api/admin/cities", { ...body, key: f.key });
    },
    onSuccess: () => {
      setCityDialog(null);
      toast({ title: t("adm.city.saved") });
      refresh();
    },
    onError: fail,
  });
  const toggleCity = useMutation({
    mutationFn: (c: AdminCityDTO) => api.patch(`/api/admin/cities/${c.id}`, { active: !c.active }),
    onSuccess: (_d, c) => {
      toast({ title: t(c.active ? "adm.city.paused" : "adm.city.launched", { name: c.name }) });
      refresh();
    },
    onError: fail,
  });
  const toggleZone = useMutation({
    mutationFn: (z: { id: string; active: boolean }) => api.patch(`/api/admin/zones/${z.id}`, { active: !z.active }),
    onSuccess: refresh,
    onError: fail,
  });
  const addZone = useMutation({
    mutationFn: () =>
      api.post("/api/admin/zones", {
        cityId: zoneCity!.id,
        key: zoneForm.key,
        name: zoneForm.name.trim(),
        centerLat: Number(zoneForm.lat),
        centerLng: Number(zoneForm.lng),
        sortOrder: zoneCity!.zones.length,
      }),
    onSuccess: () => {
      setZoneCity(null);
      toast({ title: t("adm.city.zoneAdded") });
      refresh();
    },
    onError: fail,
  });

  const occ = data?.occupancy;
  const f = cityForm;
  return (
    <section className="space-y-3" aria-labelledby="cities-title" data-testid="admin-cities">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 id="cities-title" className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-muted-foreground">
            <Building className="size-4" /> {t("adm.city.title")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("adm.city.desc")}</p>
          {occ && (
            <p className={cn("text-xs font-semibold mt-1", occ.busyZones > 0 ? "text-primary" : "text-muted-foreground")}>
              {t("adm.city.gate", { busy: occ.busyZones, zones: occ.zones, pct: occ.thresholdPct })}
            </p>
          )}
        </div>
        <Button size="sm" className="rounded-full" onClick={() => openCity(null)}>
          <Plus className="size-4" /> {t("adm.city.new")}
        </Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {(data?.cities ?? []).map((c) => (
          <div key={c.id} className="rounded-2xl border bg-card p-3 space-y-2 min-w-0" data-testid={`city-${c.key}`}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-bold truncate">{c.name}</p>
                <p className="text-xs text-muted-foreground">
                  {c.durations.map((d) => `${d} min ${formatBOB(d === 30 ? c.price30Cents : d === 45 ? c.price45Cents : c.price60Cents)}`).join(" · ")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("adm.city.peaks")}: {peaksToText(c.peaks)}
                </p>
              </div>
              <Badge variant={c.active ? "default" : "secondary"}>{c.active ? t("adm.city.live") : t("adm.city.off")}</Badge>
            </div>
            <ul className="divide-y rounded-xl border">
              {c.zones.length === 0 && <li className="p-2 text-xs text-muted-foreground">{t("adm.city.noZones")}</li>}
              {c.zones.map((z) => (
                <li key={z.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                  <MapPinned className="size-3.5 text-muted-foreground shrink-0" />
                  <span className={cn("min-w-0 flex-1 truncate", !z.active && "text-muted-foreground line-through")}>{z.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                    {t("adm.city.zoneCounts", { owners: z.owners, walkers: z.walkers })}
                  </span>
                  <Switch
                    checked={z.active}
                    disabled={toggleZone.isPending}
                    onCheckedChange={() => toggleZone.mutate(z)}
                    aria-label={t("adm.city.zoneActive", { name: z.name })}
                  />
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 rounded-full text-xs"
                onClick={() => {
                  setZoneForm({ key: "", name: "", lat: String(c.centerLat), lng: String(c.centerLng) });
                  setZoneCity(c);
                }}
              >
                <Plus className="size-3.5" /> {t("adm.city.addZone")}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 rounded-full text-xs" onClick={() => openCity(c)}>
                <Pencil className="size-3.5" /> {t("c.edit")}
              </Button>
              <Button
                size="sm"
                variant={c.active ? "ghost" : "default"}
                className="h-7 rounded-full text-xs ml-auto"
                disabled={toggleCity.isPending}
                onClick={() => toggleCity.mutate(c)}
              >
                {!c.active && <Rocket className="size-3.5" />}
                {c.active ? t("adm.city.pause") : t("adm.city.launch")}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!cityDialog} onOpenChange={(v) => !v && setCityDialog(null)}>
        <DialogContent className="rounded-3xl max-w-md">
          <DialogHeader>
            <DialogTitle>{cityDialog?.city ? cityDialog.city.name : t("adm.city.new")}</DialogTitle>
            <DialogDescription>{t("adm.city.dialogDesc")}</DialogDescription>
          </DialogHeader>
          {f && (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                saveCity.mutate();
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="city-name">{t("adm.city.f.name")}</Label>
                  <Input
                    id="city-name"
                    value={f.name}
                    onChange={(e) =>
                      setCityForm({ ...f, name: e.target.value, ...(cityDialog?.city ? {} : { key: slug(e.target.value) }) })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="city-key">{t("adm.city.f.key")}</Label>
                  <Input
                    id="city-key"
                    value={f.key}
                    disabled={!!cityDialog?.city}
                    onChange={(e) => setCityForm({ ...f, key: slug(e.target.value) })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="city-lat">{t("adm.city.f.lat")}</Label>
                  <Input id="city-lat" inputMode="decimal" placeholder="-16.5" value={f.lat} onChange={(e) => setCityForm({ ...f, lat: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="city-lng">{t("adm.city.f.lng")}</Label>
                  <Input id="city-lng" inputMode="decimal" placeholder="-68.15" value={f.lng} onChange={(e) => setCityForm({ ...f, lng: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>{t("adm.city.f.durations")}</Label>
                <div className="mt-1 grid grid-cols-3 gap-2">
                  {[30, 45, 60].map((d) => {
                    const on = f.durations.includes(d);
                    const key = d === 30 ? "p30" : d === 45 ? "p45" : "p60";
                    return (
                      <div key={d} className={cn("rounded-xl border p-2 space-y-1.5", !on && "opacity-60")}>
                        <label className="flex items-center justify-between gap-2 text-sm font-bold">
                          {d} min
                          <Switch
                            checked={on}
                            onCheckedChange={(v) =>
                              setCityForm({
                                ...f,
                                durations: v ? [...f.durations, d].sort((a, b) => a - b) : f.durations.filter((x) => x !== d),
                              })
                            }
                          />
                        </label>
                        <Input
                          aria-label={t("adm.city.f.price", { d })}
                          inputMode="decimal"
                          value={f[key]}
                          onChange={(e) => setCityForm({ ...f, [key]: e.target.value })}
                        />
                      </div>
                    );
                  })}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t("adm.city.f.pricesHint")}</p>
              </div>
              <div>
                <Label htmlFor="city-peaks">{t("adm.city.f.peaks")}</Label>
                <Input id="city-peaks" value={f.peaks} onChange={(e) => setCityForm({ ...f, peaks: e.target.value })} />
                <p className="mt-1 text-xs text-muted-foreground">{t("adm.city.f.peaksHint")}</p>
              </div>
              <DialogFooter>
                <Button
                  type="submit"
                  className="rounded-full font-bold"
                  disabled={saveCity.isPending || f.name.trim().length < 2 || !f.key || f.durations.length === 0}
                >
                  {saveCity.isPending && <Loader2 className="size-4 animate-spin" />}
                  {t("c.save")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!zoneCity} onOpenChange={(v) => !v && setZoneCity(null)}>
        <DialogContent className="rounded-3xl max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("adm.city.zoneTitle", { city: zoneCity?.name ?? "" })}</DialogTitle>
            <DialogDescription>{t("adm.city.zoneDesc")}</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              addZone.mutate();
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="zone-name">{t("adm.city.f.name")}</Label>
                <Input
                  id="zone-name"
                  value={zoneForm.name}
                  onChange={(e) => setZoneForm({ ...zoneForm, name: e.target.value, key: slug(e.target.value) })}
                />
              </div>
              <div>
                <Label htmlFor="zone-key">{t("adm.city.f.key")}</Label>
                <Input id="zone-key" value={zoneForm.key} onChange={(e) => setZoneForm({ ...zoneForm, key: slug(e.target.value) })} />
              </div>
              <div>
                <Label htmlFor="zone-lat">{t("adm.city.f.lat")}</Label>
                <Input id="zone-lat" inputMode="decimal" value={zoneForm.lat} onChange={(e) => setZoneForm({ ...zoneForm, lat: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="zone-lng">{t("adm.city.f.lng")}</Label>
                <Input id="zone-lng" inputMode="decimal" value={zoneForm.lng} onChange={(e) => setZoneForm({ ...zoneForm, lng: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" className="rounded-full font-bold" disabled={addZone.isPending || zoneForm.name.trim().length < 2 || !zoneForm.key}>
                {addZone.isPending && <Loader2 className="size-4 animate-spin" />}
                {t("adm.city.addZone")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
