/**
 * Product cards in chat: after the customer agent searched or looked up products, the matches are sent as cards
 * (photo, title, price, an "Order" button) instead of only a text list.
 *
 * Name, price and stock come from this turn's tool results (the same server data the reply's price guard allows); the
 * photo comes from the catalog. Nothing on a card is model text. A tap comes back to the agent as an ordinary customer
 * message ("Order now: Blue Panjabi"), so ordering still goes through quote_order / place_order and their checks.
 */
import { db } from "@/infrastructure/db";
import { productRepository } from "@/domains/catalog/product.repository";
import type { ChannelType, ProductCard } from "@/types/social";
import type { ToolResult } from "@/domains/ai/customer-agent/tools";
import { CARD_LABELS, productTapPayload } from "./product-tap";
import { getProductCardSettings, type ProductCardSettings } from "./product-card-settings";

export { PRODUCT_ORDER_PREFIX, productTapText, isProductTapText } from "./product-tap";
export const MAX_PRODUCT_CARDS = 5;
/** WhatsApp has no carousel without a Meta catalog: each card is its own message, so fewer. */
export const MAX_WHATSAPP_PRODUCT_CARDS = 3;

const LABELS = CARD_LABELS;

export type CardScript = keyof typeof LABELS;

interface VariantView {
  variant_id?: unknown;
  price_bdt?: unknown;
  stock_status?: unknown;
}

interface ProductView {
  product_id: string;
  name: string;
  variants: VariantView[];
  regular_price_bdt?: unknown;
}

function asProductView(value: unknown): ProductView | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.product_id !== "string" || typeof v.name !== "string" || !Array.isArray(v.variants)) return null;
  return v as unknown as ProductView;
}

/**
 * The products a turn's tool results showed, in order, without repeats: search_products' `results` and get_product's
 * single product. Results that are errors or not product views are skipped.
 */
export function productsFromToolResults(results: readonly ToolResult[]): ProductView[] {
  const seen = new Map<string, ProductView>();
  for (const r of results) {
    const candidates = Array.isArray(r.results) ? r.results : [r];
    for (const c of candidates) {
      const view = asProductView(c);
      if (view && !seen.has(view.product_id)) seen.set(view.product_id, view);
    }
  }
  return [...seen.values()];
}

/**
 * Whether a turn's reply gets product cards: a completed turn that looked products up and did nothing more. While an
 * order is being priced or placed (quote_order / place_order) or the chat went to a person, cards would only distract.
 */
export function turnShowsProductCards(turn: { status: string; handoff: boolean; toolCalls: ReadonlyArray<{ name: string; ok: boolean }> }): boolean {
  if (turn.status !== "COMPLETED" || turn.handoff) return false;
  if (turn.toolCalls.some((t) => t.name === "quote_order" || t.name === "place_order")) return false;
  return turn.toolCalls.some((t) => t.ok && (t.name === "search_products" || t.name === "get_product"));
}

