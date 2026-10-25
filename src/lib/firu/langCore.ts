// SSR-safe language source — plain module state, no zustand, no localStorage.
// Client i18n.tsx keeps this in sync with the persisted lang store.
// date/money helpers read it at call time so they stay importable from API routes.

export type Lang = "es" | "en";

let current: Lang = "es";

export function getLangCore(): Lang {
  return current;
}

export function setLangCore(lang: Lang): void {
  current = lang;
}
