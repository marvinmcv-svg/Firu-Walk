import { z } from "zod";

export const PartnerInput = z.object({
  name: z.string().trim().min(2, "El nombre es obligatorio.").max(80),
  kind: z.enum(["VET", "PETSHOP", "GROOMER", "CONDO", "RELOCATION", "OTHER"]),
  contactName: z.string().trim().max(80).nullable().optional(),
  contactPhone: z.string().trim().max(30).nullable().optional(),
  zoneId: z.string().trim().max(40).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  referralFeeCents: z.number().int().min(0).max(100_000, "La comisión es demasiado alta."),
  giftWalk: z.boolean(),
  active: z.boolean(),
});
