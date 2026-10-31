"use client";

// Landing + login (demo accounts / phone OTP / walker application).
// Owner-first funnel: promise (hero) → empathy (pain) → how → proof (report,
// pack, trust) → coverage (zones) → conversion (WhatsApp funnel) → objections
// (FAQ) → final CTA. Sticky footer per design standards (min-h-screen
// flex-col, footer mt-auto). Section components live in ../landing/.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  animate,
  MotionConfig,
  motion,
  useInView,
  useMotionTemplate,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type Variants,
} from "framer-motion";
import {
  BadgeCheck,
  ChevronRight,
  Footprints,
  Loader2,
  MapPin,
  MessageCircle,
  PawPrint,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { api, qk } from "@/lib/firu/api";
import { useFiruSession } from "@/lib/firu/session";
import { srvErr, useT } from "@/lib/firu/i18n";
import { formatBOBShort } from "@/lib/firu/money";
import { LangToggle } from "@/components/firu/shared/LangToggle";
import type {
  AppConfig,
  DemoAccountDTO,
  LoginResponse,
  OtpRequestResponse,
  ZoneDTO,
} from "@/lib/firu/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  springMomentum,
  springSnappy,
  staggerContainer,
  staggerItem,
} from "@/lib/firu/motion";
import { Hero } from "@/components/firu/landing/Hero";
import { PainSection } from "@/components/firu/landing/PainSection";
import { ReportShowcase } from "@/components/firu/landing/ReportShowcase";
import { WalkFunnel } from "@/components/firu/landing/WalkFunnel";
import { Faq } from "@/components/firu/landing/Faq";
import { StickyCta } from "@/components/firu/landing/StickyCta";
import {
  EXPO,
  Magnetic,
  Marquee,
  Reveal,
  ScrollProgress,
  SectionHeading,
  WhatsAppIcon,
  scrollToId,
  useFinePointer,
} from "@/components/firu/landing/primitives";

