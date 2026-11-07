/**
 * Product-card buttons: their labels and what a tap becomes. Kept apart from product-cards.ts (which reads the catalog)
 * so the confirmation gate can import it.
 *
 * A tap arrives as the customer's text "<label>: <title>", e.g. "অর্ডার করুন: Blue Panjabi". It is a request to look
 * at or order that product, never a "yes" to an open quote: "অর্ডার করুন" is also a confirmation word, so the gate
 * (confirmation.ts) rejects tap text explicitly. Otherwise tapping an older card would place the quoted order.
 *
 * The label in the tap text is always one of these fixed ones, chosen by the script carried in the payload, never the
 * shop's custom button text: the gate must recognise every tap, whatever the merchant named the button.
 */

export const PRODUCT_ORDER_PREFIX = "PRODUCT_ORDER";

export const CARD_LABELS = {
  bangla: { order: "অর্ডার করুন", outOfStock: "স্টকে নেই", from: "থেকে" },
  latin: { order: "Order now", outOfStock: "Out of stock", from: "from" },
} as const;

const TAP_LABELS = [CARD_LABELS.bangla.order, CARD_LABELS.latin.order, CARD_LABELS.bangla.outOfStock, CARD_LABELS.latin.outOfStock];

/** The button payload: `PRODUCT_ORDER|<product_id>|<title>|<bn|en>` ("|" can't be in our ids; it is removed from titles). */
export function productTapPayload(productId: string, title: string, script: "bangla" | "latin"): string {
  return `${PRODUCT_ORDER_PREFIX}|${productId}|${title.replace(/\|/g, "/").slice(0, 60)}|${script === "bangla" ? "bn" : "en"}`;
}

/** Telegram button data is at most 64 bytes, too small for the full payload with a (Bangla) title. */
const TELEGRAM_TAP_PREFIX = "PO";
const TELEGRAM_DATA_MAX_BYTES = 64;

/** A card's Telegram button data, `PO|<product_id>|<b|e>`, or null when the id makes it too long for Telegram. */
export function telegramTapData(productId: string, script: "bangla" | "latin"): string | null {
  const data = `${TELEGRAM_TAP_PREFIX}|${productId}|${script === "bangla" ? "b" : "e"}`;
  return new TextEncoder().encode(data).length <= TELEGRAM_DATA_MAX_BYTES ? data : null;
}

/**
 * The full payload for a Telegram button tap, or null when the data isn't ours. The title is the first line of the
 * card's caption, which we wrote (`<title>\n<price>`); productTapText still validates the product id. Telegram leaves
 * the content out of a press on a very old card: the product id stands in, so the agent can still look it up.
 */
export function telegramTapPayload(data: string | undefined, caption: string | undefined): string | null {
  const [prefix, productId, script, ...rest] = (data ?? "").split("|");
  if (prefix !== TELEGRAM_TAP_PREFIX || !productId || (script !== "b" && script !== "e") || rest.length) return null;
  const title = (caption ?? "").split("\n")[0].trim() || productId;
  return productTapPayload(productId, title, script === "b" ? "bangla" : "latin");
}

/**
 * The customer message a tap becomes, from a button payload, or null when it isn't ours. Title and script come from
 * the payload we wrote; whatever button title the channel echoes back is ignored.
 */
export function productTapText(payload: string | undefined): { text: string; productId: string } | null {
  if (!payload) return null;
  const [prefix, productId, title, script] = payload.split("|");
  if (prefix !== PRODUCT_ORDER_PREFIX || !productId || !/^[A-Za-z0-9_-]{1,100}$/.test(productId)) return null;
  const label = script === "bn" ? CARD_LABELS.bangla.order : CARD_LABELS.latin.order;
  return { text: `${label}: ${(title || "").slice(0, 80)}`.trim(), productId };
}

/** Whether a message is a card tap ("<one of our labels>: …"), on any channel including the website widget. */
export function isProductTapText(text: string): boolean {
  const t = text.normalize("NFC").trim();
  return TAP_LABELS.some((label) => t.startsWith(`${label}:`));
}
