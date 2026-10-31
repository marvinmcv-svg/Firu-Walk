"use client";

// FAQ — objection handling right after the funnel. Prices and policy come
// from live config so the answers never drift from what the app charges.

import { motion } from "framer-motion";
import { Plus } from "lucide-react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { useT } from "@/lib/firu/i18n";
import { EXPO, SectionHeading } from "./primitives";

export function Faq({
  prices,
  cancelHours,
  guarantee,
}: {
  prices: { p30: string; p45: string; p60: string };
  cancelHours: number;
  guarantee?: string;
}) {
  const { t } = useT();
  const qa: [string, string][] = [
    [t("land.faq.q1"), t("land.faq.a1", prices)],
    [t("land.faq.q2"), t("land.faq.a2")],
    [t("land.faq.q3"), guarantee ?? t("land.faq.a3")],
    [t("land.faq.q4"), t("land.faq.a4")],
    [t("land.faq.q5"), t("land.faq.a5")],
    [t("land.faq.q6"), t("land.faq.a6", { h: cancelHours })],
    [t("land.faq.q7"), t("land.faq.a7")],
  ];
  return (
    <section id="preguntas" className="mx-auto max-w-3xl px-4 py-20 sm:py-24 w-full">
      <SectionHeading eyebrow={t("land.faq.eyebrow")} title={t("land.faq.title")} />
      <AccordionPrimitive.Root type="single" collapsible defaultValue="q0" className="mt-10 space-y-3">
        {qa.map(([q, a], i) => (
          <motion.div
            key={q}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.55, ease: EXPO, delay: i * 0.05 }}
          >
            <AccordionPrimitive.Item
              value={`q${i}`}
              className="group rounded-2xl border border-border/70 bg-card shadow-card transition-[box-shadow,border-color] duration-300 data-[state=open]:border-primary/30 data-[state=open]:shadow-raise"
            >
              <AccordionPrimitive.Header>
                <AccordionPrimitive.Trigger className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-base font-extrabold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30 rounded-2xl">
                  {q}
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-primary transition-[transform,background-color] duration-300 ease-out-expo group-data-[state=open]:rotate-45 group-data-[state=open]:bg-brand-soft">
                    <Plus className="size-4" aria-hidden />
                  </span>
                </AccordionPrimitive.Trigger>
              </AccordionPrimitive.Header>
              <AccordionPrimitive.Content className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                <p className="px-5 pb-5 -mt-1 text-[15px] text-muted-foreground leading-relaxed">{a}</p>
              </AccordionPrimitive.Content>
            </AccordionPrimitive.Item>
          </motion.div>
        ))}
      </AccordionPrimitive.Root>
    </section>
  );
}
