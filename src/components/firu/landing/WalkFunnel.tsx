"use client";

// The sales funnel: "Plan {dog}'s first walk". The owner fills a short,
// tappable form and watches a WhatsApp message compose itself live on a
// phone — changed lines flash, a typing indicator flickers, the price
// estimate springs to the new total. One tap hands the finished message to
// WhatsApp (wa.me deep link), so the lead arrives qualified and pre-written.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useAnimationControls,
  useMotionValue,
  useTransform,
} from "framer-motion";
import { CheckCheck, ChevronRight, Lock, MapPin, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/firu/i18n";
import { formatBOBShort } from "@/lib/firu/money";
import { springSnappy } from "@/lib/firu/motion";
import { cn } from "@/lib/utils";
import { EXPO, Magnetic, Reveal, WhatsAppIcon, useCalmMotion } from "./primitives";

type Size = "s" | "m" | "l";
type Freq = "trial" | "2" | "3" | "5";
type Slot = "am" | "mid" | "pm";
type Duration = 30 | 45 | 60;

const WALKS_PER_WEEK: Record<Freq, number> = { trial: 1, "2": 2, "3": 3, "5": 5 };
const WEEKS_PER_MONTH = 4.33;

export function WalkFunnel({
  zones,
  pricing,
  supportWa,
  onApp,
}: {
  zones: string[];
  pricing: { 30: number; 45: number; 60: number } | null;
  supportWa: string;
  onApp: () => void;
}) {
  const { t } = useT();
  const reduce = useCalmMotion();
  const [name, setName] = useState("");
  const [dog, setDog] = useState("");
  const [size, setSize] = useState<Size | null>(null);
  const [zone, setZone] = useState<string | null>(null);
  const [freq, setFreq] = useState<Freq | null>(null);
  const [duration, setDuration] = useState<Duration>(30);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [notes, setNotes] = useState("");
  const [nudge, setNudge] = useState(false);
  const shake = useAnimationControls();
  const nameRef = useRef<HTMLInputElement>(null);
  const dogRef = useRef<HTMLInputElement>(null);

  const sizeLabel = size ? t(`land.funnel.size.${size}`) : "";
  const freqLabel = freq ? t(`land.funnel.freq.${freq}`) : "";
  const slotLabel = slot ? t(`land.funnel.slot.${slot}`) : "";
  const dash = "…";

  const lines: { k: string; label: string; value: string }[] = [
    { k: "name", label: t("land.funnel.msg.name"), value: name.trim() || dash },
    {
      k: "dog",
      label: t("land.funnel.msg.dog"),
      value: (dog.trim() || dash) + (sizeLabel ? ` (${sizeLabel})` : ""),
    },
    { k: "zone", label: t("land.funnel.msg.zone"), value: zone ?? dash },
    { k: "freq", label: t("land.funnel.msg.freq"), value: freqLabel || dash },
    { k: "duration", label: t("land.funnel.msg.duration"), value: `${duration} min` },
    { k: "slot", label: t("land.funnel.msg.slot"), value: slotLabel || dash },
    { k: "notes", label: t("land.funnel.msg.notes"), value: notes.trim() || "—" },
  ];

  const message = [
    t("land.funnel.msg.hello"),
    "",
    ...lines.map((l) => `${l.label}: ${l.value}`),
    "",
    t("land.funnel.msg.bye"),
  ].join("\n");

  const waHref = `https://wa.me/${supportWa.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;

  const filled = [name.trim(), dog.trim(), size, zone, freq, slot].filter(Boolean).length + 1;
  const pct = Math.round((filled / 7) * 100);
  const ready = !!name.trim() && !!dog.trim();

  const perWalk = pricing ? pricing[duration] : null;
  const monthly =
    perWalk && freq && freq !== "trial"
      ? Math.round((perWalk * WALKS_PER_WEEK[freq] * WEEKS_PER_MONTH) / 100) * 100
      : null;

  // "typing…" flicker whenever the owner edits a field
  const [typing, setTyping] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
  }, []);
  const ping = () => {
    if (reduce) return;
    setTyping(true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), 650);
  };
  /** Wrap a setter so every edit also pings the typing indicator. */
  const edit =
    <V,>(set: (v: V) => void) =>
    (v: V) => {
      set(v);
      ping();
    };
  const showNudge = nudge && !ready;

  const onSend = (e: React.MouseEvent) => {
    if (ready) return;
    e.preventDefault();
    setNudge(true);
    if (!reduce) shake.start({ x: [0, -10, 9, -6, 4, 0], transition: { duration: 0.45 } });
    (name.trim() ? dogRef : nameRef).current?.focus();
  };

  const dogName = dog.trim() || t("land.funnel.dogFallback");

  return (
    <section id="reservar" className="relative overflow-x-clip">
      <div aria-hidden className="pointer-events-none absolute -top-24 right-0 size-[36rem] rounded-full bg-brand-soft/70 blur-3xl firu-drift" />
      <div aria-hidden className="pointer-events-none absolute bottom-0 -left-40 size-[28rem] rounded-full bg-sun-soft/60 blur-3xl firu-drift [animation-delay:-9s]" />

      <div className="relative mx-auto max-w-6xl px-4 py-20 sm:py-28">
        <div className="text-center max-w-2xl mx-auto">
          <Reveal y={10}>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-extrabold uppercase tracking-[0.14em] text-primary">
              <Sparkles className="size-3.5" aria-hidden /> {t("land.funnel.eyebrow")}
            </span>
          </Reveal>
          <Reveal delay={0.05}>
            <h2 className="mt-4 text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight leading-[1.06] text-balance">
              <AnimatedTitle template={t("land.funnel.title", { dog: "\u0000" })} dogName={dogName} />
            </h2>
          </Reveal>
          <Reveal delay={0.12}>
            <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed text-pretty">
              {t("land.funnel.subtitle")}
            </p>
          </Reveal>
        </div>

        <div className="mt-12 grid lg:grid-cols-[1.1fr_1fr] gap-8 lg:gap-10 items-start">
          {/* ---------------- Form ---------------- */}
          <Reveal>
            <motion.div
              animate={shake}
              className="rounded-[2rem] border border-border/70 bg-card/90 p-5 sm:p-7 shadow-raise backdrop-blur"
            >
              {/* Progress */}
              <div className="flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-[color-mix(in_oklab,var(--primary)_60%,var(--sun))]"
                    initial={false}
                    animate={{ width: `${pct}%` }}
                    transition={{ type: "spring", duration: 0.6, bounce: 0.15 }}
                  />
                </div>
                <span className="text-xs font-extrabold tabular-nums text-primary w-20 text-right">
                  {t("land.funnel.progress", { pct })}
                </span>
              </div>

              <div className="mt-6 grid sm:grid-cols-2 gap-4">
                <Field label={t("land.funnel.name")} htmlFor="fn-name">
                  <Input
                    ref={nameRef}
                    id="fn-name"
                    value={name}
                    onChange={(e) => edit(setName)(e.target.value.slice(0, 40))}
                    placeholder={t("land.funnel.namePh")}
                    autoComplete="given-name"
                    className="h-12 rounded-2xl bg-background/60 text-base"
                    aria-invalid={showNudge && !name.trim() ? true : undefined}
                  />
                </Field>
                <Field label={t("land.funnel.dog")} htmlFor="fn-dog">
                  <Input
                    ref={dogRef}
                    id="fn-dog"
                    value={dog}
                    onChange={(e) => edit(setDog)(e.target.value.slice(0, 30))}
                    placeholder={t("land.funnel.dogPh")}
                    className="h-12 rounded-2xl bg-background/60 text-base"
                    aria-invalid={showNudge && !dog.trim() ? true : undefined}
                  />
                </Field>
              </div>

              <Field label={t("land.funnel.size")} className="mt-5">
                <ChipGroup
                  value={size}
                  onChange={edit(setSize)}
                  options={(["s", "m", "l"] as Size[]).map((s) => ({
                    value: s,
                    label: (
                      <>
                        <span aria-hidden className={cn("inline-block", s === "s" ? "text-xs" : s === "m" ? "text-sm" : "text-base")}>🐕</span>{" "}
                        {t(`land.funnel.size.${s}`)}
                      </>
                    ),
                  }))}
                />
              </Field>

              <Field label={t("land.funnel.zone")} className="mt-5">
                <ChipGroup
                  value={zone}
                  onChange={edit(setZone)}
                  options={[...zones, t("land.funnel.zoneOther")].map((z) => ({
                    value: z,
                    label: (
                      <>
                        <MapPin className="size-3.5 opacity-70" aria-hidden /> {z}
                      </>
                    ),
                  }))}
                />
              </Field>

              <Field label={t("land.funnel.freq")} className="mt-5">
                <ChipGroup
                  value={freq}
                  onChange={edit(setFreq)}
                  options={(["trial", "2", "3", "5"] as Freq[]).map((f) => ({
                    value: f,
                    label: t(`land.funnel.freq.${f}`),
                  }))}
                />
              </Field>

              <div className="mt-5 grid sm:grid-cols-2 gap-5">
                <Field label={t("land.funnel.duration")}>
                  <Segmented
                    value={duration}
                    onChange={edit(setDuration)}
                    options={([30, 45, 60] as Duration[]).map((d) => ({
                      value: d,
                      label: `${d}′`,
                      sub: pricing ? formatBOBShort(pricing[d]) : undefined,
                    }))}
                  />
                </Field>
                <Field label={t("land.funnel.slot")}>
                  <Segmented
                    value={slot}
                    onChange={edit(setSlot)}
                    options={(["am", "mid", "pm"] as Slot[]).map((s) => ({
                      value: s,
                      label: t(`land.funnel.slot.${s}`),
                      sub: s === "am" ? "7–11" : s === "mid" ? "11–15" : "15–19",
                    }))}
                  />
                </Field>
              </div>

              <Field label={t("land.funnel.notes")} htmlFor="fn-notes" className="mt-5">
                <Textarea
                  id="fn-notes"
                  value={notes}
                  onChange={(e) => edit(setNotes)(e.target.value.slice(0, 280))}
                  placeholder={t("land.funnel.notesPh")}
                  rows={3}
                  className="rounded-2xl bg-background/60 resize-none"
                />
              </Field>

              <div className="mt-6 flex flex-col sm:flex-row sm:items-center gap-3">
                <Magnetic strength={0.15}>
                  <a
                    href={waHref}
                    target="_blank"
                    rel="noreferrer"
                    onClick={onSend}
                    className="firu-btn-gloss firu-shine group inline-flex h-14 items-center justify-center gap-2.5 rounded-full bg-primary px-7 text-sm font-extrabold uppercase tracking-[0.08em] text-primary-foreground transition-transform duration-150 ease-out-expo active:scale-[0.97]"
                  >
                    <WhatsAppIcon className="size-5" />
                    {t("land.funnel.cta")}
                    <ChevronRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
                  </a>
                </Magnetic>
                <button
                  type="button"
                  onClick={onApp}
                  className="text-sm font-bold text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors"
                >
                  {t("land.funnel.app")}
                </button>
              </div>
              <AnimatePresence>
                {showNudge && (
                  <motion.p
                    role="alert"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-3 text-sm font-bold text-destructive"
                  >
                    {t("land.funnel.missing")}
                  </motion.p>
                )}
              </AnimatePresence>
              <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="size-3.5" aria-hidden /> {t("land.funnel.noCommit")}
              </p>
            </motion.div>
          </Reveal>

          {/* ---------------- Live WhatsApp preview ---------------- */}
          <Reveal delay={0.1} className="lg:sticky lg:top-24">
            <div className="overflow-hidden rounded-[2rem] border border-border/70 shadow-float bg-card">
              {/* Chat header */}
              <div className="flex items-center gap-3 bg-[#075e54] dark:bg-[#1f2c34] px-4 py-3 text-white">
                <img src="/images/brand/logo-mark-mint.png" alt="" className="size-10 rounded-full bg-white object-cover" />
                <div className="min-w-0">
                  <p className="text-sm font-extrabold leading-tight truncate">FiruWalk · Santa Cruz</p>
                  <p className="text-[11px] text-white/75 leading-tight mt-0.5 truncate">
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span
                        key={typing ? "typing" : "online"}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.15 }}
                        className="inline-block"
                      >
                        {typing ? t("land.funnel.typing") : t("land.funnel.online")}
                      </motion.span>
                    </AnimatePresence>
                  </p>
                </div>
                <WhatsAppIcon className="ml-auto size-5 opacity-80" />
              </div>

              {/* Chat body */}
              <div className="relative bg-[#efeae2] dark:bg-[#0b141a] px-3 sm:px-4 py-5 min-h-[22rem]">
                <div aria-hidden className="absolute inset-0 firu-paw-pattern opacity-60" />
                <p className="relative mx-auto mb-3 w-fit rounded-lg bg-white/80 dark:bg-[#182229] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#54656f] dark:text-[#8696a0] shadow-sm">
                  {supportWa}
                </p>
                <motion.div
                  layout={!reduce}
                  transition={springSnappy}
                  className="relative ml-auto max-w-[92%] rounded-2xl rounded-tr-md bg-[#d9fdd3] dark:bg-[#005c4b] px-3.5 pt-2.5 pb-1.5 text-[13.5px] leading-relaxed text-[#111b21] dark:text-[#e9edef] shadow-sm"
                >
                  <p>{t("land.funnel.msg.hello")}</p>
                  <div className="mt-2 space-y-0.5">
                    {lines.map((l) => (
                      <p key={l.k} className="break-words">
                        <span className="font-bold">{l.label}:</span>{" "}
                        <motion.span
                          key={l.value}
                          initial={reduce ? false : { backgroundColor: "rgba(37,211,102,0.45)" }}
                          animate={{ backgroundColor: "rgba(37,211,102,0)" }}
                          transition={{ duration: 1.1, ease: EXPO }}
                          className={cn("rounded px-0.5 -mx-0.5", (l.value === dash || l.value === "—") && "opacity-50")}
                        >
                          {l.value}
                        </motion.span>
                      </p>
                    ))}
                  </div>
                  <p className="mt-2">{t("land.funnel.msg.bye")}</p>
                  <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-[#667781] dark:text-[#8696a0]">
                    09:41 <CheckCheck className="size-3.5 text-[#53bdeb]" aria-hidden />
                  </p>
                  <span aria-hidden className="absolute -right-1.5 top-0 size-3 bg-[#d9fdd3] dark:bg-[#005c4b] [clip-path:polygon(0_0,100%_0,0_100%)]" />
                </motion.div>

                <AnimatePresence>
                  {typing && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.9 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={springSnappy}
                      className="relative mt-3 w-fit rounded-2xl rounded-tl-md bg-white dark:bg-[#202c33] px-3.5 py-2.5 shadow-sm flex gap-1"
                      aria-hidden
                    >
                      {[0, 1, 2].map((d) => (
                        <motion.span
                          key={d}
                          className="size-1.5 rounded-full bg-[#8696a0]"
                          animate={{ y: [0, -3, 0] }}
                          transition={{ duration: 0.6, repeat: Infinity, delay: d * 0.12 }}
                        />
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Estimate */}
              <div className="flex items-end justify-between gap-4 border-t px-5 py-4">
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">
                    {t("land.funnel.estimate")}
                  </p>
                  <p className="mt-1 text-3xl font-black tracking-tight tabular-nums">
                    {perWalk !== null ? <SpringMoney cents={perWalk} /> : "—"}
                    <span className="ml-1.5 text-sm font-bold text-muted-foreground">{t("land.funnel.perWalk")}</span>
                  </p>
                </div>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.p
                    key={monthly ?? freq ?? "none"}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.25, ease: EXPO }}
                    className="text-right text-xs font-bold text-muted-foreground max-w-[10rem]"
                  >
                    {monthly !== null
                      ? t("land.funnel.perMonth", { amount: formatBOBShort(monthly) })
                      : freq === "trial"
                        ? t("land.funnel.trialNote")
                        : ""}
                  </motion.p>
                </AnimatePresence>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/** "Arma el primer paseo de {dog}" with the dog name morphing as it's typed. */
function AnimatedTitle({ template, dogName }: { template: string; dogName: string }) {
  const reduce = useCalmMotion();
  const [before, after = ""] = template.split("\u0000");
  return (
    <>
      {before}
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={dogName}
          initial={reduce ? false : { opacity: 0, y: 14, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -14, filter: "blur(6px)" }}
          transition={{ duration: 0.35, ease: EXPO }}
          className="inline-block text-primary"
        >
          {dogName}
        </motion.span>
      </AnimatePresence>
      {after}
    </>
  );
}

function SpringMoney({ cents }: { cents: number }) {
  const reduce = useCalmMotion();
  const mv = useMotionValue(cents);
  const text = useTransform(mv, (v) => formatBOBShort(Math.round(v / 100) * 100));
  useEffect(() => {
    if (reduce) {
      mv.set(cents);
      return;
    }
    const c = animate(mv, cents, { type: "spring", duration: 0.6, bounce: 0.1 });
    return () => c.stop();
  }, [cents, mv, reduce]);
  return <motion.span>{text}</motion.span>;
}

function Field({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  const Tag = htmlFor ? "label" : "p";
  return (
    <div className={className}>
      <Tag
        {...(htmlFor ? { htmlFor } : {})}
        className="mb-2 block text-[11px] font-extrabold uppercase tracking-[0.16em] text-muted-foreground"
      >
        {label}
      </Tag>
      {children}
    </div>
  );
}

function ChipGroup<V extends string>({
  value,
  onChange,
  options,
}: {
  value: V | null;
  onChange: (v: V) => void;
  options: { value: V; label: ReactNode }[];
}) {
  const id = useId();
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <motion.button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            whileTap={{ scale: 0.95 }}
            transition={springSnappy}
            className={cn(
              "relative inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-bold transition-colors duration-200",
              active
                ? "border-primary text-primary-foreground"
                : "border-border bg-background/60 text-foreground/80 hover:border-primary/40 hover:text-foreground"
            )}
          >
            {active && (
              <motion.span
                layoutId={`chip-${id}`}
                className="absolute inset-0 rounded-full bg-primary"
                transition={springSnappy}
                aria-hidden
              />
            )}
            <span className="relative inline-flex items-center gap-1.5">{o.label}</span>
          </motion.button>
        );
      })}
    </div>
  );
}

function Segmented<V extends string | number>({
  value,
  onChange,
  options,
}: {
  value: V | null;
  onChange: (v: V) => void;
  options: { value: V; label: string; sub?: string }[];
}) {
  const id = useId();
  return (
    <div
      role="radiogroup"
      className="grid rounded-2xl bg-secondary/80 p-1 shadow-[inset_0_1px_2px_oklch(0_0_0/0.06)]"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className="relative rounded-xl px-1 py-2 text-center"
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-xl bg-card shadow-card"
                transition={springSnappy}
                aria-hidden
              />
            )}
            <span className={cn("relative block text-sm font-extrabold", active ? "text-foreground" : "text-muted-foreground")}>
              {o.label}
            </span>
            {o.sub && (
              <span className={cn("relative block text-[10px] font-bold tabular-nums", active ? "text-primary" : "text-muted-foreground/80")}>
                {o.sub}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
