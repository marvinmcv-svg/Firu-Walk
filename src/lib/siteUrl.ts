// Canonical public URL of the site, for metadata, sitemap and structured
// data: APP_URL when set, else Vercel's production domain, else the brand
// domain. (Request-scoped links use appBaseUrl() in lib/server/partners.)

export function siteUrl(): string {
  const explicit = process.env.APP_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;
  return "https://firuwalk.bo";
}
