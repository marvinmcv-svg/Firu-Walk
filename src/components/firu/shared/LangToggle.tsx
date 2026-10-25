"use client";

// ES/EN language toggle — iOS-style segmented control.
// Sliding thumb mirrors the app's segmented-control language (framer layoutId
// spring, inset track, raised thumb) and persists via the lang store.

import { motion } from "framer-motion";
import { useId } from "react";
import { springSnappy } from "@/lib/firu/motion";
import { useLangStore, type Lang } from "@/lib/firu/i18n";
import { cn } from "@/lib/utils";

const OPTIONS: { value: Lang; label: string }[] = [
  { value: "es", label: "ES" },
  { value: "en", label: "EN" },
];

export function LangToggle({ className }: { className?: string }) {
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);
  const id = useId();

  return (
    <div
      role="group"
      aria-label={lang === "es" ? "Cambiar idioma" : "Change language"}
      className={cn(
        "relative inline-flex items-center rounded-full border border-border/70 bg-secondary/80 p-0.5",
        "shadow-[inset_0_1px_2px_oklch(0_0_0/0.06)]",
        className
      )}
    >
      {OPTIONS.map((o) => {
        const active = lang === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => setLang(o.value)}
            className={cn(
              "relative rounded-full px-2.5 h-7 text-[11px] font-black tracking-wide",
              "transition-colors duration-200 ease-out-expo active:scale-[0.97]",
              active
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {active && (
              <motion.span
                layoutId={`firu-lang-thumb-${id}`}
                className="absolute inset-0 rounded-full bg-background"
                transition={springSnappy}
                aria-hidden
              />
            )}
            <span className="relative z-10">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
