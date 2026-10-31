"use client";

// Mobile-only floating CTA pill: appears once the hero scrolls away, hides
// while the funnel itself is on screen and near the page end. Leaves the
// right corner free for the FirulAI launcher.

import { useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "framer-motion";
import { ChevronRight, PawPrint } from "lucide-react";
import { useT } from "@/lib/firu/i18n";

export function StickyCta({ onClick }: { onClick: () => void }) {
  const { t } = useT();
  const { scrollY } = useScroll();
  const [show, setShow] = useState(false);

  useMotionValueEvent(scrollY, "change", (y) => {
    const funnel = document.getElementById("reservar")?.getBoundingClientRect();
    const funnelOnScreen = !!funnel && funnel.top < window.innerHeight * 0.7 && funnel.bottom > 120;
    const nearEnd = document.documentElement.scrollHeight - (y + window.innerHeight) < 520;
    setShow(y > 640 && !funnelOnScreen && !nearEnd);
  });

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: 90, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 90, opacity: 0 }}
          transition={{ type: "spring", duration: 0.5, bounce: 0.2 }}
          className="md:hidden fixed left-3 right-[5.25rem] bottom-3 z-40 pb-safe"
        >
          <button
            type="button"
            onClick={onClick}
            className="firu-glass w-full flex items-center gap-3 rounded-full border border-border/60 p-1.5 pr-2 shadow-float text-left active:scale-[0.98] transition-transform"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-primary">
              <PawPrint className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 truncate text-xs font-bold text-muted-foreground">
              {t("land.sticky.text")}
            </span>
            <span className="firu-btn-gloss inline-flex items-center gap-0.5 rounded-full bg-primary px-3.5 py-2 text-xs font-extrabold text-primary-foreground">
              {t("land.sticky.cta")}
              <ChevronRight className="size-3.5" aria-hidden />
            </span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
