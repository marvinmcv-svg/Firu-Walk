"use client";

// Hero — the promise in one breath. Masked headline reveal, parallax photo
// stack, a live-walk card drawing its own GPS route, and a rotating stack of
// the notifications an owner actually receives during a walk.

import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useScroll,
  useTransform,
} from "framer-motion";
import { ArrowDown, ChevronRight, PawPrint, QrCode, ShieldCheck, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/firu/i18n";
import { springMomentum } from "@/lib/firu/motion";
import { EXPO, Magnetic, WordsReveal, useCalmMotion } from "./primitives";

export function Hero({
  city,
  cancelHours,
  onPrimary,
  onSecondary,
}: {
  city: string;
  cancelHours: number;
  onPrimary: () => void;
  onSecondary: () => void;
}) {
  const { t } = useT();
  const reduce = useCalmMotion();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  // Photo sinks slower than the page; copy drifts up and fades — depth.
  const photoY = useTransform(scrollYProgress, [0, 1], [0, 90]);
  const photoScale = useTransform(scrollYProgress, [0, 1], [1, 1.06]);
  const copyY = useTransform(scrollYProgress, [0, 1], [0, -50]);
  const copyOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0.2]);

  const enter = (delay: number) => ({
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 18, filter: "blur(6px)" },
    animate: reduce ? { opacity: 1 } : { opacity: 1, y: 0, filter: "blur(0px)" },
    transition: { duration: 0.8, ease: EXPO, delay },
  });

  return (
    <section ref={ref} className="relative overflow-x-clip">
      {/* Ambient light — slow drifting brand glows over the paw grid */}
      <div aria-hidden className="pointer-events-none absolute inset-0 firu-paw-pattern [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
      <div aria-hidden className="pointer-events-none absolute -top-40 -left-32 size-[34rem] rounded-full bg-brand-soft blur-3xl opacity-70 firu-drift" />
      <div aria-hidden className="pointer-events-none absolute top-20 -right-40 size-[30rem] rounded-full bg-sun-soft blur-3xl opacity-70 firu-drift [animation-delay:-7s]" />

      <div className="relative mx-auto max-w-6xl px-4 pt-10 pb-16 lg:pt-16 lg:pb-24 grid lg:grid-cols-[1.05fr_1fr] gap-12 items-center">
        <motion.div style={reduce ? undefined : { y: copyY, opacity: copyOpacity }}>
          <motion.span
            {...enter(0)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/80 px-3 py-1 text-xs font-extrabold text-primary shadow-card backdrop-blur"
          >
            <PawPrint className="size-3.5" aria-hidden />
            {t("land.hero.badge")}
          </motion.span>

          <h1 className="mt-4 text-[2.5rem] sm:text-6xl lg:text-[3.6rem] xl:text-[3.9rem] font-black leading-[1.02] tracking-[-0.035em] text-balance">
            <WordsReveal text={t("land.hero.titleLead")} delay={0.1} />{" "}
            <span className="block mt-1 lg:whitespace-nowrap">
              <WordsReveal
                text={t("land.hero.titleTail")}
                delay={0.35}
                wordClassName="bg-gradient-to-br from-primary to-[color-mix(in_oklab,var(--primary)_70%,var(--sun))] bg-clip-text text-transparent"
              />
            </span>
          </h1>

          <motion.p {...enter(0.55)} className="mt-5 text-lg sm:text-xl text-muted-foreground max-w-xl leading-relaxed text-pretty">
            {t("land.hero.bodyLead")} <strong className="text-foreground">{city}</strong>
            {t("land.hero.bodyTail")}
          </motion.p>

          <motion.div {...enter(0.7)} className="mt-7 flex flex-wrap items-center gap-3">
            <Magnetic>
              <Button
                size="lg"
                className="firu-btn-gloss firu-shine rounded-full h-13 px-7 text-base font-extrabold"
                onClick={onPrimary}
              >
                {t("land.hero.ctaPrimary")}
                <ChevronRight className="size-5" />
              </Button>
            </Magnetic>
            <Button
              size="lg"
              variant="ghost"
              className="rounded-full h-13 px-5 text-base font-bold text-muted-foreground hover:text-foreground"
              onClick={onSecondary}
            >
              {t("land.hero.ctaSecondary")}
              <ArrowDown className="size-4" />
            </Button>
          </motion.div>
          <motion.p {...enter(0.8)} className="mt-3 text-xs font-semibold text-muted-foreground">
            {t("land.hero.micro", { h: cancelHours })}
          </motion.p>

          <motion.div
            className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold text-muted-foreground"
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.9 } } }}
          >
            {[
              { icon: <ShieldCheck className="size-4 text-primary" />, text: t("land.hero.trustVerified") },
              { icon: <Star className="size-4 fill-sun text-sun" />, text: t("land.hero.trustRating") },
              { icon: <QrCode className="size-4 text-primary" />, text: t("land.hero.trustQr") },
            ].map((b) => (
              <motion.span
                key={b.text}
                variants={{
                  hidden: { opacity: 0, y: 8 },
                  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EXPO } },
                }}
                className="inline-flex items-center gap-1.5"
              >
                {b.icon} {b.text}
              </motion.span>
            ))}
          </motion.div>
        </motion.div>

        {/* Photo stack */}
        <motion.div
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 40, scale: 0.94, rotate: -2 }}
          animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
          transition={{ duration: 1.1, ease: EXPO, delay: 0.2 }}
          className="relative mx-auto w-full max-w-md lg:max-w-none"
        >
          <div className="absolute -top-4 -left-4 size-24 rounded-3xl bg-sun-soft rotate-12 firu-bob" aria-hidden />
          <div className="absolute -bottom-4 -right-4 size-28 rounded-3xl bg-brand-soft -rotate-6 firu-bob [animation-delay:-2s]" aria-hidden />
          <div className="relative overflow-hidden rounded-[2rem] border shadow-float">
            <motion.img
              src="/images/pets/pack-walker.jpg"
              alt={t("land.hero.photoAlt")}
              className="w-full object-cover aspect-[4/5] will-change-transform"
              style={reduce ? undefined : { y: photoY, scale: photoScale }}
            />
            <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent" />
          </div>

          {/* Polaroid */}
          <motion.figure
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -20, rotate: 18 }}
            animate={{ opacity: 1, y: 0, rotate: 6 }}
            whileHover={{ scale: 1.06, rotate: 2 }}
            transition={{ ...springMomentum, delay: 0.7 }}
            className="absolute -top-5 -right-2 sm:-right-5 w-24 sm:w-32 rounded-xl bg-card border border-border/70 p-1.5 shadow-raise"
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

          <NotificationStack />
          <LiveWalkCard />
        </motion.div>
      </div>
    </section>
  );
}

