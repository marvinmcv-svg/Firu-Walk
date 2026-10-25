"use client";

// Landing + login (demo accounts / phone OTP / walker application).
// Sticky footer per design standards (min-h-screen flex-col, footer mt-auto).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  animate,
  MotionConfig,
  motion,
  useInView,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
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
  QrCode,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
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
import { LangToggle } from "@/components/firu/shared/LangToggle";
import type {
  AppConfig,
  DemoAccountDTO,
  LoginResponse,
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
  fadeUp,
  springMomentum,
  springSnappy,
  springSmooth,
  staggerContainer,
  staggerItem,
} from "@/lib/firu/motion";

export function LandingScreen({
  onLogin,
  initiallyShowLogin,
}: {
  onLogin: () => void;
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
  const reduceMotion = useReducedMotion();

  // Section data — t() stays at these call sites so the Playwright-asserted
  // ES strings ("1. Reserva", "100%", …) render byte-identical.
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
    suffix?: string;
    text?: string;
  }[] = [
    { icon: BadgeCheck, num: 100, suffix: "%", label: t("land.trust.stat1") },
    { icon: MapPin, text: "GPS", label: t("land.trust.stat2") },
    { icon: Wallet, num: 12, suffix: "%", label: t("land.trust.stat3") },
    { icon: MessageCircle, num: 24, suffix: "/7", label: t("land.trust.stat4") },
  ];

  return (
    <MotionConfig reducedMotion="user">
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="firu-glass sticky top-0 z-40 border-b border-border/50 pt-safe">
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between">
          <div className="flex items-center">
            {/* Brand logo (family-designed wordmark) */}
            <img
              src="/images/brand/logo-wordmark.png"
              alt="FiruWalk"
              className="h-9 w-auto dark:hidden"
            />
            <img
              src="/images/brand/logo-wordmark-dark.png"
              alt="FiruWalk"
              className="h-9 w-auto hidden dark:block"
            />
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm font-semibold text-muted-foreground">
            <a href="#como-funciona" className="hover:text-foreground transition-colors">
              {t("land.nav.how")}
            </a>
            <a href="#confianza" className="hover:text-foreground transition-colors">
              {t("land.nav.trust")}
            </a>
            <a href="#zonas" className="hover:text-foreground transition-colors">
              {t("land.nav.zones")}
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <LangToggle />
            <Button
              variant="outline"
              size="sm"
              className="rounded-full hidden md:inline-flex"
              onClick={() => setApplyOpen(true)}
            >
              {t("land.cta.walker")}
            </Button>
            <Button size="sm" className="rounded-full" onClick={() => setLoginOpen(true)}>
              {t("land.cta.login")}
            </Button>
          </div>
        </div>
      </header>

      {/* Hero — overflow-x-clip keeps the rotated decorative tiles from
          stretching the mobile viewport; content stays untouched */}
      <section className="firu-paw-pattern overflow-x-clip">
        <motion.div
            className="mx-auto max-w-6xl px-4 pt-10 pb-14 lg:pt-16 lg:pb-20 grid lg:grid-cols-2 gap-10 items-center"
            initial="hidden"
            animate="show"
            variants={staggerContainer(0.12)}
          >
          <motion.div variants={staggerContainer(0.07)}>
            <motion.span variants={fadeUp} className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1 text-xs font-extrabold text-primary shadow-card">
              <PawPrint className="size-3.5" aria-hidden />
              {t("land.hero.badge")}
            </motion.span>
            <motion.h1 variants={fadeUp} className="mt-3 text-4xl sm:text-5xl font-black leading-[1.05] tracking-tight text-balance">
              {t("land.hero.titleLead")}{" "}
              <span className="text-primary">{t("land.hero.titleTail")}</span> 🐾
            </motion.h1>
            <motion.p variants={fadeUp} className="mt-4 text-lg text-muted-foreground max-w-lg">
              {t("land.hero.bodyLead")}{" "}
              <strong>{config?.platform.city ?? "Santa Cruz de la Sierra"}</strong>
              {t("land.hero.bodyTail")}
            </motion.p>
            <motion.div variants={fadeUp} className="mt-6 flex flex-wrap gap-3">
              <Button size="lg" className="rounded-full text-base font-bold" onClick={() => setLoginOpen(true)}>
                {t("land.hero.ctaPrimary")}
                <ChevronRight className="size-5" />
              </Button>
              <Button size="lg" variant="outline" className="rounded-full text-base font-bold" onClick={() => setApplyOpen(true)}>
                <Footprints className="size-5" />
                {t("land.hero.ctaSecondary")}
              </Button>
            </motion.div>
            <motion.div variants={fadeUp} className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="size-4 text-primary" /> {t("land.hero.trustVerified")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Star className="size-4 fill-sun text-sun" /> {t("land.hero.trustRating")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <QrCode className="size-4 text-primary" /> {t("land.hero.trustQr")}
              </span>
            </motion.div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={springSmooth}
            className="relative"
          >
            <div className="absolute -top-4 -left-4 size-24 rounded-3xl bg-sun-soft rotate-12" aria-hidden />
            <div className="absolute -bottom-4 -right-4 size-28 rounded-3xl bg-brand-soft -rotate-6" aria-hidden />
            {/* Main photo: a real FiruWalk walk — walker's point of view */}
            <img
              src="/images/pets/pack-walker.jpg"
              alt={t("land.hero.photoAlt")}
              className="relative rounded-3xl border shadow-xl w-full object-cover aspect-[4/5]"
            />
            {/* Family photo wall: floating polaroid of the pack */}
            <motion.figure
              whileHover={{ scale: 1.06, rotate: 3 }}
              transition={springMomentum}
              className="absolute -top-5 -right-2 sm:-right-5 w-24 sm:w-32 rounded-xl bg-card border border-border/70 p-1.5 pb-1.5 shadow-raise rotate-6"
            >
              <img
                src="/images/pets/pack-heart.jpg"
                alt={t("land.pack.heartAlt")}
                className="rounded-lg w-full aspect-square object-cover"
              />
              <figcaption className="text-[10px] font-extrabold text-center text-muted-foreground mt-1">
                {t("land.pack.madeWithLove")}
              </figcaption>
            </motion.figure>
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ ...springMomentum, delay: 0.45 }}
              className="absolute -bottom-6 left-4 sm:left-8"
            >
            <Card className="shadow-float border-0 firu-frost">
              <CardContent className="p-3 flex items-center gap-3">
                <span className="relative flex size-3">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 animate-ping" />
                  <span className="relative inline-flex rounded-full size-3 bg-primary" />
                </span>
                <div>
                  <p className="text-sm font-bold leading-none">{t("land.hero.liveTitle")}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("land.hero.liveText")}
                  </p>
                </div>
              </CardContent>
            </Card>
            </motion.div>
          </motion.div>
        </motion.div>
      </section>

      {/* Cómo funciona — premium tilt-glass step cards + drawn paw timeline */}
      <section id="como-funciona" className="mx-auto max-w-6xl px-4 py-14 w-full overflow-x-clip">
        <h2 className="text-3xl font-black tracking-tight text-center">
          {t("land.nav.how")}
        </h2>
        <p className="text-center text-muted-foreground mt-2">
          {t("land.how.subtitle")}
        </p>
        <motion.div
          className="relative mt-8 grid sm:grid-cols-3 gap-4"
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
              transition={
                reduceMotion ? { duration: 0.01 } : { duration: 0.8, ease: EXPO, delay: 0.35 }
              }
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
              transition={
                reduceMotion ? { duration: 0.01 } : { duration: 0.8, ease: EXPO, delay: 0.35 }
              }
            />
          </svg>
          {/* Paw stops between the cards, popping as the line passes */}
          {[0, 1].map((n) => (
            <motion.span
              key={`paw-${n}`}
              aria-hidden
              className={`pointer-events-none absolute top-[42px] hidden -translate-x-1/2 sm:block ${
                n ? "left-2/3" : "left-1/3"
              }`}
              initial={{ opacity: 0, scale: 0, rotate: -16 }}
              whileInView={{ opacity: 1, scale: 1, rotate: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={
                reduceMotion ? { duration: 0.01 } : { ...springMomentum, delay: 0.75 + n * 0.2 }
              }
            >
              <PawPrint className="size-3.5 text-primary/45" />
            </motion.span>
          ))}
          {howSteps.map((s, i) => (
            <HowStepCard key={s.title} index={i} icon={s.icon} title={s.title} text={s.text} />
          ))}
        </motion.div>
      </section>

      {/* La manada — family photo wall */}
      <section id="manada" className="bg-brand-soft/50 border-y">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-3xl font-black tracking-tight text-center">
            {t("land.pack.title")}
          </h2>
          <p className="text-center text-muted-foreground mt-2 max-w-xl mx-auto">
            {t("land.pack.subtitle")}
          </p>
          <motion.div
          className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
          variants={staggerContainer(0.08)}
        >
            {[
              {
                src: "/images/pets/pack-row.jpg",
                alt: t("land.pack.p1.alt"),
                cap: t("land.pack.p1.cap"),
                rot: "-rotate-1",
              },
              {
                src: "/images/pets/pack-camp.jpg",
                alt: t("land.pack.p2.alt"),
                cap: t("land.pack.p2.cap"),
                rot: "rotate-1",
              },
              {
                src: "/images/pets/pack-leashes.jpg",
                alt: t("land.pack.p3.alt"),
                cap: t("land.pack.p3.cap"),
                rot: "-rotate-1",
              },
            ].map((p) => (
              <motion.figure
                key={p.src}
                variants={staggerItem}
                className={`rounded-2xl bg-card border border-border/70 p-2 pb-2.5 shadow-card transition-[transform,box-shadow] duration-300 ease-out-expo hover:rotate-0 hover:-translate-y-1 hover:shadow-raise ${p.rot}`}
              >
                <img
                  src={p.src}
                  alt={p.alt}
                  className="rounded-xl w-full aspect-[4/5] object-cover"
                />
                <figcaption className="text-xs font-bold text-center mt-2 text-muted-foreground leading-snug">
                  {p.cap}
                </figcaption>
              </motion.figure>
            ))}
            {/* CTA tile: join the pack */}
            <motion.div variants={staggerItem} className="relative overflow-hidden rounded-2xl firu-gloss bg-primary text-primary-foreground p-4 flex flex-col items-center justify-center text-center gap-2 shadow-raise">
              <PawPrint
                className="absolute -bottom-4 -right-4 size-24 opacity-15 rotate-12"
                aria-hidden
              />
              <p className="font-black text-lg leading-snug">
                {t("land.pack.ctaTitle")}
              </p>
              <p className="text-xs opacity-90">
                {t("land.pack.ctaText")}
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="rounded-full font-bold"
                onClick={() => setLoginOpen(true)}
              >
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
        <div className="relative mx-auto max-w-6xl px-4 py-14">
          <motion.div
            className="grid lg:grid-cols-2 gap-10 items-center"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-80px" }}
            variants={staggerContainer(0.1)}
          >
            <motion.div variants={fadeUp}>
              <h2 className="text-3xl font-black tracking-tight">
                {t("land.trust.title")}
              </h2>
              <p className="text-muted-foreground mt-3 leading-relaxed">
                {t("land.trust.intro")}
              </p>
              <motion.ul className="mt-6 space-y-4" variants={staggerContainer(0.09)}>
                {trustItems.map(([itemTitle, itemText], i) => (
                  <TrustItem key={itemTitle} index={i} title={itemTitle} text={itemText} />
                ))}
              </motion.ul>
            </motion.div>
            <motion.div
              className="relative grid grid-cols-2 gap-4"
              variants={staggerContainer(0.07)}
            >
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
      <section id="zonas" className="mx-auto max-w-6xl px-4 py-14 w-full">
        <h2 className="text-3xl font-black tracking-tight text-center">
          {t("land.zones.title")}
        </h2>
        <p className="text-center text-muted-foreground mt-2 max-w-xl mx-auto">
          {t("land.zones.subtitle", { city: config?.platform.city ?? "Santa Cruz" })}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {(zones ?? []).map((z) => (
            <span
              key={z.id}
              className="inline-flex items-center gap-1.5 rounded-full border bg-card px-4 py-2 text-sm font-bold"
            >
              <MapPin className="size-3.5 text-primary" />
              {z.name}
            </span>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-16 w-full">
        <div className="rounded-3xl firu-gloss bg-primary text-primary-foreground p-8 sm:p-12 text-center relative shadow-raise">
          <PawPrint className="absolute -top-6 -right-4 size-40 opacity-10 rotate-12" aria-hidden />
          <PawPrint className="absolute -bottom-10 -left-6 size-32 opacity-10 -rotate-12" aria-hidden />
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight">
            {t("land.final.title")}
          </h2>
          <p className="mt-3 opacity-90 max-w-xl mx-auto">
            {t("land.final.text")}
          </p>
          <p className="mt-1.5 text-sm opacity-80">
            {t("land.final.sub")}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button
              size="lg"
              variant="secondary"
              className="rounded-full text-base font-bold"
              onClick={() => setLoginOpen(true)}
            >
              {t("land.final.cta")}
            </Button>
            <a
              href={`https://wa.me/${supportWa.replace("+", "")}`}
              target="_blank"
              rel="noreferrer"
            >
              <Button
                size="lg"
                variant="outline"
                className="rounded-full text-base font-bold bg-transparent border-primary-foreground/40 text-primary-foreground hover:bg-primary-foreground/10"
              >
                <MessageCircle className="size-5" /> {t("land.final.whatsapp")}
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* Footer (sticky bottom) */}
      <footer className="mt-auto border-t bg-secondary/40 pb-safe">
        <div className="mx-auto max-w-6xl px-4 py-8 grid sm:grid-cols-3 gap-6 text-sm">
          <div>
            <img
              src="/images/brand/logo-wordmark.png"
              alt="FiruWalk"
              className="h-8 w-auto dark:hidden"
            />
            <img
              src="/images/brand/logo-wordmark-dark.png"
              alt="FiruWalk"
              className="h-8 w-auto hidden dark:block"
            />
            <p className="text-muted-foreground mt-3">
              {t("land.footer.about", { city: config?.platform.city ?? "Santa Cruz de la Sierra" })}
            </p>
          </div>
          <div>
            <p className="font-bold mb-2">{t("land.footer.support")}</p>
            <a
              className="inline-flex items-center gap-1.5 text-primary font-semibold hover:underline"
              href={`https://wa.me/${supportWa.replace("+", "")}`}
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle className="size-4" /> {t("land.footer.whatsapp", { phone: supportWa })}
            </a>
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
              {t("land.footer.demoNote")}
            </p>
          </div>
          <div>
            <p className="font-bold mb-2">{t("land.footer.company")}</p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              {t("land.footer.legal")}
            </p>
            <p className="text-muted-foreground mt-3 text-xs">
              {t("land.footer.copyright", { year: new Date().getFullYear() })}
            </p>
          </div>
        </div>
      </footer>

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

/** Mirrors --ease-out-expo from globals.css for per-property transitions. */
const EXPO: [number, number, number, number] = [0.23, 1, 0.32, 1];

/** Cursor tilt only makes sense with a precise pointer on a wide screen. */
function useFinePointer(): boolean {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px) and (pointer: fine)");
    const update = () => setFine(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return fine;
}

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
function StatValue({ num, suffix, text }: { num?: number; suffix?: string; text?: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const count = useMotionValue(num ?? 0);
  const rounded = useTransform(count, (v) => `${Math.round(v)}`);
  useEffect(() => {
    if (!inView || reduce || num === undefined) return;
    count.set(0);
    const controls = animate(count, num, { duration: 0.9, ease: EXPO });
    return () => controls.stop();
  }, [inView, reduce, num, count]);
  if (text !== undefined) return <span>{text}</span>;
  return (
    <span ref={ref}>
      <motion.span>{rounded}</motion.span>
      {suffix}
    </span>
  );
}

function TrustStatCard({
  index,
  icon: Icon,
  num,
  suffix,
  text,
  label,
}: {
  index: number;
  icon: LucideIcon;
  num?: number;
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
            <StatValue num={num} suffix={suffix} text={text} />
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
  const { data: accounts } = useQuery({
    queryKey: qk.demoAccounts,
    queryFn: () => api.get<DemoAccountDTO[]>("/api/auth/demo-accounts"),
    enabled: open,
  });

  const loginMut = useMutation({
    mutationFn: () =>
      api.post<LoginResponse>("/api/auth/login", { phone, code }),
    onSuccess: (res) => {
      login(res.user);
      onOpenChange(false);
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
    },
    onError: (e: Error) =>
      toast({ title: t("land.login.errorTitle"), description: srvErr(e.message), variant: "destructive" }),
  });

  const owners = (accounts ?? []).filter((a) => a.role === "OWNER");
  const walkers = (accounts ?? []).filter((a) => a.role === "WALKER");
  const admins = (accounts ?? []).filter((a) => a.role === "ADMIN");

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
            {t("land.login.desc")} {t("land.login.demoCode")}{" "}
            <code className="font-bold text-foreground">123456</code>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {[
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
                      className="flex items-center gap-3 rounded-2xl border p-2.5 text-left hover:border-primary/50 hover:bg-brand-soft/50 transition-colors"
                      onClick={() => {
                        setPhone(a.phone);
                        setCode("123456");
                        loginMut.mutate();
                      }}
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

          <div className="border-t pt-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">
              {t("land.login.phoneSection")}
            </p>
            <div className="grid gap-3">
              <div>
                <Label htmlFor="login-phone" className="text-sm">{t("land.login.phoneLabel")}</Label>
                <Input
                  id="login-phone"
                  placeholder={t("land.phoneFormat")}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  inputMode="tel"
                />
              </div>
              <div>
                <Label htmlFor="login-code" className="text-sm">{t("land.login.codeLabel")}</Label>
                <Input
                  id="login-code"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                />
              </div>
              <Button
                className="rounded-full font-bold"
                disabled={loginMut.isPending || !phone || !code}
                onClick={() => loginMut.mutate()}
              >
                {loginMut.isPending && <Loader2 className="size-4 animate-spin" />}
                {t("land.cta.login")}
              </Button>
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
