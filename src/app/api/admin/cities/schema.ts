import { z } from "zod";

const Cents = z.number().int().min(500, "El precio mínimo es Bs 5.").max(100_000, "El precio es demasiado alto.");
const Coord = (min: number, max: number) => z.number().min(min).max(max);

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const Slug = z.string().trim().max(40).regex(SLUG_RE, "La clave solo admite minúsculas, números y guiones (p. ej. la-paz).");

export const Peaks = z
  .array(z.tuple([z.number().int().min(0).max(1440), z.number().int().min(0).max(1440)]))
  .min(1, "Indica al menos un horario pico.")
  .max(4, "Máximo 4 horarios pico.")
  .refine((ws) => ws.every(([a, b]) => a < b), "Cada horario pico debe terminar después de empezar.");

export const Durations = z
  .array(z.union([z.literal(30), z.literal(45), z.literal(60)]))
  .min(1, "Elige al menos una duración de paseo.");

export const CityEdit = z.object({
  name: z.string().trim().min(2, "El nombre es obligatorio.").max(60),
  centerLat: Coord(-23, -9),
  centerLng: Coord(-70, -57),
  sortOrder: z.number().int().min(0).max(999),
  price30Cents: Cents,
  price45Cents: Cents,
  price60Cents: Cents,
  durations: Durations,
  peaks: Peaks,
  active: z.boolean(),
});

export const CityCreate = CityEdit.omit({ active: true }).extend({
  key: Slug,
  sortOrder: z.number().int().min(0).max(999).optional().default(0),
});

export const ZoneEdit = z.object({
  name: z.string().trim().min(2, "El nombre es obligatorio.").max(60),
  centerLat: Coord(-23, -9),
  centerLng: Coord(-70, -57),
  sortOrder: z.number().int().min(0).max(999),
  active: z.boolean(),
});

export const ZoneCreate = ZoneEdit.omit({ active: true }).extend({
  cityId: z.string().trim().min(1).max(40),
  key: Slug,
  sortOrder: z.number().int().min(0).max(999).optional().default(0),
});
