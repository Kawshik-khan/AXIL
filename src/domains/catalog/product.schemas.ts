import { z } from "zod";

/** Fields a product PATCH may change (FX-12). Unknown keys such as tenant_id, id or variants are rejected. */
export const ProductPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(10_000),
    short_description: z.string().max(500),
    category_id: z.string().max(100).nullable(),
    brand_id: z.string().max(100).nullable(),
    sku: z.string().trim().min(1).max(64),
    barcode: z.string().trim().max(64),
    base_price: z.number().finite().nonnegative(),
    compare_at_price: z.number().finite().nonnegative().nullable(),
    cost_price: z.number().finite().nonnegative().nullable(),
    weight: z.number().finite().nonnegative(),
    status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
    images: z.array(z.string().trim().min(1).max(2000)).max(20),
    primary_image: z.string().trim().max(2000),
  })
  .partial()
  .strict();

export type ProductPatch = z.infer<typeof ProductPatchSchema>;
