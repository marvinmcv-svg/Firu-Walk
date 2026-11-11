// /sitemap.xml — the landing, one page per launched city and the legal pages
// (ES + EN courtesy translation).

import type { MetadataRoute } from "next";
import { LEGAL_SLUGS } from "@/lib/firu/legal";
import { activeCities } from "@/lib/server/cities";
import { siteUrl } from "@/lib/siteUrl";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const cities = await activeCities().catch(() => []);
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    ...cities.map((c) => ({
      url: `${base}/paseo-de-perros/${c.key}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    { url: `${base}/legal`, changeFrequency: "monthly", priority: 0.3 },
    ...LEGAL_SLUGS.map((slug) => ({
      url: `${base}/legal/${slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.3,
      alternates: { languages: { es: `${base}/legal/${slug}`, en: `${base}/legal/${slug}?lang=en` } },
    })),
  ];
}