export function LandingScreen({
  initiallyShowLogin,
}: {
  onLogin?: () => void;
  initiallyShowLogin: boolean;
}) {
  const { t } = useT();
  const [loginOpen, setLoginOpen] = useState(initiallyShowLogin);
  const [applyOpen, setApplyOpen] = useState(false);
  const { data: config } = useQuery({
    queryKey: qk.config,
    queryFn: () => api.get<AppConfig>("/api/config"),
  });
  const { data: zones } = useQuery({
    queryKey: qk.zones,
    queryFn: () => api.get<ZoneDTO[]>("/api/zones"),
  });

  const supportWa = config?.platform.supportWhatsApp ?? "+59177165787";
  const waLink = `https://wa.me/${supportWa.replace(/\D/g, "")}`;
  const city = config?.platform.city ?? "Santa Cruz de la Sierra";
  const cancelHours = config?.policy.cancellationFreeHours ?? 12;
  const pricing = config
    ? {
        30: config.pricing.price30Cents,
        45: config.pricing.price45Cents,
        60: config.pricing.price60Cents,
      }
    : null;
  const reduceMotion = useReducedMotion();

  // Header turns into a floating material once the page moves.
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 12));

  const goFunnel = () => scrollToId("reservar");

  const howSteps = [
    { icon: Smartphone, title: t("land.how.s1.title"), text: t("land.how.s1.text") },
    { icon: MapPin, title: t("land.how.s2.title"), text: t("land.how.s2.text") },
    { icon: Sparkles, title: t("land.how.s3.title"), text: t("land.how.s3.text") },
  ];
  const trustItems: [string, string][] = [
    [t("land.trust.item1.title"), t("land.trust.item1.text")],
    [t("land.trust.item2.title"), t("land.trust.item2.text")],
    [t("land.trust.item3.title"), t("land.trust.item3.text")],
    [
      config?.platform.guaranteeText.split(":")[0] ?? "Garantía FiruWalk",
      config?.platform.guaranteeText ??
        "Si tu paseador cancela, encontramos un respaldo o te acreditamos el paseo.",
    ],
  ];
  const trustStats: {
    icon: LucideIcon;
    label: string;
    num?: number;
    prefix?: string;
    suffix?: string;
    text?: string;
  }[] = [
    { icon: BadgeCheck, num: 100, suffix: "%", label: t("land.trust.stat1") },
    { icon: MapPin, text: "GPS", label: t("land.trust.stat2") },
    pricing
      ? { icon: Wallet, num: Math.round(pricing[30] / 100), prefix: "Bs ", label: t("land.trust.stat3") }
      : { icon: Wallet, text: "Bs —", label: t("land.trust.stat3") },
    { icon: MessageCircle, num: 24, suffix: "/7", label: t("land.trust.stat4") },
  ];
  const marquee = [1, 2, 3, 4, 5, 6, 7].map((n) => (
    <span
      key={n}
      className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-4 py-2 text-sm font-bold text-foreground/80 shadow-card"
    >
      <PawPrint className="size-3.5 text-primary" aria-hidden />
      {t(`land.marquee.${n}`)}
    </span>
  ));

  return (
    <MotionConfig reducedMotion="user">
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header — glass material + reading-progress hairline */}
      <header
        className={`firu-glass sticky top-0 z-40 border-b pt-safe transition-[border-color,box-shadow] duration-300 ${
          scrolled ? "border-border/60 shadow-card" : "border-transparent"
        }`}
      >
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between">
          <button
            type="button"
            className="flex items-center transition-transform duration-150 ease-out-expo active:scale-95"
            onClick={() => window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" })}
            aria-label="FiruWalk"
          >
            <img src="/images/brand/logo-wordmark.png" alt="FiruWalk" className="h-9 w-auto dark:hidden" />
            <img src="/images/brand/logo-wordmark-dark.png" alt="FiruWalk" className="h-9 w-auto hidden dark:block" />
          </button>
          <nav className="hidden md:flex items-center gap-1 text-sm font-semibold text-muted-foreground">
            {[
              ["#como-funciona", t("land.nav.how")],
              ["#confianza", t("land.nav.trust")],
              ["#zonas", t("land.nav.zones")],
              ["#preguntas", t("land.nav.faq")],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="rounded-full px-3 py-1.5 hover:text-foreground hover:bg-secondary/80 transition-colors"
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <LangToggle />
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full hidden md:inline-flex font-bold"
              onClick={() => setApplyOpen(true)}
            >
              {t("land.cta.walker")}
            </Button>
            <Button size="sm" className="rounded-full font-bold firu-btn-gloss" onClick={() => setLoginOpen(true)}>
              {t("land.cta.login")}
            </Button>
          </div>
        </div>
        <ScrollProgress />
      </header>

      <Hero
        city={city}
        cancelHours={cancelHours}
        onPrimary={goFunnel}
        onSecondary={() => scrollToId("como-funciona")}
      />

      {/* Proof strip */}
      <div className="border-y bg-secondary/40 py-4">
        <Marquee items={marquee} />
      </div>

      <PainSection />

      {/* Cómo funciona — tilt-glass step cards + drawn paw timeline */}
      <section id="como-funciona" className="mx-auto max-w-6xl px-4 py-20 sm:py-24 w-full overflow-x-clip">
        <SectionHeading eyebrow={t("land.how.eyebrow")} title={t("land.nav.how")} subtitle={t("land.how.subtitle")} />
        <motion.div
          className="relative mt-12 grid sm:grid-cols-3 gap-4"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          variants={staggerContainer(0.09)}
        >
          {/* Mobile (<sm): vertical paw thread behind the stacked cards */}
          <svg
            aria-hidden
            viewBox="0 0 4 100"
            preserveAspectRatio="none"
            className="pointer-events-none absolute left-[47px] top-8 bottom-8 w-1 sm:hidden"
          >
            <motion.path
              d="M 2 0 V 100"
              fill="none"
              strokeWidth="2.5"
              strokeLinecap="round"
              className="stroke-primary/25"
              initial={{ pathLength: 0 }}
              whileInView={{ pathLength: 1 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={reduceMotion ? { duration: 0.01 } : { duration: 0.8, ease: EXPO, delay: 0.35 }}
            />
          </svg>
          {/* sm+: hairline drawn behind the icon row, fading at both ends */}
          <svg
            aria-hidden
            viewBox="0 0 100 14"
            preserveAspectRatio="none"
            className="pointer-events-none absolute left-[16%] right-[16%] top-[42px] hidden h-3.5 sm:block [mask-image:linear-gradient(90deg,transparent,black_18%,black_82%,transparent)] [-webkit-mask-image:linear-gradient(90deg,transparent,black_18%,black_82%,transparent)]"
          >
            <motion.path
              d="M 2 7 H 98"
              fill="none"
              strokeWidth="2"
              strokeLinecap="round"
              className="stroke-primary/25"
              initial={{ pathLength: 0 }}
              whileInView={{ pathLength: 1 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={reduceMotion ? { duration: 0.01 } : { duration: 0.8, ease: EXPO, delay: 0.35 }}
            />
          </svg>
          {[0, 1].map((n) => (
            <motion.span
              key={`paw-${n}`}
              aria-hidden
              className={`pointer-events-none absolute top-[42px] hidden -translate-x-1/2 sm:block ${n ? "left-2/3" : "left-1/3"}`}
              initial={{ opacity: 0, scale: 0, rotate: -16 }}
              whileInView={{ opacity: 1, scale: 1, rotate: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={reduceMotion ? { duration: 0.01 } : { ...springMomentum, delay: 0.75 + n * 0.2 }}
            >
              <PawPrint className="size-3.5 text-primary/45" />
            </motion.span>
          ))}
          {howSteps.map((s, i) => (
            <HowStepCard key={s.title} index={i} icon={s.icon} title={s.title} text={s.text} />
          ))}
        </motion.div>
        <Reveal className="mt-10 flex justify-center" delay={0.2}>
          <Button size="lg" className="rounded-full font-extrabold firu-btn-gloss" onClick={goFunnel}>
            {t("land.hero.ctaPrimary")} <ChevronRight className="size-5" />
          </Button>
        </Reveal>
      </section>

      <ReportShowcase />

      {/* La manada — family photo wall */}
      <section id="manada" className="relative overflow-x-clip">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:py-24">
          <SectionHeading title={t("land.pack.title")} subtitle={t("land.pack.subtitle")} />
          <motion.div
            className="mt-12 grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-60px" }}
            variants={staggerContainer(0.1)}
          >
            {[
              { src: "/images/pets/pack-row.jpg", alt: t("land.pack.p1.alt"), cap: t("land.pack.p1.cap"), rot: -2 },
              { src: "/images/pets/pack-camp.jpg", alt: t("land.pack.p2.alt"), cap: t("land.pack.p2.cap"), rot: 2 },
              { src: "/images/pets/pack-leashes.jpg", alt: t("land.pack.p3.alt"), cap: t("land.pack.p3.cap"), rot: -1.5 },
            ].map((p, i) => (
              <motion.figure
                key={p.src}
                variants={{
                  hidden: { opacity: 0, y: 40, rotate: p.rot * 4, scale: 0.92 },
                  show: {
                    opacity: 1,
                    y: 0,
                    rotate: p.rot,
                    scale: 1,
                    transition: { type: "spring", duration: 0.9, bounce: 0.25 },
                  },
                }}
                whileHover={reduceMotion ? undefined : { rotate: 0, y: -8, scale: 1.03, transition: springSnappy }}
                className="rounded-2xl bg-card border border-border/70 p-2 pb-2.5 shadow-card hover:shadow-float transition-shadow duration-300"
                style={{ zIndex: 3 - i }}
              >
                <div className="overflow-hidden rounded-xl">
                  <img src={p.src} alt={p.alt} className="w-full aspect-[4/5] object-cover transition-transform duration-700 ease-out-expo hover:scale-105" />
                </div>
                <figcaption className="text-xs font-bold text-center mt-2 text-muted-foreground leading-snug">
                  {p.cap}
                </figcaption>
              </motion.figure>
            ))}
            {/* CTA tile: join the pack */}
            <motion.div
              variants={staggerItem}
              className="relative overflow-hidden rounded-2xl firu-gloss bg-primary text-primary-foreground p-4 flex flex-col items-center justify-center text-center gap-2 shadow-raise"
            >
              <PawPrint className="absolute -bottom-4 -right-4 size-24 opacity-15 rotate-12 firu-bob" aria-hidden />
              <p className="font-black text-lg leading-snug">{t("land.pack.ctaTitle")}</p>
              <p className="text-xs opacity-90">{t("land.pack.ctaText")}</p>
              <Button size="sm" variant="secondary" className="rounded-full font-bold" onClick={goFunnel}>
                {t("land.pack.ctaBtn")}
              </Button>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Confianza — trust list + count-up stat cards over ambient glows */}
      <section id="confianza" className="relative overflow-x-clip bg-secondary/60 border-y">
        <motion.span
          aria-hidden
          className="pointer-events-none absolute -left-24 -top-12 size-80 rounded-full bg-sun-soft/50 blur-3xl"
          initial={{ opacity: 0, scale: 0.85 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={reduceMotion ? { duration: 0.01 } : { duration: 1, ease: EXPO }}
        />
        <div className="relative mx-auto max-w-6xl px-4 py-20 sm:py-24">
          <motion.div
            className="grid lg:grid-cols-2 gap-12 items-center"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-80px" }}
            variants={staggerContainer(0.1)}
          >
            <div>
              <SectionHeading align="left" eyebrow={t("land.trust.eyebrow")} title={t("land.trust.title")} subtitle={t("land.trust.intro")} />
              <motion.ul className="mt-8 space-y-4" variants={staggerContainer(0.09)}>
                {trustItems.map(([itemTitle, itemText], i) => (
                  <TrustItem key={itemTitle} index={i} title={itemTitle} text={itemText} />
                ))}
              </motion.ul>
            </div>
            <motion.div className="relative grid grid-cols-2 gap-4" variants={staggerContainer(0.07)}>
              <motion.span
                aria-hidden
                className="pointer-events-none absolute -inset-6 rounded-[2.5rem] bg-brand-soft/60 blur-3xl"
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={reduceMotion ? { duration: 0.01 } : { duration: 0.9, ease: EXPO }}
              />
              {trustStats.map((s, i) => (
                <TrustStatCard
                  key={s.label}
                  index={i}
                  icon={s.icon}
                  num={s.num}
                  prefix={s.prefix}
                  suffix={s.suffix}
                  text={s.text}
                  label={s.label}
                />
              ))}
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Zonas */}
      <section id="zonas" className="mx-auto max-w-6xl px-4 pt-20 sm:pt-24 pb-4 w-full">
        <SectionHeading
          eyebrow={t("land.zones.eyebrow")}
          title={t("land.zones.title")}
          subtitle={t("land.zones.subtitle", { city: config?.platform.city ?? "Santa Cruz" })}
        />
        <motion.div
          className="mt-8 flex flex-wrap justify-center gap-2.5"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-40px" }}
          variants={staggerContainer(0.06)}
        >
          {(zones ?? []).map((z) => (
            <motion.span
              key={z.id}
              variants={{
                hidden: { opacity: 0, y: 14, scale: 0.9 },
                show: { opacity: 1, y: 0, scale: 1, transition: springMomentum },
              }}
              whileHover={reduceMotion ? undefined : { y: -3 }}
              className="inline-flex items-center gap-1.5 rounded-full border bg-card px-4 py-2.5 text-sm font-bold shadow-card hover:border-primary/40 hover:shadow-raise transition-[border-color,box-shadow]"
            >
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 animate-ping [animation-duration:2.4s]" />
                <span className="relative inline-flex size-2 rounded-full bg-primary" />
              </span>
              {z.name}
            </motion.span>
          ))}
        </motion.div>
      </section>

      <WalkFunnel
        zones={(zones ?? []).map((z) => z.name)}
        pricing={pricing}
        supportWa={supportWa}
        onApp={() => setLoginOpen(true)}
      />

      <Faq
        prices={{
          p30: pricing ? formatBOBShort(pricing[30]) : "—",
          p45: pricing ? formatBOBShort(pricing[45]) : "—",
          p60: pricing ? formatBOBShort(pricing[60]) : "—",
        }}
        cancelHours={cancelHours}
      />

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-10 w-full">
        <Reveal>
          <div className="rounded-[2rem] firu-gloss bg-primary text-primary-foreground p-8 sm:p-14 text-center relative shadow-float overflow-hidden">
            <div aria-hidden className="absolute -top-32 left-1/2 size-[30rem] -translate-x-1/2 rounded-full bg-white/10 blur-3xl firu-drift" />
            <PawPrint className="absolute -top-6 -right-4 size-40 opacity-10 rotate-12 firu-bob" aria-hidden />
            <PawPrint className="absolute -bottom-10 -left-6 size-32 opacity-10 -rotate-12 firu-bob [animation-delay:-3s]" aria-hidden />
            <h2 className="relative text-3xl sm:text-5xl font-black tracking-tight text-balance">
              {t("land.final.title")}
            </h2>
            <p className="relative mt-4 opacity-90 max-w-xl mx-auto text-lg">{t("land.final.text")}</p>
            <p className="relative mt-1.5 text-sm opacity-80">{t("land.final.sub")}</p>
            <div className="relative mt-8 flex flex-wrap justify-center gap-3">
              <Magnetic>
                <Button
                  size="lg"
                  variant="secondary"
                  className="rounded-full text-base font-extrabold h-13 px-7"
                  onClick={() => setLoginOpen(true)}
                >
                  {t("land.final.cta")}
                </Button>
              </Magnetic>
              <a href={waLink} target="_blank" rel="noreferrer">
                <Button
                  size="lg"
                  variant="outline"
                  className="rounded-full text-base font-bold h-13 px-6 bg-transparent border-primary-foreground/40 text-primary-foreground hover:bg-primary-foreground/10"
                >
                  <WhatsAppIcon className="size-5" /> {t("land.final.whatsapp")}
                </Button>
              </a>
            </div>
          </div>
        </Reveal>
      </section>

      {/* Walker recruitment band — kept out of the owner path above */}
      <section className="mx-auto max-w-6xl px-4 pb-16 w-full">
        <Reveal>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 rounded-3xl border border-dashed border-border bg-card/60 p-5 sm:p-6">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-sun-soft text-[color-mix(in_oklab,var(--sun)_70%,var(--foreground))]">
              <Footprints className="size-6" aria-hidden />
            </span>
            <div className="flex-1">
              <p className="font-extrabold">{t("land.walkerBand.title")}</p>
              <p className="text-sm text-muted-foreground mt-0.5">{t("land.walkerBand.text")}</p>
            </div>
            <Button variant="outline" className="rounded-full font-bold" onClick={() => setApplyOpen(true)}>
              {t("land.walkerBand.cta")}
            </Button>
          </div>
        </Reveal>
      </section>

      {/* Footer (sticky bottom) */}
      <footer className="mt-auto border-t bg-secondary/40 pb-safe">
        <div className="mx-auto max-w-6xl px-4 py-8 grid sm:grid-cols-3 gap-6 text-sm">
          <div>
            <img src="/images/brand/logo-wordmark.png" alt="FiruWalk" className="h-8 w-auto dark:hidden" />
            <img src="/images/brand/logo-wordmark-dark.png" alt="FiruWalk" className="h-8 w-auto hidden dark:block" />
            <p className="text-muted-foreground mt-3">
              {t("land.footer.about", { city })}
            </p>
          </div>
          <div>
            <p className="font-bold mb-2">{t("land.footer.support")}</p>
            <a
              className="inline-flex items-center gap-1.5 text-primary font-semibold hover:underline"
              href={waLink}
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle className="size-4" /> {t("land.footer.whatsapp", { phone: supportWa })}
            </a>
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">{t("land.footer.demoNote")}</p>
          </div>
          <div>
            <p className="font-bold mb-2">{t("land.footer.company")}</p>
            <p className="text-muted-foreground text-xs leading-relaxed">{t("land.footer.legal")}</p>
            <p className="text-muted-foreground mt-3 text-xs">
              {t("land.footer.copyright", { year: new Date().getFullYear() })}
            </p>
          </div>
        </div>
      </footer>

      <StickyCta onClick={goFunnel} />
      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} />
      <ApplyDialog open={applyOpen} onOpenChange={setApplyOpen} />
    </div>
    </MotionConfig>
  );
}

/* ------------------------------------------------------------------ */
/* Premium card system (T11-c) — decorative motion layer.               */
/* Tilt + gloss follow the cursor through motion values (no setState   */
/* per move); entrances are spring/expo; every loop respects           */
/* prefers-reduced-motion. All asserted strings live in the plain JSX  */
/* above — everything here is aria-hidden decoration.                   */
/* ------------------------------------------------------------------ */

const reducedCardVariants: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.25, ease: "easeOut" } },
};

/** Glass card that tilts toward the cursor with a traveling gloss spot. */
function TiltCard({
  children,
  className,
  variants,
}: {
  children: ReactNode;
  className?: string;
  variants?: Variants;
}) {
  const reduce = useReducedMotion();
  const finePointer = useFinePointer();
  const active = finePointer && !reduce;

  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 250, damping: 24, mass: 0.55 });
  const sy = useSpring(my, { stiffness: 250, damping: 24, mass: 0.55 });
  const rotateX = useTransform(sy, [-0.5, 0.5], [5.5, -5.5]);
  const rotateY = useTransform(sx, [-0.5, 0.5], [-5.5, 5.5]);

  const glareOpacity = useMotionValue(0);
  const glareOpacitySpring = useSpring(glareOpacity, { stiffness: 350, damping: 30 });
  const glareX = useTransform(sx, (v) => `${Math.round((v + 0.5) * 100)}%`);
  const glareY = useTransform(sy, (v) => `${Math.round((v + 0.5) * 100)}%`);
  const glare = useMotionTemplate`radial-gradient(320px circle at ${glareX} ${glareY}, color-mix(in oklab, var(--primary) 10%, transparent) 0%, transparent 68%)`;

  return (
    <motion.div
      className={`group relative h-full ${className ?? ""}`}
      variants={variants ?? reducedCardVariants}
      style={active ? { rotateX, rotateY, transformPerspective: 900 } : undefined}
      onPointerMove={
        active
          ? (e) => {
              const r = e.currentTarget.getBoundingClientRect();
              mx.set(Math.max(-0.5, Math.min(0.5, (e.clientX - r.left) / r.width - 0.5)));
              my.set(Math.max(-0.5, Math.min(0.5, (e.clientY - r.top) / r.height - 0.5)));
            }
          : undefined
      }
      onPointerEnter={active ? () => glareOpacity.set(1) : undefined}
      onPointerLeave={
        active
          ? () => {
              mx.set(0);
              my.set(0);
              glareOpacity.set(0);
            }
          : undefined
      }
    >
      {children}
      {active && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 rounded-3xl"
          style={{ background: glare, opacity: glareOpacitySpring }}
        />
      )}
    </motion.div>
  );
}

