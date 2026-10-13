/**
 * Display formatters for the platform console. They format what the API returns and never invent a value:
 * `null`/`undefined` becomes the caller's "no data" text, not 0.
 */

export const NO_DATA = "No data yet";

const DHAKA = "Asia/Dhaka";

export function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined && !(typeof value === "number" && Number.isNaN(value));
}

/** Money in the currency the API reports (BDT for platform financials). */
export function formatMoney(amount: number | null | undefined, currency: string | null | undefined = "BDT"): string {
  if (!isPresent(amount)) return NO_DATA;
  const code = currency || "BDT";
  try {
    return new Intl.NumberFormat("en-BD", { style: "currency", currency: code, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${code} ${Math.round(amount).toLocaleString("en-BD")}`;
  }
}

export function formatCount(value: number | null | undefined): string {
  return isPresent(value) ? value.toLocaleString("en-BD") : NO_DATA;
}

/** A percentage the API already computed (0–100). */
export function formatPercent(value: number | null | undefined, digits = 1): string {
  return isPresent(value) ? `${value.toFixed(digits)}%` : NO_DATA;
}

/** Date and time in Bangladesh time, e.g. "12 Oct 2026, 14:05". */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return NO_DATA;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return NO_DATA;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: DHAKA,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** Clock time in Bangladesh time, e.g. "14:05". */
export function formatDhakaTime(date: Date, withSeconds = false): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: DHAKA,
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
    hour12: false,
  }).format(date);
}

/** "3 min ago", "2 h ago", "4 d ago" — relative to now. */
export function formatRelative(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return NO_DATA;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return NO_DATA;
  const seconds = Math.round((now - t) / 1000);
  if (seconds < 0) return "in the future";
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** Remaining time until `iso`, e.g. "14:59"; "expired" once past. */
export function formatCountdown(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return NO_DATA;
  const ms = Date.parse(iso) - now;
  if (Number.isNaN(ms)) return NO_DATA;
  if (ms <= 0) return "expired";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Turns an enum-ish API value into words: "PAST_DUE" → "Past due". */
export function humanize(value: string | null | undefined): string {
  if (!value) return NO_DATA;
  const words = value.replace(/[_.-]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
