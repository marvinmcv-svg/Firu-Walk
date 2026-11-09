import { z } from "zod";

export const VetInput = z
  .object({
    name: z.string().trim().min(2, "El nombre es obligatorio.").max(120),
    phone: z.string().trim().regex(/^\+?[\d\s()-]{6,20}$/, "El teléfono es inválido."),
    address: z.string().trim().min(3, "La dirección es obligatoria.").max(200),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    open24h: z.boolean(),
    notes: z.string().trim().max(500).nullable(),
    active: z.boolean(),
  })
  .partial();