/* --- Cómo funciona: step cards ------------------------------------- */

const stepCardVariants: Variants = {
  hidden: { opacity: 0, y: 26, scale: 0.97, filter: "blur(6px)" },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
    transition: {
      y: { type: "spring", duration: 0.55, bounce: 0.16 },
      opacity: { duration: 0.3, ease: EXPO },
      scale: { duration: 0.45, ease: EXPO },
      filter: { duration: 0.5, ease: EXPO },
    },
  },
};

/** Huge ghost numeral slowly floating behind the card content. */
const ghostFloatVariants: Variants = {
  hidden: { opacity: 0 },
  show: (i: number) => ({
    opacity: 1,
    y: [0, -5, 0],
    transition: {
      y: { duration: 6, repeat: Infinity, ease: "easeInOut", delay: i * 0.9 },
      opacity: { duration: 0.55, ease: "easeOut", delay: 0.2 },
    },
  }),
};
const ghostStaticVariants: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.4, ease: "easeOut" } },
};

const iconPopVariants: Variants = {
  hidden: { opacity: 0, scale: 0.4, rotate: -10 },
  show: { opacity: 1, scale: 1, rotate: 0, transition: springMomentum },
};
const bloomVariants: Variants = {
  hidden: { opacity: 0, scale: 0.3 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.6, ease: EXPO, delay: 0.12 } },
};