/** Glass card with a pulsing dot and a GPS route that keeps drawing itself. */
function LiveWalkCard() {
  const { t } = useT();
  const reduce = useCalmMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...springMomentum, delay: 0.9 }}
      className="absolute -bottom-7 left-3 sm:left-6 right-16 sm:right-auto"
    >
      <div className="firu-frost rounded-2xl border border-white/40 dark:border-white/10 shadow-float p-3 flex items-center gap-3">
        <div className="relative shrink-0 grid size-12 place-items-center rounded-xl bg-brand-soft overflow-hidden">
          <svg viewBox="0 0 48 48" className="absolute inset-0 size-full" aria-hidden>
            <path d="M6 40 C 14 30, 10 22, 20 20 S 34 14, 30 8" fill="none" strokeWidth="2.5" strokeLinecap="round" className="stroke-primary/20" />
            <motion.path
              d="M6 40 C 14 30, 10 22, 20 20 S 34 14, 30 8"
              fill="none"
              strokeWidth="2.5"
              strokeLinecap="round"
              className="stroke-primary"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={
                reduce
                  ? { duration: 0 }
                  : { duration: 3.2, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.8, delay: 1.2 }
              }
            />
          </svg>
          <span className="relative flex size-3">
            <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full size-3 bg-primary ring-2 ring-card" />
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-extrabold leading-none">{t("land.hero.liveTitle")}</p>
          <p className="text-xs text-muted-foreground mt-1 truncate">{t("land.hero.liveText")}</p>
        </div>
      </div>
    </motion.div>
  );
}

/** iOS-style notification banners cycling in over the photo. */
function NotificationStack() {
  const { t } = useT();
  const reduce = useCalmMotion();
  const items = [t("land.hero.toast1"), t("land.hero.toast2"), t("land.hero.toast3")];
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setI((n) => (n + 1) % 3), 2800);
    return () => clearInterval(id);
  }, [reduce]);

  return (
    <div className="absolute top-8 -left-3 sm:-left-10 w-[15.5rem] h-16 pointer-events-none" aria-hidden>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={i}
          initial={{ opacity: 0, y: -18, scale: 0.92, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: 10, scale: 0.94, filter: "blur(4px)" }}
          transition={{ type: "spring", duration: 0.6, bounce: 0.2 }}
          className="absolute inset-x-0 top-0 firu-frost rounded-2xl border border-white/50 dark:border-white/10 shadow-raise px-3 py-2.5 flex items-center gap-2.5"
        >
          <img src="/images/brand/logo-mark-mint.png" alt="" className="size-8 rounded-lg" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold text-muted-foreground leading-none flex justify-between">
              FiruWalk <span className="font-semibold">{t("land.hero.toastAgo")}</span>
            </p>
            <p className="text-[13px] font-extrabold leading-tight mt-1 truncate">{items[i]}</p>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
