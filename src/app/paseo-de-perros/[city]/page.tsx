// /paseo-de-perros/{city} — local-SEO page per launched city: covered zones,
// walk lengths and prices, peak hours, and a link into the booking funnel.
// Server-rendered, no client JS; 404 for cities not launched yet.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { cityDurations, cityPeaks, cityPriceForDuration } from "@/lib/server/cities";
import { getAppConfig, DEFAULT_CONFIG } from "@/lib/server/config";
import { log } from "@/lib/server/log";
import { formatBOBShort } from "@/lib/firu/money";
import { siteUrl } from "@/lib/siteUrl";

export const dynamic = "force-dynamic";

async function load(key: string) {
  try {
    const city = await db.city.findUnique({
      where: { key },
      include: { zones: { where: { active: true }, orderBy: { sortOrder: "asc" } } },
    });
    if (!city || !city.active || city.zones.length === 0) return null;
    return city;
  } catch (err) {
    log.error("city_page.unavailable", { error: (err as Error).message });
    return null;
  }
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const city = await load((await params).city);
  if (!city) return { title: "FiruWalk" };
  const zones = city.zones.map((z) => z.name).join(", ");
  return {
    title: `Paseo de perros en ${city.name} — FiruWalk`,
    description: `Paseadores de perros verificados en ${city.name} (${zones}). GPS en vivo, reporte con fotos y pago con QR.`,
    alternates: { canonical: `/paseo-de-perros/${city.key}` },
    openGraph: {
      title: `Paseo de perros en ${city.name} — FiruWalk`,
      description: `Paseadores verificados en ${zones}.`,
      url: `/paseo-de-perros/${city.key}`,
      locale: "es_BO",
      type: "website",
    },
  };
}

export default async function CityPage({ params }: { params: Promise<{ city: string }> }) {
  const city = await load((await params).city);
  if (!city) notFound();
  const cfg = await getAppConfig().catch(() => DEFAULT_CONFIG);
  const durations = cityDurations(city);
  const peaks = cityPeaks(city);
  const url = siteUrl();
  const prices = durations.map((d) => ({ d, cents: cityPriceForDuration(city, d) }));
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "Paseo de perros",
    name: `FiruWalk — paseo de perros en ${city.name}`,
    url: `${url}/paseo-de-perros/${city.key}`,
    provider: { "@id": `${url}/#business` },
    areaServed: city.zones.map((z) => ({ "@type": "Place", name: `${z.name}, ${city.name}` })),
    offers: prices.map((p) => ({
      "@type": "Offer",
      name: `Paseo de ${p.d} minutos`,
      price: (p.cents / 100).toFixed(2),
      priceCurrency: "BOB",
    })),
  };
  const wa = `https://wa.me/${cfg.platform.supportWhatsApp.replace(/\D/g, "")}?text=${encodeURIComponent(
    `Hola FiruWalk 🐾 Quiero paseos para mi perro en ${city.name}.`
  )}`;

  return (
    <div lang="es-BO" className="min-h-dvh bg-background">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-extrabold">
            <img src="/images/brand/logo-mark-mint.png" alt="" className="size-8 rounded-lg border" />
            FiruWalk
          </Link>
          <Link href="/" className="rounded-full border px-3 py-1 text-xs font-bold hover:bg-muted">
            Ingresar
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10 space-y-10">
        <section>
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-primary">{city.name}</p>
          <h1 className="mt-2 text-3xl sm:text-4xl font-black tracking-tight text-balance">
            Paseo de perros en {city.name}, con paseadores verificados
          </h1>
          <p className="mt-4 text-muted-foreground leading-relaxed text-pretty">
            Paseadores entrevistados, con certificado de antecedentes y paseo de prueba. Sigues el paseo en vivo por GPS,
            recibes un reporte con fotos y pagas con QR. {cfg.platform.guaranteeText}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={`/?book=1&zone=${encodeURIComponent(city.zones[0].key)}`}
              className="inline-flex h-12 items-center rounded-full bg-primary px-6 text-sm font-extrabold text-primary-foreground"
            >
              Reservar un paseo
            </Link>
            <a href={wa} className="inline-flex h-12 items-center rounded-full border px-6 text-sm font-extrabold hover:bg-muted">
              Escribir por WhatsApp
            </a>
          </div>
        </section>

        <section aria-labelledby="zonas">
          <h2 id="zonas" className="text-xl font-black">Zonas donde paseamos</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {city.zones.map((z) => (
              <li key={z.id}>
                <Link
                  href={`/?book=1&zone=${encodeURIComponent(z.key)}`}
                  className="inline-flex rounded-full border bg-card px-4 py-2 text-sm font-bold hover:border-primary/50"
                >
                  {z.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="precios">
          <h2 id="precios" className="text-xl font-black">Precios por paseo</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-3">
            {prices.map((p) => (
              <li key={p.d} className="rounded-2xl border bg-card p-4">
                <p className="text-sm font-bold text-muted-foreground">{p.d} minutos</p>
                <p className="mt-1 text-2xl font-black">{formatBOBShort(p.cents)}</p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-muted-foreground">
            Precio base; cada paseador puede ajustar el suyo y ves el total antes de pagar. Planes mensuales con descuento en la app.
          </p>
        </section>

        {peaks.length > 0 && (
          <section aria-labelledby="horarios">
            <h2 id="horarios" className="text-xl font-black">Mejores horarios para pasear</h2>
            <p className="mt-2 text-muted-foreground">
              {peaks.map(([a, b]) => `${hhmm(a)} a ${hhmm(b)}`).join(" y ")}: los horarios más pedidos en {city.name}. Reserva
              con tiempo para asegurar a tu paseador.
            </p>
          </section>
        )}
      </main>
      <footer className="border-t">
        <div className="mx-auto max-w-3xl px-4 py-6 text-sm text-muted-foreground flex flex-wrap gap-4">
          <Link href="/">FiruWalk</Link>
          <Link href="/legal">Información legal</Link>
        </div>
      </footer>
    </div>
  );
}
