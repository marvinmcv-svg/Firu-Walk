"use client";

// "This is what peace of mind looks like" — a phone that tilts upright as
// you scroll and plays back a real walk report: the route draws itself, the
// stats count up, photos slide in, the pee/poop/water chips pop.

import { useEffect, useRef } from "react";
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useScroll,
  useTransform,
} from "framer-motion";
import { BadgeCheck, Camera, MapPinned, NotebookPen } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useT } from "@/lib/firu/i18n";
import { springMomentum } from "@/lib/firu/motion";
import { EXPO, Reveal, SectionHeading, useCalmMotion } from "./primitives";

const ROUTE =
  "M 30 170 C 60 150, 50 120, 85 110 S 140 120, 150 90 S 120 40, 170 35 S 240 60, 250 30";

export function ReportShowcase() {
  const { t } = useT();
  const reduce = useCalmMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ["start end", "center center"] });
  const rotateX = useTransform(scrollYProgress, [0, 1], [18, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.9, 1]);
  const y = useTransform(scrollYProgress, [0, 1], [60, 0]);

  const bullets: { icon: LucideIcon; title: string; text: string }[] = [
    { icon: MapPinned, title: t("land.report.b1.title"), text: t("land.report.b1.text") },
    { icon: Camera, title: t("land.report.b2.title"), text: t("land.report.b2.text") },
    { icon: NotebookPen, title: t("land.report.b3.title"), text: t("land.report.b3.text") },
  ];

  return (
    <section
      ref={sectionRef}
      id="reporte"
      className="relative overflow-x-clip border-y bg-gradient-to-b from-secondary/70 to-background"
    >
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 size-[40rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-soft/60 blur-3xl" />
      <div className="relative mx-auto max-w-6xl px-4 py-20 sm:py-28 grid lg:grid-cols-2 gap-14 items-center">
        <div>
          <SectionHeading
            align="left"
            eyebrow={t("land.report.eyebrow")}
            title={t("land.report.title")}
            subtitle={t("land.report.subtitle")}
          />
          <ul className="mt-8 space-y-5">
            {bullets.map((b, i) => (
              <Reveal as="li" key={b.title} delay={0.1 + i * 0.1} className="flex gap-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-card border border-border/70 text-primary shadow-card">
                  <b.icon className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="font-extrabold">{b.title}</p>
                  <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{b.text}</p>
                </div>
              </Reveal>
            ))}
          </ul>
        </div>

        <div className="[perspective:1400px] flex justify-center">
          <motion.div
            style={reduce ? undefined : { rotateX, scale, y }}
            className="relative w-[18.5rem] sm:w-[20rem] origin-bottom"
          >
            <PhoneReport />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function Count({ to, decimals = 0, run }: { to: number; decimals?: number; run: boolean }) {
  const reduce = useCalmMotion();
  const { lang } = useT();
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) =>
    v.toLocaleString(lang === "en" ? "en-US" : "es-BO", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  );
  useEffect(() => {
    if (reduce) {
      mv.set(to);
      return;
    }
    if (!run) return;
    const c = animate(mv, to, { duration: 1.6, ease: EXPO, delay: 0.6 });
    return () => c.stop();
  }, [run, reduce, to, mv]);
  return <motion.span>{text}</motion.span>;
}

function PhoneReport() {
  const { t } = useT();
  const reduce = useCalmMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-120px" });
  const show = inView || !!reduce;

  const pop = (d: number) => ({
    initial: { opacity: 0, scale: 0.6, y: 6 },
    animate: show ? { opacity: 1, scale: 1, y: 0 } : undefined,
    transition: { ...springMomentum, delay: reduce ? 0 : d },
  });

  return (
    <div ref={ref} className="relative rounded-[2.9rem] bg-foreground/90 dark:bg-black p-2.5 shadow-[0_30px_80px_-20px_rgb(24_30_26/0.45)]">
      <div className="relative overflow-hidden rounded-[2.35rem] bg-background">
        {/* Dynamic island */}
        <div aria-hidden className="absolute left-1/2 top-2.5 z-20 h-6 w-24 -translate-x-1/2 rounded-full bg-black" />

        <div className="px-4 pt-11 pb-5">
          {/* Header */}
          <div className="flex items-center gap-3">
            <img src="/images/dogs/dog-1.png" alt="" className="size-10 rounded-full object-cover ring-2 ring-primary/30" />
            <div className="min-w-0">
              <p className="text-sm font-black leading-none">{t("land.report.cardTitle")}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{t("land.report.cardWhen")}</p>
            </div>
            <span className="ml-auto rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-extrabold text-primary">GPS ✓</span>
          </div>

          {/* Map */}
          <div className="relative mt-3 overflow-hidden rounded-2xl border bg-[oklch(0.95_0.03_150)] dark:bg-[oklch(0.27_0.03_155)]">
            <svg viewBox="0 0 280 200" className="block w-full" aria-hidden>
              {/* streets */}
              <g className="stroke-white/90 dark:stroke-white/10" strokeWidth="7" fill="none">
                <path d="M0 60 H280" />
                <path d="M0 140 H280" />
                <path d="M70 0 V200" />
                <path d="M200 0 V200" />
              </g>
              <rect x="215" y="150" width="50" height="40" rx="8" className="fill-[oklch(0.88_0.08_150)] dark:fill-[oklch(0.33_0.06_152)]" />
              <rect x="90" y="75" width="90" height="50" rx="10" className="fill-[oklch(0.88_0.08_150)] dark:fill-[oklch(0.33_0.06_152)]" />
              <path d={ROUTE} fill="none" strokeWidth="5" strokeLinecap="round" className="stroke-primary/15" />
              <motion.path
                d={ROUTE}
                fill="none"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="stroke-primary"
                initial={{ pathLength: reduce ? 1 : 0 }}
                animate={show ? { pathLength: 1 } : undefined}
                transition={{ duration: reduce ? 0 : 2.2, ease: [0.65, 0, 0.35, 1], delay: 0.3 }}
              />
              <circle cx="30" cy="170" r="7" className="fill-card stroke-primary" strokeWidth="3" />
              <motion.g {...pop(2.4)} style={{ transformOrigin: "250px 30px" }}>
                <circle cx="250" cy="30" r="9" className="fill-primary" />
                <circle cx="250" cy="30" r="3.5" className="fill-card" />
              </motion.g>
            </svg>
          </div>

          {/* Stats */}
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {[
              { v: <Count to={2.4} decimals={1} run={show} />, l: t("land.report.km") },
              { v: <Count to={42} run={show} />, l: t("land.report.min") },
              { v: <Count to={3} run={show} />, l: t("land.report.photos") },
            ].map((s, i) => (
              <div key={i} className="rounded-xl bg-secondary/80 py-2">
                <p className="text-lg font-black tabular-nums leading-none">{s.v}</p>
                <p className="text-[10px] font-bold text-muted-foreground mt-1 uppercase tracking-wide">{s.l}</p>
              </div>
            ))}
          </div>

          {/* Photos */}
          <div className="mt-3 grid grid-cols-3 gap-2">
            {["/images/walks/walk-1.png", "/images/walks/walk-2.png", "/images/dogs/dog-1.png"].map((src, i) => (
              <motion.img
                key={src}
                src={src}
                alt=""
                className="aspect-square w-full rounded-xl object-cover"
                initial={{ opacity: 0, x: 24, scale: 0.9 }}
                animate={show ? { opacity: 1, x: 0, scale: 1 } : undefined}
                transition={{ duration: reduce ? 0 : 0.7, ease: EXPO, delay: reduce ? 0 : 1 + i * 0.12 }}
              />
            ))}
          </div>

          {/* Chips */}
          <div className="mt-3 flex gap-1.5">
            {[
              { e: "💧", l: t("land.report.pee") },
              { e: "💩", l: t("land.report.poop") },
              { e: "🥣", l: t("land.report.water") },
            ].map((c, i) => (
              <motion.span
                key={c.l}
                {...pop(1.6 + i * 0.1)}
                className="inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-[11px] font-extrabold"
              >
                {c.e} {c.l} <span className="text-primary">✓</span>
              </motion.span>
            ))}
          </div>

          {/* Walker note */}
          <motion.div
            className="mt-3 flex items-start gap-2"
            initial={{ opacity: 0, y: 12 }}
            animate={show ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: reduce ? 0 : 0.6, ease: EXPO, delay: reduce ? 0 : 2 }}
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-black text-primary-foreground">L</span>
            <div className="rounded-2xl rounded-tl-md bg-secondary px-3 py-2">
              <p className="text-[12px] font-semibold leading-snug">{t("land.report.note")}</p>
              <p className="mt-1 flex items-center gap-1 text-[10px] font-bold text-muted-foreground">
                <BadgeCheck className="size-3 text-primary" aria-hidden /> {t("land.report.walker")}
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
