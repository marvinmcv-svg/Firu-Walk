// /legal — index of the legal documents.

import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_SLUGS, legalDoc } from "@/lib/firu/legal";
import { LegalFrame, langOf, legalConfig } from "./shared";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Legal — FiruWalk",
};

export default async function LegalIndex({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const lang = langOf((await searchParams).lang);
  const cfg = await legalConfig();
  return (
    <LegalFrame lang={lang}>
      <h1 className="text-3xl font-black tracking-tight">{lang === "en" ? "Legal" : "Información legal"}</h1>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {LEGAL_SLUGS.map((s) => {
          const d = legalDoc(s, cfg, lang);
          return (
            <li key={s}>
              <Link
                href={`/legal/${s}${lang === "en" ? "?lang=en" : ""}`}
                className="block h-full rounded-2xl border p-4 transition-colors hover:border-primary/50 hover:bg-muted/50"
              >
                <p className="font-extrabold">{d.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{d.summary}</p>
              </Link>
            </li>
          );
        })}
      </ul>
    </LegalFrame>
  );
}
