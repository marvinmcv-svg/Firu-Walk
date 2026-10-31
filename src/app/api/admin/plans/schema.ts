import { z } from "zod";

/** Editable plan fields. Price changes only affect future purchases. */
export const PlanInput = z
  .object({
    key: z.string().trim().regex(/^[a-z0-9-]{3,40}$/, "La clave usa minúsculas, números y guiones."),
    name: z.string().trim().min(3, "El nombre es obligatorio.").max(80),
    walks: z.number().int().min(1, "Mínimo 1 paseo.").max(62),
    durationMin: z.union([z.literal(30), z.literal(45), z.literal(60)]),
    priceCents: z.number().int().min(100, "El precio es inválido.").max(10_000_000),
    periodDays: z.number().int().min(7).max(92),
    active: z.boolean(),
    sortOrder: z.number().int().min(0).max(1000),
  })
  .partial();
