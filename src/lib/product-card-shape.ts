/**
 * Reads product cards back from a stored message's metadata (server routes and browser components alike). Only the
 * card fields pass; anything else in the metadata stays on the server. Image URLs must be https or the app's own
 * media route, so a card can't point an <img> at another scheme.
 */
import { z } from "zod";
import type { ProductCard } from "@/types/social";

const ProductCardShape = z.object({
  product_id: z.string().max(100),
  title: z.string().max(120),
  price_bdt: z.number().finite().nonnegative(),
  price_varies: z.boolean(),
  regular_price_bdt: z.number().finite().nonnegative().optional(),
  in_stock: z.boolean(),
  image_url: z.string().max(2000).regex(/^(https:\/\/|\/api\/v1\/media\/files\/)/).optional(),
  button_label: z.string().max(40),
  button_payload: z.string().max(300),
  // Cards stored before the template settings had no script or theme
  script: z.enum(["bangla", "latin"]).default("latin"),
  theme: z.enum(["lime", "dark", "light"]).optional(),
});

export function readProductCards(value: unknown): ProductCard[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).flatMap((v) => {
    const parsed = ProductCardShape.safeParse(v);
    return parsed.success ? [parsed.data] : [];
  });
}

const taka = (n: number) => `৳${n.toLocaleString("en-IN")}`;

/** "৳1,500" or "from ৳1,200" (Bangla: "৳1,200 থেকে"), as the card shows it. */
export function cardPrice(card: ProductCard): string {
  if (!card.price_varies) return taka(card.price_bdt);
  return card.script === "bangla" ? `${taka(card.price_bdt)} থেকে` : `from ${taka(card.price_bdt)}`;
}
