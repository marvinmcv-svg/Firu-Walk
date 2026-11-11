"use client";

// "Firu del mes" + featured walkers, curated in Admin → Usuarios → Contenido.
// Only people who consented appear (the API filters); renders nothing until
// ops publish something.

import { useQuery } from "@tanstack/react-query";
import { Crown, Footprints, MapPin, Star } from "lucide-react";
import { api } from "@/lib/firu/api";
import { useT } from "@/lib/firu/i18n";
import type { PublicFeaturedDTO } from "@/lib/firu/types";
import { Reveal, SectionHeading } from "./primitives";

function monthName(month: string, lang: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "en" ? "en" : "es-BO", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, 1))
  );
}

export function FeaturedSection() {
  const { t, lang } = useT();
  const { data } = useQuery({
    queryKey: ["content", "featured"],
    queryFn: () => api.get<PublicFeaturedDTO>("/api/content/featured"),
    staleTime: 60_000,
  });
  if (!data || (!data.firu && data.spotlights.length === 0)) return null;
  const { firu, spotlights } = data;

  return (
    <section id="firu-del-mes" className="relative overflow-x-clip" data-testid="featured-section">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:py-24">
        <SectionHeading eyebrow={t("land.feat.eyebrow")} title={t("land.feat.title")} subtitle={t("land.feat.subtitle")} />
        <div className="mt-12 grid gap-5 lg:grid-cols-5">
          {firu && (
            <Reveal className={spotlights.length > 0 ? "lg:col-span-3" : "lg:col-span-5"}>
              <article
                className="h-full overflow-hidden rounded-3xl border bg-card shadow-card sm:grid sm:grid-cols-2"
                data-testid="featured-firu"
              >
                <div className="relative aspect-[4/3] sm:aspect-auto bg-muted">
                  <img
                    src={firu.photoUrl ?? "/images/brand/logo-mark-mint.png"}
                    alt={t("land.feat.photoAlt", { name: firu.dogName })}
                    className="absolute inset-0 size-full object-cover"
                  />
                  <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-black text-primary-foreground shadow-raise">
                    <Crown className="size-3.5" aria-hidden />
                    {t("land.feat.firuBadge", { month: monthName(firu.month, lang) })}
                  </span>
                </div>
                <div className="p-6 flex flex-col justify-center">
                  <p className="text-2xl font-black tracking-tight leading-tight">{firu.headline}</p>
                  <p className="mt-1 text-sm font-bold text-muted-foreground">
                    {firu.dogName} · {firu.breed}
                    {firu.zoneName && (
                      <span className="inline-flex items-center gap-1 ml-1.5">
                        · <MapPin className="size-3.5" aria-hidden /> {firu.zoneName}
                      </span>
                    )}
                  </p>
                  <p className="mt-4 text-muted-foreground leading-relaxed text-pretty">{firu.blurb}</p>
                </div>
              </article>
            </Reveal>
          )}
          {spotlights.length > 0 && (
            <div className={firu ? "lg:col-span-2 grid gap-4" : "lg:col-span-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"}>
              {spotlights.map((s, i) => (
                <Reveal key={s.id} delay={0.08 * (i + 1)}>
                  <article className="h-full rounded-3xl border bg-card p-4 shadow-card flex gap-4" data-testid="featured-walker">
                    <img
                      src={s.photoUrl ?? "/images/brand/logo-mark-mint.png"}
                      alt={t("land.feat.photoAlt", { name: s.walkerName })}
                      className="size-20 shrink-0 rounded-2xl object-cover bg-muted border"
                    />
                    <div className="min-w-0">
                      <span className="text-[11px] font-extrabold uppercase tracking-wider text-primary">
                        {t("land.feat.spotBadge")}
                      </span>
                      <p className="font-black leading-tight">{s.walkerName}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs font-semibold text-muted-foreground">
                        {s.ratingCount > 0 && (
                          <span className="inline-flex items-center gap-0.5">
                            <Star className="size-3 fill-amber-400 text-amber-400" aria-hidden /> {s.rating.toFixed(1)}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-0.5">
                          <Footprints className="size-3" aria-hidden /> {t("land.feat.walks", { count: s.totalWalks })}
                        </span>
                        {s.zoneName && <span>{s.zoneName}</span>}
                      </p>
                      <p className="mt-2 text-sm font-bold leading-snug">{s.headline}</p>
                      <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{s.blurb}</p>
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