/** Images a channel can show: Meta and WhatsApp fetch the URL themselves (public https); the website widget is ours. */
function usableImage(url: string | undefined, channel: ChannelType): string | undefined {
  if (!url) return undefined;
  if (/^https:\/\//i.test(url)) return url;
  if (channel === "WEBSITE_CHAT" && url.startsWith("/api/v1/media/files/")) return url;
  return undefined;
}

/**
 * Cards for the products this turn's tools returned, drawn with the shop's template (Settings → Product cards).
 * Products no longer active are left out, and out-of-stock ones too when the shop hides them.
 */
export async function buildProductCards(
  tenantId: string,
  results: readonly ToolResult[],
  channel: ChannelType,
  script: CardScript,
  settings: ProductCardSettings = getProductCardSettings(tenantId)
): Promise<ProductCard[]> {
  const max = Math.min(settings.max_cards, channel === "WHATSAPP" ? MAX_WHATSAPP_PRODUCT_CARDS : MAX_PRODUCT_CARDS);
  const views = productsFromToolResults(results).slice(0, MAX_PRODUCT_CARDS * 2);
  if (!views.length) return [];
  const products = new Map((await productRepository.findByIds(tenantId, views.map((v) => v.product_id))).map((p) => [p.id, p]));
  const labels = LABELS[script];
  const cards: ProductCard[] = [];
  for (const view of views) {
    if (cards.length >= max) break;
    const product = products.get(view.product_id);
    if (!product || product.status !== "ACTIVE") continue;
    // Only variants the shop sells now (quote_order refuses the rest): an archived cheaper size mustn't set the price
    const catalogVariants = product.variants?.length ? product.variants : db.getProductVariants(tenantId, product.id);
    const inactive = new Set(catalogVariants.filter((v) => v.status && v.status !== "ACTIVE").map((v) => v.id));
    const sellable = view.variants.filter((v) => !(typeof v.variant_id === "string" && inactive.has(v.variant_id)));
    const prices = sellable.map((v) => v.price_bdt).filter((p): p is number => typeof p === "number" && p >= 0);
    if (!prices.length) continue;
    const price = Math.min(...prices);
    const inStock = sellable.some((v) => v.stock_status !== "out_of_stock");
    if (!inStock && !settings.show_out_of_stock) continue;
    const title = product.name.slice(0, 80);
    const showRegular = settings.show_regular_price && typeof view.regular_price_bdt === "number" && view.regular_price_bdt > price;
    cards.push({
      product_id: product.id,
      title,
      price_bdt: price,
      price_varies: Math.max(...prices) !== price,
      ...(showRegular ? { regular_price_bdt: view.regular_price_bdt as number } : {}),
      in_stock: inStock,
      image_url: settings.show_photo ? usableImage(product.primary_image || product.images?.[0], channel) : undefined,
      // The shop's own button text; "Out of stock" stays ours (it is a fact, not a call to action)
      button_label: inStock ? (script === "bangla" ? settings.button_label_bangla : settings.button_label_latin) : labels.outOfStock,
      button_payload: productTapPayload(product.id, title, script),
      script,
      theme: settings.theme,
    });
  }
  return cards;
}

const taka = (n: number) => `৳${n.toLocaleString("en-IN")}`;

/** "৳1,500", "from ৳1,200", "৳1,200 থেকে", with "· Out of stock" when nothing can be ordered. */
export function cardPriceLine(card: ProductCard, script: CardScript): string {
  const labels = LABELS[script];
  const price = card.price_varies ? (script === "bangla" ? `${taka(card.price_bdt)} ${labels.from}` : `${labels.from} ${taka(card.price_bdt)}`) : taka(card.price_bdt);
  const regular = card.regular_price_bdt ? ` (${taka(card.regular_price_bdt)})` : "";
  return `${price}${regular}${card.in_stock ? "" : ` · ${labels.outOfStock}`}`;
}

export function scriptOfCards(cards: readonly ProductCard[]): CardScript {
  return cards[0]?.script === "bangla" ? "bangla" : "latin";
}

/** The plain-text form kept on the message (staff inbox, search, channels without cards). */
export function productCardsText(cards: readonly ProductCard[]): string {
  const script = scriptOfCards(cards);
  return cards.map((c, i) => `${i + 1}. ${c.title}: ${cardPriceLine(c, script)}`).join("\n");
}

// ---- Channel formats ---------------------------------------------------------------------------------------------------

/** Messenger / Instagram generic template: a swipeable row of cards, one postback button each. */
export function metaGenericTemplate(cards: readonly ProductCard[]): Record<string, unknown> {
  const script = scriptOfCards(cards);
  return {
    type: "template",
    payload: {
      template_type: "generic",
      elements: cards.slice(0, MAX_PRODUCT_CARDS).map((c) => ({
        title: c.title.slice(0, 80),
        subtitle: cardPriceLine(c, script).slice(0, 80),
        ...(c.image_url ? { image_url: c.image_url } : {}),
        // An out-of-stock card has no button: there is nothing to order
        ...(c.in_stock ? { buttons: [{ type: "postback", title: c.button_label.slice(0, 20), payload: c.button_payload.slice(0, 1000) }] } : {}),
      })),
    },
  };
}

/** WhatsApp interactive reply-button message for one card: photo header, title and price, one button. */
export function whatsappProductMessage(card: ProductCard, to: string, script: CardScript): Record<string, unknown> {
  const body = `${card.title}\n${cardPriceLine(card, script)}`.slice(0, 1024);
  if (!card.in_stock) {
    return card.image_url
      ? { messaging_product: "whatsapp", to, type: "image", image: { link: card.image_url, caption: body } }
      : { messaging_product: "whatsapp", to, type: "text", text: { body } };
  }
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      ...(card.image_url ? { header: { type: "image", image: { link: card.image_url } } } : {}),
      body: { text: body },
      action: { buttons: [{ type: "reply", reply: { id: card.button_payload.slice(0, 256), title: card.button_label.slice(0, 20) } }] },
    },
  };
}
