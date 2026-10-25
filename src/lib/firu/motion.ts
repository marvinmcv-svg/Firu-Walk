// Apple-style motion presets (emilkowalski/skills · apple-design).
// Springs over durations; damping 1.0 by default, bounce only for momentum.
// Use with framer-motion: <motion.div variants={fadeUp} initial="hidden" animate="show" />
import type { Transition, Variants } from "framer-motion";

/** Critically damped default — graceful, no overshoot (Apple damping 1.0 / response 0.45) */
export const springSmooth: Transition = { type: "spring", duration: 0.45, bounce: 0 };
/** Snappier variant for small elements / pills (response 0.3) */
export const springSnappy: Transition = { type: "spring", duration: 0.3, bounce: 0 };
/** Momentum moments only — a flick/throw preceded it (damping ≈ 0.8) */
export const springMomentum: Transition = { type: "spring", duration: 0.5, bounce: 0.18 };
/** Duration-based fallback matching CSS --ease-out-expo for non-gesture entrances */
export const easeOutExpo: Transition = { duration: 0.35, ease: [0.23, 1, 0.32, 1] };
export const easeDrawer: Transition = { duration: 0.4, ease: [0.32, 0.72, 0, 1] };

/** Standard content entrance: rise + fade (never scale(0) — starts at 0.98) */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: easeOutExpo },
};

/** Container that staggers its children 30–80ms apart */
export const staggerContainer = (stagger = 0.06, delayChildren = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger, delayChildren } },
});

/** Child of a staggerContainer — subtle rise with a spring settle */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 10, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: springSnappy },
};

/** Pop-in for badges/pills — origin stays where you put it via transform-origin */
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  show: { opacity: 1, scale: 1, transition: springMomentum },
};
