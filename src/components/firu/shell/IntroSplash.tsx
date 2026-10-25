"use client";

// IntroSplash — plays /videos/firuwalk-intro.mp4 (hyperframes render) once per
// session as a full-screen app-loading splash. Self-contained: no props, no
// wiring needed beyond mounting it once at the app root.
//
// - Plays once per browser session ("firu-intro-played" in sessionStorage).
// - Skipped entirely for prefers-reduced-motion users.
// - Exits on: video end · click/tap · Escape · hard 4s safety timeout — each
//   path fades out over 250ms (framer-motion) and never traps the user.
// - If the video fails to load, it silently gets out of the way.
// - The overlay background (#061b0c) matches the video canvas exactly (the
//   app's dark-mode deep brand green, oklch(0.2 0.04 152)) so the poster,
//   first frame and any object-cover crop blend seamlessly.
//
// SSR-safe: the client-only gate (sessionStorage + matchMedia) is read through
// useSyncExternalStore with a server snapshot of "idle" — the server and the
// hydration render both render nothing, so there is no hydration mismatch.

import { motion } from "framer-motion";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { useT } from "@/lib/firu/i18n";

const PLAYED_KEY = "firu-intro-played";
const VIDEO_SRC = "/videos/firuwalk-intro.mp4";
const POSTER_SRC = "/videos/firuwalk-intro-poster.jpg";
const HARD_TIMEOUT_MS = 4000;
const HINT_DELAY_MS = 600;

/** Client-only session gate. "idle" is the server snapshot. */
type Gate = "idle" | "playing" | "played" | "reduced";

function readGate(): Gate {
  try {
    if (sessionStorage.getItem(PLAYED_KEY)) return "played";
  } catch {
    // Storage unavailable (private mode): play the intro.
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return "reduced";
  }
  return "playing";
}

// The gate never changes while mounted (dismissal is tracked in local state),
// so a no-op subscription is enough — we only need the post-hydration re-read.
const subscribeToNothing = () => () => {};

export function IntroSplash() {
  const { t } = useT();
  const gate = useSyncExternalStore(
    subscribeToNothing,
    readGate,
    () => "idle" as Gate
  );
  const [done, setDone] = useState(false);
  const [fading, setFading] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const markPlayed = useCallback(() => {
    try {
      sessionStorage.setItem(PLAYED_KEY, "1");
    } catch {
      // Storage unavailable: the intro just replays next visit.
    }
  }, []);

  // Reduced-motion users are marked as played (side effect only, no setState).
  useEffect(() => {
    if (gate === "reduced") markPlayed();
  }, [gate, markPlayed]);

  // Fade out, then unmount. Idempotent — safe for every dismissal path.
  const dismiss = useCallback(() => {
    markPlayed();
    setFading(true);
  }, [markPlayed]);

  const active = gate === "playing" && !done;

  // Escape skips · skip hint appears after 600ms · hard timeout never traps.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    const hintTimer = window.setTimeout(() => setShowHint(true), HINT_DELAY_MS);
    const hardTimer = window.setTimeout(dismiss, HARD_TIMEOUT_MS);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(hintTimer);
      window.clearTimeout(hardTimer);
    };
  }, [active, dismiss]);

  if (!active) return null;

  return (
    <motion.div
      role="dialog"
      aria-label="FiruWalk intro"
      className="fixed inset-0 z-[100] cursor-pointer overflow-hidden bg-[#061b0c]"
      initial={false}
      animate={{ opacity: fading ? 0 : 1 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      onAnimationComplete={() => {
        if (fading) setDone(true);
      }}
      onClick={dismiss}
    >
      {/* object-cover: portrait phones crop the 16:9 frame gracefully — the
          composition is center-weighted. */}
      <video
        className="absolute inset-0 h-full w-full object-cover"
        src={VIDEO_SRC}
        poster={POSTER_SRC}
        autoPlay
        muted
        playsInline
        preload="auto"
        onEnded={dismiss}
        onError={() => {
          // Missing or unplayable video must never block the app.
          markPlayed();
          setDone(true);
        }}
      />
      {showHint && (
        <span className="pointer-events-none absolute inset-x-0 bottom-6 text-center text-xs font-semibold tracking-wide text-white/85">
          {t("intro.skip")}
        </span>
      )}
    </motion.div>
  );
}