function HowStepCard({
  index,
  icon: Icon,
  title,
  text,
}: {
  index: number;
  icon: LucideIcon;
  title: string;
  text: string;
}) {
  const reduce = useReducedMotion();
  return (
    <TiltCard variants={stepCardVariants} className="h-full">
      <Card className="firu-gloss group relative h-full rounded-3xl border-border/70 bg-card transition-[transform,box-shadow,border-color] duration-300 ease-out-expo hover:-translate-y-1 hover:border-primary/30 hover:shadow-raise">
        <CardContent className="relative p-6">
          <motion.span
            aria-hidden
            variants={reduce ? ghostStaticVariants : ghostFloatVariants}
            custom={index}
            className="pointer-events-none absolute -top-4 right-2 select-none text-8xl font-black leading-none text-brand-soft"
          >
            {index + 1}
          </motion.span>
          <motion.span
            variants={iconPopVariants}
            whileHover={reduce ? undefined : { rotate: index === 1 ? -8 : 8, scale: 1.12 }}
            transition={springMomentum}
            className="relative mb-4 grid size-12 place-items-center rounded-2xl bg-brand-soft text-primary"
          >
            <motion.span
              aria-hidden
              variants={bloomVariants}
              className={`absolute -inset-2 rounded-full blur-lg ${
                index === 1 ? "bg-sun/25" : "bg-primary/20"
              }`}
            />
            <Icon className="relative size-6" aria-hidden />
          </motion.span>
          <h3 className="font-extrabold text-lg">{title}</h3>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{text}</p>
        </CardContent>
      </Card>
    </TiltCard>
  );
}

