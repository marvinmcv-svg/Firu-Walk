"use client";

// Landing motion primitives — the shared vocabulary every section speaks.
// Rules (Apple / Emil Kowalski): springs for things the user moves, expo
// ease-out for things that enter; nothing starts at scale(0); every loop
// and parallax collapses under prefers-reduced-motion.

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  motion,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
  type Variants,
} from "framer-motion";
import { cn } from "@/lib/utils";

/** Mirrors --ease-out-expo from globals.css. */
export const EXPO: [number, number, number, number] = [0.23, 1, 0.32, 1];

const RM_QUERY = "(prefers-reduced-motion: reduce)";
/**
 * Hydration-safe prefers-reduced-motion. framer's useReducedMotion reads the
 * media query during the first client render, so SSR (false) and hydration
 * (true) disagree on initial styles. This reports false for the server render
 * AND hydration, then the real value — so markup always matches.
 */
export function useCalmMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(RM_QUERY);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(RM_QUERY).matches,
    () => false
  );
}

/** Cursor-driven effects only make sense with a precise pointer on a wide screen. */
export function useFinePointer(): boolean {
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

/** Rise + un-blur as the block scrolls into view (once). */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 22,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  as?: "div" | "li" | "section";
}) {
  const reduce = useCalmMotion();
  const Comp = motion[as];
  return (
    <Comp
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y, filter: "blur(8px)" }}
      whileInView={reduce ? { opacity: 1 } : { opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-70px" }}
      transition={{ duration: reduce ? 0.2 : 0.75, ease: EXPO, delay }}
    >
      {children}
    </Comp>
  );
}

const wordParent = (stagger: number, delay: number): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger, delayChildren: delay } },
});
const wordChild: Variants = {
  hidden: { y: "110%", opacity: 0, rotate: 4 },
  show: { y: "0%", opacity: 1, rotate: 0, transition: { duration: 0.8, ease: EXPO } },
};

/**
 * Masked word-by-word reveal (Apple keynote title). Text stays real text
 * (spaces are text nodes) so screen readers and tests read it unchanged.
 */
export function WordsReveal({
  text,
  className,
  wordClassName,
  stagger = 0.06,
  delay = 0,
  inView = false,
}: {
  text: string;
  className?: string;
  wordClassName?: string;
  stagger?: number;
  delay?: number;
  /** true → trigger on scroll-into-view; false → on mount */
  inView?: boolean;
}) {
  const reduce = useCalmMotion();
  const words = text.split(" ");
  if (reduce) return <span className={className}>{text}</span>;
  const trigger = inView
    ? { whileInView: "show", viewport: { once: true, margin: "-60px" } }
    : { animate: "show" };
  return (
    <motion.span
      className={className}
      initial="hidden"
      variants={wordParent(stagger, delay)}
      {...trigger}
    >
      {words.map((w, i) => (
        <span key={`${w}-${i}`}>
          <span className="inline-block overflow-hidden pb-[0.12em] -mb-[0.12em] align-bottom">
            <motion.span variants={wordChild} className={cn("inline-block origin-bottom-left", wordClassName)}>
              {w}
            </motion.span>
          </span>
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </motion.span>
  );
}

/** Eyebrow + title + subtitle, revealed as one choreographed unit. */
export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = "center",
  className,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  align?: "center" | "left";
  className?: string;
}) {
  return (
    <div className={cn(align === "center" ? "text-center mx-auto" : "", "max-w-2xl", className)}>
      {eyebrow && (
        <Reveal y={10}>
          <span className="inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.18em] text-primary">
            <span aria-hidden className="h-px w-6 bg-primary/50" />
            {eyebrow}
            {align === "center" && <span aria-hidden className="h-px w-6 bg-primary/50" />}
          </span>
        </Reveal>
      )}
      <h2 className="mt-3 text-3xl sm:text-4xl lg:text-[2.75rem] font-black tracking-tight leading-[1.08] text-balance">
        <WordsReveal text={title} inView stagger={0.045} />
      </h2>
      {subtitle && (
        <Reveal delay={0.15} y={12}>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed text-pretty">
            {subtitle}
          </p>
        </Reveal>
      )}
    </div>
  );
}

/** Infinite, pause-on-hover marquee (pure CSS transform — compositor only). */
export function Marquee({ items, className }: { items: ReactNode[]; className?: string }) {
  const row = (hidden: boolean) => (
    <ul
      aria-hidden={hidden || undefined}
      className="flex shrink-0 items-center gap-3 pr-3 firu-marquee-track"
    >
      {items.map((it, i) => (
        <li key={i} className="shrink-0">
          {it}
        </li>
      ))}
    </ul>
  );
  return (
    <div
      className={cn(
        "group relative flex overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]",
        className
      )}
    >
      {row(false)}
      {row(true)}
    </div>
  );
}

/** Hairline reading-progress bar (sits at the bottom edge of the header). */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 220, damping: 32, mass: 0.4 });
  return (
    <motion.div
      aria-hidden
      className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-gradient-to-r from-primary via-primary to-sun"
      style={{ scaleX }}
    />
  );
}

/** Pulls its child a few px toward the cursor — tactile primary CTAs. */
export function Magnetic({
  children,
  strength = 0.25,
  className,
}: {
  children: ReactNode;
  strength?: number;
  className?: string;
}) {
  const fine = useFinePointer();
  const reduce = useCalmMotion();
  const active = fine && !reduce;
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 300, damping: 20, mass: 0.5 });
  const sy = useSpring(y, { stiffness: 300, damping: 20, mass: 0.5 });
  return (
    <motion.div
      className={cn("inline-flex", className)}
      style={active ? { x: sx, y: sy } : undefined}
      onPointerMove={
        active
          ? (e) => {
              const r = e.currentTarget.getBoundingClientRect();
              x.set((e.clientX - r.left - r.width / 2) * strength);
              y.set((e.clientY - r.top - r.height / 2) * strength);
            }
          : undefined
      }
      onPointerLeave={
        active
          ? () => {
              x.set(0);
              y.set(0);
            }
          : undefined
      }
    >
      {children}
    </motion.div>
  );
}

/** Scroll-linked parallax offset for decorative layers. */
export function Parallax({
  children,
  className,
  distance = 60,
}: {
  children: ReactNode;
  className?: string;
  distance?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useCalmMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [distance, -distance]);
  return (
    <motion.div ref={ref} className={className} style={reduce ? undefined : { y }}>
      {children}
    </motion.div>
  );
}

/** Smoothly scroll to a section id, honouring reduced motion. */
export function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const top = el.getBoundingClientRect().top + window.scrollY - 72;
  window.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
}

/** WhatsApp glyph (channel indicator — lucide has no brand icons). */
export function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.5h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.08.15.2 2.1 3.2 5.08 4.48.71.31 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.75-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35zM12.04 21.5h-.01a9.45 9.45 0 0 1-4.82-1.32l-.35-.2-3.58.94.96-3.49-.23-.36a9.43 9.43 0 0 1-1.45-5.03c0-5.22 4.25-9.46 9.48-9.46 2.53 0 4.9.99 6.7 2.78a9.4 9.4 0 0 1 2.77 6.7c0 5.22-4.25 9.46-9.47 9.46zm8.06-17.52A11.32 11.32 0 0 0 12.04.63C5.77.63.66 5.73.66 12c0 2 .52 3.96 1.52 5.69L.57 23.6l6.05-1.59a11.4 11.4 0 0 0 5.42 1.38h.01c6.27 0 11.38-5.1 11.38-11.37 0-3.04-1.18-5.9-3.33-8.04z" />
    </svg>
  );
}
