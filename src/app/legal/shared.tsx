// Shared bits for the public legal pages (server components, no client JS).

import Link from "next/link";
import { DEFAULT_CONFIG, getAppConfig } from "@/lib/server/config";
import { LEGAL_SLUGS, LEGAL_TITLES, type LegalLang, type LegalSlug } from "@/lib/firu/legal";
import type { AppConfig } from "@/lib/firu/types";
import { log } from "@/lib/server/log";

export function langOf(v: string | string[] | undefined): LegalLang {
  return v === "en" ? "en" : "es";
}

/** Live config; the defaults if the database is unreachable, so the pages never 500. */
export async function legalConfig(): Promise<AppConfig> {
  try {
    return await getAppConfig();
  } catch (err) {
    log.error("legal.config_unavailable", { error: (err as Error).message });
    return DEFAULT_CONFIG;
  }
}

export function LegalFrame({
  lang,
  current,
  children,
}: {
  lang: LegalLang;
  current?: LegalSlug;
  children: React.ReactNode;
}) {
  const other: LegalLang = lang === "es" ? "en" : "es";
  const href = (slug?: LegalSlug, l: LegalLang = lang) =>
    `/legal${slug ? `/${slug}` : ""}${l === "en" ? "?lang=en" : ""}`;
  return (
    <div lang={lang === "en" ? "en" : "es-BO"} className="min-h-dvh bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-extrabold">
            <img src="/images/brand/logo-mark-mint.png" alt="" className="size-8 rounded-lg border" />
            FiruWalk
          </Link>
          <Link
            href={href(current, other)}
            className="rounded-full border px-3 py-1 text-xs font-bold hover:bg-muted"
            hrefLang={other === "en" ? "en" : "es"}
          >
            {other === "en" ? "English" : "Español"}
          </Link>
        </div>
        <nav aria-label={lang === "en" ? "Legal documents" : "Documentos legales"} className="mx-auto max-w-3xl px-4 pb-3">
          <ul className="flex flex-wrap gap-2 text-sm">
            {LEGAL_SLUGS.map((s) => (
              <li key={s}>
                <Link
                  href={href(s)}
                  aria-current={s === current ? "page" : undefined}
                  className={
                    s === current
                      ? "rounded-full bg-primary px-3 py-1 font-bold text-primary-foreground"
                      : "rounded-full px-3 py-1 font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                  }
                >
                  {LEGAL_TITLES[lang][s]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
      <footer className="border-t">
        <div className="mx-auto max-w-3xl px-4 py-6 text-xs text-muted-foreground">
          <Link href="/" className="font-semibold text-primary hover:underline">
            {lang === "en" ? "← Back to FiruWalk" : "← Volver a FiruWalk"}
          </Link>
        </div>
      </footer>
    </div>
  );
}
