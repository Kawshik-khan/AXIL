import type { CustomerListItem, CustomerSegment, CustomerSort } from "@/lib/customer-segments";
import type { ChannelType } from "@/types/social";

export const SEGMENT_LABELS: Record<CustomerSegment, string> = {
  NEW: "New",
  ONE_TIME: "One-time",
  REPEAT: "Repeat",
  HIGH_VALUE: "High value",
};

export const SORT_LABELS: Record<CustomerSort, string> = {
  newest: "Newest",
  lifetime_value: "Lifetime value",
  orders: "Orders",
  last_order: "Last order",
  name: "Name (A–Z)",
};

/** Mark keys match the `.mark_*` classes in customers.module.css. */
export interface ChannelDisplay {
  label: string;
  mark: string;
  markClass: "facebook" | "instagram" | "whatsapp" | "web" | "tiktok" | "telegram" | "neutral";
}

const CHANNEL_DISPLAY: Record<ChannelType, ChannelDisplay> = {
  FACEBOOK_MESSENGER: { label: "Facebook", mark: "f", markClass: "facebook" },
  INSTAGRAM: { label: "Instagram", mark: "ig", markClass: "instagram" },
  WHATSAPP: { label: "WhatsApp", mark: "w", markClass: "whatsapp" },
  WEBSITE_CHAT: { label: "Web chat", mark: "www", markClass: "web" },
  TIKTOK: { label: "TikTok", mark: "tt", markClass: "tiktok" },
  TELEGRAM: { label: "Telegram", mark: "tg", markClass: "telegram" },
  EMAIL: { label: "Email", mark: "@", markClass: "neutral" },
  SMS: { label: "SMS", mark: "sms", markClass: "neutral" },
  MARKETPLACE: { label: "Marketplace", mark: "mp", markClass: "neutral" },
};

const SOURCE_DISPLAY: Record<string, ChannelDisplay> = {
  WEBSITE: { label: "Web", mark: "www", markClass: "web" },
  SOCIAL: { label: "Social", mark: "s", markClass: "neutral" },
  IMPORT: { label: "Import", mark: "im", markClass: "neutral" },
  MANUAL: { label: "Manual", mark: "m", markClass: "neutral" },
};

/** The chat channels a customer wrote from; without any, where the record came from (its source). */
export function channelsOf(c: Pick<CustomerListItem, "channels" | "source">): ChannelDisplay[] {
  if (c.channels?.length) return c.channels.map((ch) => CHANNEL_DISPLAY[ch] ?? SOURCE_DISPLAY.SOCIAL);
  return [SOURCE_DISPLAY[c.source] ?? SOURCE_DISPLAY.MANUAL];
}

/** First and last name, leaving out placeholder last names ("-", "Customer" filled in when none was given). */
export function displayName(c: Pick<CustomerListItem, "first_name" | "last_name">): string {
  const last = (c.last_name ?? "").trim();
  const parts = [(c.first_name ?? "").trim(), last === "-" || last === "Customer" ? "" : last];
  return parts.filter(Boolean).join(" ") || "Unnamed customer";
}

export function initialsOf(name: string): string {
  const letters = name
    .replace(/\(.*?\)/g, " ")
    .split(/\s+/)
    .filter((p) => /[\p{L}\p{N}]/u.test(p))
    .slice(0, 2)
    .map((p) => (p.match(/[\p{L}\p{N}]/u)?.[0] ?? "").toUpperCase());
  return letters.join("") || "?";
}

/** One of four token tints, stable per customer id. */
export function tintOf(id: string): 0 | 1 | 2 | 3 {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 4) as 0 | 1 | 2 | 3;
}

export function formatTaka(amount: number | undefined): string {
  return `৳${Math.round(amount ?? 0).toLocaleString("en-IN")}`;
}

export function districtOf(c: Pick<CustomerListItem, "addresses">): string | undefined {
  const list = c.addresses ?? [];
  return (list.find((a) => a.is_default) ?? list[0])?.district || undefined;
}

export function relativeTime(iso: string | undefined, now = Date.now()): string | undefined {
  if (!iso) return undefined;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return undefined;
  const days = Math.floor((now - t) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} ${Math.floor(days / 7) === 1 ? "week" : "weeks"} ago`;
  if (days < 365) return `${Math.floor(days / 30)} ${Math.floor(days / 30) === 1 ? "month" : "months"} ago`;
  return `${Math.floor(days / 365)} ${Math.floor(days / 365) === 1 ? "year" : "years"} ago`;
}

export function monthYear(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

/** Digits of a phone number for tel: and wa.me links; undefined without a usable number. */
export function phoneDigits(phone: string | undefined): string | undefined {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits : undefined;
}

/** A CSV cell; a value a spreadsheet would run as a formula is prefixed with ' (phone numbers stay as they are). */
function csvCell(value: string | number | undefined): string {
  let text = value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^\+?[\d\s-]+$/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function customersCsv(rows: CustomerListItem[]): string {
  const header = ["Name", "Phone", "Email", "District", "Channel", "Segment", "Orders", "Lifetime value (BDT)", "Last order", "Customer since"];
  const lines = rows.map((c) =>
    [
      displayName(c),
      c.phone,
      c.email,
      districtOf(c),
      channelsOf(c).map((ch) => ch.label).join(" / "),
      SEGMENT_LABELS[c.segment],
      c.total_orders ?? 0,
      Math.round(c.total_spent ?? 0),
      c.last_order_at?.slice(0, 10),
      c.created_at?.slice(0, 10),
    ]
      .map(csvCell)
      .join(",")
  );
  return [header.join(","), ...lines].join("\r\n");
}
