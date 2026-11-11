// /legal/[doc] — Terms, Privacy, Walker Agreement, Cancellation & Guarantee.
// Spanish by default, ?lang=en for the courtesy translation. Server-rendered
// from the live Config so the numbers match what the app enforces.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLegalSlug, LEGAL_TITLES, LEGAL_VERSION, legalDate, legalDoc } from "@/lib/firu/legal";
import { LegalFrame, langOf, legalConfig } from "../shared";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ doc: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { doc } = await params;
  if (!isLegalSlug(doc)) return {};
  const lang = langOf((await searchParams).lang);
  return {
    title: `${LEGAL_TITLES[lang][doc]} — FiruWalk`,
    alternates: { canonical: `/legal/${doc}`, languages: { es: `/legal/${doc}`, en: `/legal/${doc}?lang=en` } },
  };
}

export default async function LegalDocPage({ params, searchParams }: Props) {
  const { doc } = await params;
  if (!isLegalSlug(doc)) notFound();
  const lang = langOf((await searchParams).lang);
  const d = legalDoc(doc, await legalConfig(), lang);

  return (
    <LegalFrame lang={lang} current={doc}>
      <article>
        <h1 className="text-3xl font-black tracking-tight">{d.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {lang === "en" ? "In force since" : "Vigente desde el"} {legalDate(lang)} · v{LEGAL_VERSION}
        </p>
        <p className="mt-4 rounded-2xl bg-muted px-4 py-3 text-sm leading-relaxed">{d.summary}</p>
        {lang === "en" && (
          <p className="mt-3 text-xs text-muted-foreground">
            Courtesy translation. The Spanish version is the legally binding one.
          </p>
        )}
        {d.sections.map((s) => (
          <section key={s.heading} className="mt-8">
            <h2 className="text-lg font-extrabold">{s.heading}</h2>
            {s.paragraphs.map((p, i) => (
              <p key={i} className="mt-3 leading-relaxed text-foreground/90">
                {p}
              </p>
            ))}
          </section>
        ))}
      </article>
    </LegalFrame>
  );
}
