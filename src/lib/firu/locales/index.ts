// Locale registry — merges every domain section into one flat dict per language.
// Domain agents own their own section files; keep keys prefixed by domain
// (c.*, shell.*, land.*, sh.*, own.*, wlk.*, adm.*, ai.*) so merges never collide.

import commonEs from "./es/common";
import shellEs from "./es/shell";
import landingEs from "./es/landing";
import sharedEs from "./es/shared";
import ownerEs from "./es/owner";
import walkerEs from "./es/walker";
import adminEs from "./es/admin";
import aiEs from "./es/ai";

import commonEn from "./en/common";
import shellEn from "./en/shell";
import landingEn from "./en/landing";
import sharedEn from "./en/shared";
import ownerEn from "./en/owner";
import walkerEn from "./en/walker";
import adminEn from "./en/admin";
import srvEn from "./en/srv";
import aiEn from "./en/ai";

const dictEs: Record<string, string> = {
  ...commonEs,
  ...shellEs,
  ...landingEs,
  ...sharedEs,
  ...ownerEs,
  ...walkerEs,
  ...adminEs,
  ...aiEs,
};

const dictEn: Record<string, string> = {
  ...commonEn,
  ...shellEn,
  ...landingEn,
  ...sharedEn,
  ...ownerEn,
  ...walkerEn,
  ...adminEn,
  ...srvEn,
  ...aiEn,
};

export const DICT: Record<"es" | "en", Record<string, string>> = {
  es: dictEs,
  en: dictEn,
};
