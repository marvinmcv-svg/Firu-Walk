// /sitemap.xml — the landing and the legal pages (ES + EN courtesy translation).

import type { MetadataRoute } from "next";
import { LEGAL_SLUGS } from "@/lib/firu/legal";
import { siteUrl } from "@/lib/siteUrl";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/legal`, changeFrequency: "monthly", priority: 0.3 },
    ...LEGAL_SLUGS.map((slug) => ({
      url: `${base}/legal/${slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.3,
      alternates: { languages: { es: `${base}/legal/${slug}`, en: `${base}/legal/${slug}?lang=en` } },
    })),
  ];
}
