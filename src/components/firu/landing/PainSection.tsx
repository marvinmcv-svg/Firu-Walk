"use client";

// Pain → promise. Each card names the owner's worry, strikes it through as
// it scrolls in, then lands the FiruWalk answer. Empathy before features.

import { motion, type Variants } from "framer-motion";
import { Check, Clock3, Eye, UserRoundCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useT } from "@/lib/firu/i18n";
import { springMomentum } from "@/lib/firu/motion";
import { EXPO, SectionHeading, useCalmMotion } from "./primitives";

const card: Variants = {
  hidden: { opacity: 0, y: 30, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.7, ease: EXPO } },
};

export function PainSection() {
  const { t } = useT();
  const items: { icon: LucideIcon; pain: string; fix: string }[] = [
    { icon: Clock3, pain: t("land.pain.p1.pain"), fix: t("land.pain.p1.fix") },
    { icon: UserRoundCheck, pain: t("land.pain.p2.pain"), fix: t("land.pain.p2.fix") },
    { icon: Eye, pain: t("land.pain.p3.pain"), fix: t("land.pain.p3.fix") },
  ];
  return (
    <section id="por-que" className="relative mx-auto max-w-6xl px-4 py-20 sm:py-24 w-full">
      <SectionHeading
        eyebrow={t("land.pain.eyebrow")}
        title={t("land.pain.title")}
        subtitle={t("land.pain.subtitle")}
      />
      <motion.div
        className="mt-12 grid md:grid-cols-3 gap-4 sm:gap-5"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-80px" }}
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.14 } } }}
      >
        {items.map((it, i) => (
          <PainCard key={it.pain} index={i} {...it} />
        ))}
      </motion.div>
    </section>
  );
}

function PainCard({
  index,
  icon: Icon,
  pain,
  fix,
}: {
  index: number;
  icon: LucideIcon;
  pain: string;
  fix: string;
}) {
  const reduce = useCalmMotion();
  const base = 0.35 + index * 0.14;
  return (
    <motion.article
      variants={card}
      className="group relative overflow-hidden rounded-3xl border border-border/70 bg-card p-6 shadow-card transition-[box-shadow,transform] duration-300 ease-out-expo hover:-translate-y-1 hover:shadow-raise"
    >
      <span aria-hidden className="pointer-events-none absolute -right-12 -top-12 size-36 rounded-full bg-brand-soft/70 blur-2xl transition-transform duration-500 ease-out-expo group-hover:scale-125" />
      <span className="relative grid size-11 place-items-center rounded-2xl bg-secondary text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </span>

      {/* The worry, struck through — background strike wraps line by line */}
      <p className="relative mt-5 text-base font-bold text-muted-foreground">
        <motion.span
          className="[box-decoration-break:clone] [-webkit-box-decoration-break:clone] bg-no-repeat"
          style={{
            backgroundImage:
              "linear-gradient(color-mix(in oklab, var(--destructive) 65%, transparent), color-mix(in oklab, var(--destructive) 65%, transparent))",
            backgroundPosition: "0 58%",
          }}
          variants={{
            hidden: { backgroundSize: "0% 2px" },
            show: {
              backgroundSize: "100% 2px",
              transition: { duration: reduce ? 0 : 0.7, ease: EXPO, delay: base },
            },
          }}
        >
          “{pain}”
        </motion.span>
      </p>

      {/* The answer */}
      <motion.div
        className="relative mt-4 flex gap-3"
        variants={{
          hidden: { opacity: 0, y: 10 },
          show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EXPO, delay: base + 0.35 } },
        }}
      >
        <motion.span
          className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-card"
          variants={{
            hidden: { scale: 0.4, rotate: -30 },
            show: { scale: 1, rotate: 0, transition: { ...springMomentum, delay: base + 0.4 } },
          }}
        >
          <Check className="size-3.5" strokeWidth={3} aria-hidden />
        </motion.span>
        <p className="text-[15px] font-semibold leading-relaxed text-foreground">{fix}</p>
      </motion.div>
    </motion.article>
  );
}
