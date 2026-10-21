/**
 * The shop's product-card template (merchant setting, Settings → Product cards): whether the customer agent sends cards,
 * on which channels, how many, what the button says, which parts a card shows, and its look in the website widget.
 * Stored in the tenant's settings under `product_cards`; a shop that never saved it gets the defaults (a GET never
 * writes them). Only presentation can change: price, stock and name always come from the catalog.
 */
import { z } from "zod";
import { db } from "@/infrastructure/db";
import type { ChannelType } from "@/types/social";

export const CARD_CHANNELS = ["FACEBOOK_MESSENGER", "INSTAGRAM", "WHATSAPP", "WEBSITE_CHAT"] as const satisfies readonly ChannelType[];
export type CardChannel = (typeof CARD_CHANNELS)[number];

/** A button text customers see: one line, no markup, no characters our tap payload uses. */
const ButtonLabel = z
  .string()
  .trim()
  .min(1, "Enter the button text")
  .max(20, "At most 20 characters (Messenger and WhatsApp cut longer buttons)")
  // No markup, links or our payload separator; no control, invisible or direction-changing characters either
  .refine((v) => !/[|<>]|https?:/i.test(v) && !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(v), "Plain text only");

export const ProductCardSettingsSchema = z
  .object({
    enabled: z.boolean(),
    channels: z.object({ FACEBOOK_MESSENGER: z.boolean(), INSTAGRAM: z.boolean(), WHATSAPP: z.boolean(), WEBSITE_CHAT: z.boolean() }).strict(),
    /** Cards per reply; WhatsApp sends at most 3 (one message each). */
    max_cards: z.number().int().min(1).max(5),
    button_label_latin: ButtonLabel,
    button_label_bangla: ButtonLabel,
    show_photo: z.boolean(),
    show_regular_price: z.boolean(),
    /** false: products with nothing in stock get no card. */
    show_out_of_stock: z.boolean(),
    theme: z.enum(["lime", "dark", "light"]),
  })
  .strict();

export type ProductCardSettings = z.infer<typeof ProductCardSettingsSchema>;

export const DEFAULT_PRODUCT_CARD_SETTINGS: ProductCardSettings = {
  enabled: true,
  channels: { FACEBOOK_MESSENGER: true, INSTAGRAM: true, WHATSAPP: true, WEBSITE_CHAT: true },
  max_cards: 5,
  button_label_latin: "Order now",
  button_label_bangla: "অর্ডার করুন",
  show_photo: true,
  show_regular_price: true,
  show_out_of_stock: true,
  theme: "lime",
};

/** The shop's settings, or the defaults. A stored value that no longer validates falls back to the defaults. */
export function getProductCardSettings(tenantId: string): ProductCardSettings {
  const stored = db.findTenantById(tenantId)?.settings?.product_cards;
  if (!stored) return DEFAULT_PRODUCT_CARD_SETTINGS;
  const parsed = ProductCardSettingsSchema.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_PRODUCT_CARD_SETTINGS;
}

/** Whether this shop sends cards on this channel at all. */
export function cardsEnabledFor(settings: ProductCardSettings, channel: ChannelType): boolean {
  return settings.enabled && (CARD_CHANNELS as readonly string[]).includes(channel) && settings.channels[channel as CardChannel];
}
