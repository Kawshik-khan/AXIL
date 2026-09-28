import type { SalesChannel } from "@/types/analytics";

/** Display names for sales channels. */
export const SALES_CHANNEL_NAMES: Record<SalesChannel, string> = {
  WHATSAPP: "WhatsApp",
  FACEBOOK_MESSENGER: "Facebook Messenger",
  INSTAGRAM: "Instagram",
  WEBSITE: "Website",
  MANUAL_POS: "Manual / POS",
  UNATTRIBUTED: "Unattributed (source or platform not recorded)",
};

/**
 * The channel an order came from, from what the order records (FX-30). Social orders name their platform only in
 * notes; anything else, including imports, is UNATTRIBUTED rather than guessed (the dashboard used to count every
 * unknown order as Facebook, and analytics as Website).
 */
export function channelOfOrder(order: { source?: string | null; notes?: string | null }): SalesChannel {
  const source = order.source || "";
  const notes = (order.notes || "").toLowerCase();
  if (source === "WEBSITE") return "WEBSITE";
  if (source === "MANUAL") return "MANUAL_POS";
  if (source === "WHATSAPP" || notes.includes("whatsapp")) return "WHATSAPP";
  if (source === "INSTAGRAM" || notes.includes("instagram")) return "INSTAGRAM";
  if (source === "FACEBOOK" || notes.includes("facebook") || notes.includes("messenger")) return "FACEBOOK_MESSENGER";
  return "UNATTRIBUTED";
}
