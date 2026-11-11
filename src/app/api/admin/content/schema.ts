import { z } from "zod";
import { MONTH_RE } from "@/lib/server/content";

export const FeatureEdit = z.object({
  headline: z.string().trim().min(3, "El título es obligatorio.").max(80, "El título es demasiado largo (máx. 80)."),
  blurb: z.string().trim().min(10, "Escribe al menos una frase.").max(400, "El texto es demasiado largo (máx. 400)."),
  photoUrl: z.string().trim().max(500).nullable().optional(),
  published: z.boolean(),
});

export const FeatureCreate = FeatureEdit.extend({
  kind: z.enum(["FIRU_OF_MONTH", "WALKER_SPOTLIGHT"]),
  month: z.string().regex(MONTH_RE, "Mes inválido (AAAA-MM)."),
  dogId: z.string().trim().max(40).optional(),
  walkerId: z.string().trim().max(40).optional(),
  published: z.boolean().optional().default(true),
});
