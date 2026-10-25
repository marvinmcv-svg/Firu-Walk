"use client";

// FiruWalk i18n — lightweight, client-side, persisted ES/EN language toggle.
//
// - `useLangStore` persists the choice to localStorage ("firu-lang", default es).
// - `useT()` returns { t, lang, setLang }; every component that renders text
//   should call it — the store subscription makes language switches re-render.
// - date/money helpers read the language through langCore (SSR-safe mirror),
//   which this store keeps in sync on change and on hydration.
// - Keys are flat strings namespaced per domain (c.*, shell.*, land.*, sh.*,
//   own.*, wlk.*, adm.*). ES is the source of truth; EN falls back to ES,
//   unknown keys fall back to the key itself.

import { useCallback } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DICT } from "./locales";
import { getLangCore, setLangCore, type Lang } from "./langCore";

export type { Lang } from "./langCore";

interface LangState {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

export const useLangStore = create<LangState>()(
  persist(
    (set) => ({
      lang: "es",
      setLang: (lang) => set({ lang }),
    }),
    { name: "firu-lang" }
  )
);

// Mirror the persisted choice into the SSR-safe core (for dates/money).
setLangCore(useLangStore.getState().lang);
useLangStore.subscribe((s) => setLangCore(s.lang));

/** Non-hook accessor (event handlers, callbacks outside React). */
export function getLang(): Lang {
  return useLangStore.getState().lang;
}

/** Core translate: interpolate "{var}" placeholders. */
export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  let s = DICT[lang][key] ?? DICT.es[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

/** Hook used by every localized component. */
export function useT() {
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);
  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars),
    [lang]
  );
  return { t, lang, setLang };
}

/**
 * Map a known server-side (Spanish) error message to the active language.
 * Exact match first, then prefix match for keys ending in "*".
 * Unknown messages pass through untouched.
 */
export function srvErr(msg: string): string {
  const lang = getLang();
  if (lang === "es") return msg;
  const en = DICT.en[msg];
  if (en) return en;
  for (const [k, v] of Object.entries(DICT.en)) {
    if (k.endsWith("*") && msg.startsWith(k.slice(0, -1))) {
      return v + msg.slice(k.slice(0, -1).length);
    }
  }
  return msg;
}