/* --- Confianza: count-up stat cards --------------------------------- */

const statCardVariants: Variants = {
  hidden: { opacity: 0, y: 22, scale: 0.97, filter: "blur(5px)" },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
    transition: {
      y: { type: "spring", duration: 0.5, bounce: 0.16 },
      opacity: { duration: 0.3, ease: EXPO },
      scale: { duration: 0.45, ease: EXPO },
      filter: { duration: 0.45, ease: EXPO },
    },
  },
};

/**
 * Stat value that renders the FINAL string immediately (Playwright asserts
 * "100%" / "12%" / "24/7" without scrolling first) and replays a ≤0.9s
 * count-up from 0 the first time it scrolls into view.
 */
function StatValue({ num, prefix, suffix, text }: { num?: number; prefix?: string; suffix?: string; text?: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const count = useMotionValue(num ?? 0);
  const rounded = useTransform(count, (v) => `${Math.round(v)}`);
  useEffect(() => {
    if (num === undefined) return;
    if (!inView || reduce) {
      count.set(num);
      return;
    }
    count.set(0);
    const controls = animate(count, num, { duration: 0.9, ease: EXPO });
    return () => controls.stop();
  }, [inView, reduce, num, count]);
  if (text !== undefined) return <span>{text}</span>;
  return (
    <span ref={ref}>
      {prefix}
      <motion.span>{rounded}</motion.span>
      {suffix}
    </span>
  );
}

function TrustStatCard({
  index,
  icon: Icon,
  num,
  prefix,
  suffix,
  text,
  label,
}: {
  index: number;
  icon: LucideIcon;
  num?: number;
  prefix?: string;
  suffix?: string;
  text?: string;
  label: string;
}) {
  const reduce = useReducedMotion();
  return (
    <TiltCard variants={statCardVariants} className="h-full">
      <Card className="firu-gloss group relative h-full rounded-3xl border-border/70 bg-card transition-[transform,box-shadow,border-color] duration-300 ease-out-expo hover:-translate-y-1 hover:border-primary/30 hover:shadow-raise">
        <CardContent className="relative p-5">
          <span
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-10 size-28 rounded-full bg-brand-soft/80 blur-2xl dark:opacity-60"
          />
          <span className="relative mb-3 grid size-11 place-items-center rounded-xl bg-brand-soft text-primary">
            <span aria-hidden className="absolute -inset-1 rounded-2xl border border-primary/15" />
            <motion.span
              aria-hidden
              className="absolute -inset-1"
              whileInView={{ rotate: 360 }}
              viewport={{ margin: "-40px" }}
              transition={{ duration: 9 + index * 1.5, repeat: Infinity, ease: "linear" }}
            >
              <span className="absolute left-1/2 top-0 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/60" />
            </motion.span>
            <span
              aria-hidden
              className="absolute -inset-1.5 rounded-2xl bg-primary/15 opacity-60 blur-md transition-opacity duration-300 ease-out-expo group-hover:opacity-100"
            />
            <Icon
              className="relative size-5 text-primary transition-transform duration-300 ease-out-expo group-hover:scale-110"
              aria-hidden
            />
          </span>
          <p className="text-2xl sm:text-3xl font-black tracking-tight">
            <StatValue key={text ?? "n"} num={num} prefix={prefix} suffix={suffix} text={text} />
          </p>
          <p className="text-xs text-muted-foreground mt-1 leading-snug">{label}</p>
        </CardContent>
      </Card>
    </TiltCard>
  );
}

/* --- Confianza: trust list ----------------------------------------- */

const trustItemVariants: Variants = {
  hidden: { opacity: 0, x: -8 },
  show: { opacity: 1, x: 0, transition: { duration: 0.35, ease: EXPO } },
};

const accentVariants: Variants = {
  hidden: { opacity: 0, scaleY: 0 },
  show: { opacity: 1, scaleY: 1, transition: { duration: 0.45, ease: EXPO, delay: 0.08 } },
};

const shieldPopVariants: Variants = {
  hidden: { opacity: 0, scale: 0.3, rotate: -14 },
  show: { opacity: 1, scale: 1, rotate: 0, transition: springMomentum },
};
/** One-shot green pulse ring behind the shield as the row enters. */
const pulseRingVariants: Variants = {
  hidden: { opacity: 0, scale: 0.6 },
  show: (i: number) => ({
    opacity: [0, 0.55, 0],
    scale: [0.6, 1.9, 2.3],
    transition: { duration: 0.9, times: [0, 0.45, 1], delay: 0.15 + i * 0.06, ease: "easeOut" },
  }),
};

function TrustItem({
  index,
  title,
  text,
}: {
  index: number;
  title: string;
  text: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.li
      className="group relative flex gap-3 rounded-xl pl-4"
      variants={trustItemVariants}
      whileHover={reduce ? undefined : { x: 3 }}
      transition={springSnappy}
    >
      <motion.span
        aria-hidden
        variants={accentVariants}
        className="absolute left-0 top-0 bottom-0 w-[3px] origin-top rounded-full bg-gradient-to-b from-primary/70 to-primary/10"
      />
      <motion.span
        className="relative mt-0.5 shrink-0"
        variants={shieldPopVariants}
      >
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full bg-primary/30"
          variants={pulseRingVariants}
          custom={index}
        />
        <ShieldCheck className="relative size-5 text-primary" aria-hidden />
      </motion.span>
      <div>
        <p className="font-bold transition-colors duration-200 group-hover:text-primary">{title}</p>
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
    </motion.li>
  );
}

/* ------------------------------------------------------------------ */
/* Login — demo accounts + phone/OTP                                   */
/* ------------------------------------------------------------------ */

function LoginDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const { t } = useT();
  const login = useFiruSession((s) => s.login);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  // Set once a code was sent: switches the form to the "enter code" step.
  const [sent, setSent] = useState<OtpRequestResponse | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const { data: config } = useQuery({
    queryKey: qk.config,
    queryFn: () => api.get<AppConfig>("/api/config"),
    enabled: open,
  });
  const demoMode = !!config?.demoMode;
  const { data: accounts } = useQuery({
    queryKey: qk.demoAccounts,
    queryFn: () => api.get<DemoAccountDTO[]>("/api/auth/demo-accounts"),
    enabled: open && demoMode,
  });

  // Tick once a second while the resend cooldown runs.
  useEffect(() => {
    if (!sent || now >= resendAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [sent, now, resendAt]);

  const welcome = (res: LoginResponse) => {
    login(res.user);
    onOpenChange(false);
    setSent(null);
    setCode("");
    toast({
      title: res.isNew
        ? t("land.login.welcomeNew", { name: res.user.name })
        : t("land.login.welcomeBack", { name: res.user.name.split(" ")[0] }),
      description: res.isNew
        ? t("land.login.descNew")
        : res.user.role === "OWNER"
          ? t("land.login.descOwner")
          : res.user.role === "WALKER"
            ? t("land.login.descWalker")
            : t("land.login.descAdmin"),
    });
  };
  const fail = (e: Error) =>
    toast({ title: t("land.login.errorTitle"), description: srvErr(e.message), variant: "destructive" });

  const demoLoginMut = useMutation({
    mutationFn: (userId: string) => api.post<LoginResponse>("/api/auth/demo-login", { userId }),
    onSuccess: welcome,
    onError: fail,
  });

  const sendCodeMut = useMutation({
    mutationFn: () => api.post<OtpRequestResponse>("/api/auth/otp", { phone }),
    onSuccess: (res) => {
      setSent(res);
      setNow(Date.now());
      setResendAt(Date.now() + res.resendInSeconds * 1000);
    },
    onError: fail,
  });

  const loginMut = useMutation({
    mutationFn: () => api.post<LoginResponse>("/api/auth/login", { phone, code }),
    onSuccess: welcome,
    onError: fail,
  });

  const owners = (accounts ?? []).filter((a) => a.role === "OWNER");
  const walkers = (accounts ?? []).filter((a) => a.role === "WALKER");
  const admins = (accounts ?? []).filter((a) => a.role === "ADMIN");
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const busy = demoLoginMut.isPending || sendCodeMut.isPending || loginMut.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <img
            src="/images/brand/logo-mark-mint.png"
            alt=""
            className="mx-auto size-16 rounded-2xl border shadow-sm"
          />
          <DialogTitle className="flex items-center justify-center gap-2 text-xl pt-1">
            {t("land.login.title")}
          </DialogTitle>
          <DialogDescription className="text-center">
            {demoMode ? (
              <>
                {t("land.login.descDemo")} {t("land.login.demoCode")}{" "}
                <code className="font-bold text-foreground">{config?.demo.otpCode}</code>
              </>
            ) : (
              t("land.login.desc")
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {demoMode &&
            [
              [t("land.login.groupOwners"), owners],
              [t("land.login.groupWalkers"), walkers],
              [t("land.login.groupAdmins"), admins],
            ].map(([label, list]) =>
              (list as DemoAccountDTO[]).length ? (
                <div key={label as string}>
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">
                    {label as string}
                  </p>
                  <div className="grid gap-2">
                    {(list as DemoAccountDTO[]).map((a) => (
                      <button
                        key={a.id}
                        disabled={busy}
                        className="flex items-center gap-3 rounded-2xl border p-2.5 text-left hover:border-primary/50 hover:bg-brand-soft/50 transition-colors disabled:opacity-60"
                        onClick={() => demoLoginMut.mutate(a.id)}
                      >
                        <img
                          src={a.avatarUrl ?? "/images/brand/logo-mark-mint.png"}
                          alt=""
                          className="size-10 rounded-full object-cover border"
                        />
                        <div className="min-w-0">
                          <p className="font-bold text-sm leading-tight truncate">{a.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{a.subtitle}</p>
                        </div>
                        <ChevronRight className="size-4 ml-auto text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : null
            )}

          <div className={demoMode ? "border-t pt-4" : ""}>
            {demoMode && (
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">
                {t("land.login.phoneSection")}
              </p>
            )}
            <div className="grid gap-3">
              <div>
                <Label htmlFor="login-phone" className="text-sm">{t("land.login.phoneLabel")}</Label>
                <Input
                  id="login-phone"
                  placeholder={t("land.phoneFormat")}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  inputMode="tel"
                  autoComplete="tel"
                  disabled={!!sent}
                />
              </div>
              {!sent ? (
                <Button
                  className="rounded-full font-bold"
                  disabled={busy || !phone}
                  onClick={() => sendCodeMut.mutate()}
                >
                  {sendCodeMut.isPending && <Loader2 className="size-4 animate-spin" />}
                  {t("land.login.sendCode")}
                </Button>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    {sent.demo
                      ? t("land.login.codeSentDemo", { code: config?.demo.otpCode ?? "" })
                      : t("land.login.codeSent", {
                          channel: sent.channel === "whatsapp" ? "WhatsApp" : "SMS",
                          phone,
                        })}
                  </p>
                  <div>
                    <Label htmlFor="login-code" className="text-sm">{t("land.login.codeLabel")}</Label>
                    <Input
                      id="login-code"
                      placeholder="••••••"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      autoFocus
                    />
                  </div>
                  <Button
                    className="rounded-full font-bold"
                    disabled={busy || code.length !== 6}
                    onClick={() => loginMut.mutate()}
                  >
                    {loginMut.isPending && <Loader2 className="size-4 animate-spin" />}
                    {t("land.cta.login")}
                  </Button>
                  <div className="flex items-center justify-between text-xs">
                    <button
                      className="font-semibold text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setSent(null);
                        setCode("");
                      }}
                    >
                      {t("land.login.changePhone")}
                    </button>
                    <button
                      className="font-semibold text-primary disabled:text-muted-foreground"
                      disabled={busy || resendIn > 0}
                      onClick={() => sendCodeMut.mutate()}
                    >
                      {resendIn > 0 ? t("land.login.resendIn", { s: resendIn }) : t("land.login.resend")}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Public walker application                                            */
/* ------------------------------------------------------------------ */

function ApplyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const { t } = useT();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [bio, setBio] = useState("");
  const [experienceYears, setExperienceYears] = useState("1");
  const { data: zones } = useQuery({
    queryKey: qk.zones,
    queryFn: () => api.get<ZoneDTO[]>("/api/zones"),
    enabled: open,
  });

  const applyMut = useMutation({
    mutationFn: () =>
      api.post("/api/walkers/apply", {
        name,
        phone,
        zoneId,
        bio,
        experienceYears: Number(experienceYears) || 0,
      }),
    onSuccess: () => {
      onOpenChange(false);
      toast({
        title: t("land.apply.successTitle"),
        description: t("land.apply.successDesc"),
      });
    },
    onError: (e: Error) =>
      toast({ title: t("land.apply.errorTitle"), description: srvErr(e.message), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Footprints className="size-5 text-primary" /> {t("land.apply.title")}
          </DialogTitle>
          <DialogDescription>
            {t("land.apply.desc")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label htmlFor="ap-name">{t("land.apply.name")}</Label>
            <Input id="ap-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("land.apply.namePh")} />
          </div>
          <div>
            <Label htmlFor="ap-phone">{t("land.apply.phone")}</Label>
            <Input id="ap-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("land.phoneFormat")} inputMode="tel" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("land.apply.zone")}</Label>
              <Select value={zoneId} onValueChange={setZoneId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("land.apply.zonePh")} />
                </SelectTrigger>
                <SelectContent>
                  {(zones ?? []).map((z) => (
                    <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="ap-exp">{t("land.apply.experience")}</Label>
              <Input id="ap-exp" value={experienceYears} onChange={(e) => setExperienceYears(e.target.value)} inputMode="numeric" />
            </div>
          </div>
          <div>
            <Label htmlFor="ap-bio">{t("land.apply.bio")}</Label>
            <Textarea
              id="ap-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={4}
              placeholder={t("land.apply.bioPh")}
            />
          </div>
          <Button
            className="rounded-full font-bold"
            disabled={applyMut.isPending || !name || !phone || !zoneId || !bio}
            onClick={() => applyMut.mutate()}
          >
            {applyMut.isPending && <Loader2 className="size-4 animate-spin" />}
            {t("land.apply.submit")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
