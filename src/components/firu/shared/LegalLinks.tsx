"use client";

// Links to the public legal pages (/legal/*) in the active language, and the
// consent lines shown where people sign up (sign-in, walker application).

import { useT } from "@/lib/firu/i18n";
import { LEGAL_TITLES, type LegalSlug } from "@/lib/firu/legal";

export function legalHref(slug: LegalSlug | null, lang: string): string {
  return `/legal${slug ? `/${slug}` : ""}${lang === "en" ? "?lang=en" : ""}`;
}

export function LegalLink({ slug, children }: { slug: LegalSlug; children?: React.ReactNode }) {
  const { lang } = useT();
  return (
    <a
      href={legalHref(slug, lang)}
      target="_blank"
      rel="noopener"
      className="font-semibold text-primary underline-offset-2 hover:underline"
    >
      {children ?? LEGAL_TITLES[lang === "en" ? "en" : "es"][slug]}
    </a>
  );
}

/** "By continuing you accept the Terms, the Privacy Policy and the Cancellation policy." */
export function SignInConsent() {
  const { t } = useT();
  return (
    <p className="text-[11px] leading-relaxed text-muted-foreground" data-testid="signin-consent">
      {t("sh.legal.consentPre")} <LegalLink slug="terminos">{t("sh.legal.terms")}</LegalLink>
      {t("sh.legal.sep")} <LegalLink slug="privacidad">{t("sh.legal.privacy")}</LegalLink> {t("sh.legal.and")}{" "}
      <LegalLink slug="cancelaciones">{t("sh.legal.cancellation")}</LegalLink>.
    </p>
  );
}

/** Body of the walker-application checkbox label. */
export function WalkerConsentText() {
  const { t } = useT();
  return (
    <>
      {t("sh.legal.walkerPre")} <LegalLink slug="paseadores">{t("sh.legal.walker")}</LegalLink>
      {t("sh.legal.sep")} <LegalLink slug="terminos">{t("sh.legal.terms")}</LegalLink> {t("sh.legal.and")}{" "}
      <LegalLink slug="privacidad">{t("sh.legal.privacy")}</LegalLink>.
    </>
  );
}
