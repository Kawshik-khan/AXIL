import { z } from "zod";

/** Fields a customer PATCH may change (FX-12). Totals, source and tenant are never client-writable. */
export const CustomerPatchSchema = z
  .object({
    first_name: z.string().trim().min(1).max(100),
    last_name: z.string().trim().max(100),
    email: z.string().trim().email().max(254).nullable(),
    phone: z.string().trim().min(6).max(32),
    notes: z.string().max(5000),
    status: z.enum(["ACTIVE", "BLACKLISTED"]),
  })
  .partial()
  .strict();

export type CustomerPatch = z.infer<typeof CustomerPatchSchema>;
