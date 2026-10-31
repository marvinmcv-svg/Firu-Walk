// Phone normalization shared by login and the walker application.

import { ApiError } from "../http";

/** Loose E.164 normalization: spaces/dashes out, default +591 for bare 8-digit mobiles. */
export function normalizePhone(raw: string): string {
  const trimmed = raw.replace(/[\s\-().]/g, "");
  if (/^5917\d{7}$/.test(trimmed)) return `+${trimmed}`;
  if (/^7\d{7}$/.test(trimmed)) return `+591${trimmed}`;
  return trimmed;
}

/** Normalize + validate, else 400. */
export function requirePhone(raw: string): string {
  const phone = normalizePhone(raw);
  if (!/^\+\d{8,15}$/.test(phone)) {
    throw new ApiError(400, "El teléfono es inválido (usa formato +5917xxxxxxx).");
  }
  return phone;
}
