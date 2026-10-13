import crypto from "crypto";

/**
 * Normalizes Bangladeshi and international phone numbers to canonical E.164 (+880...)
 * Guarantees that variants like 01712345678, +8801712345678, 8801712345678, and formatted
 * strings like "01712-345 678" resolve to the identical canonical representation.
 */
export function normalizePhoneNumber(rawPhone: string): string {
  if (!rawPhone) return "";
  const cleaned = rawPhone.replace(/[\s\-()]/g, "");
  if (cleaned.startsWith("+880")) return cleaned;
  if (cleaned.startsWith("880")) return `+${cleaned}`;
  if (cleaned.startsWith("0")) return `+88${cleaned}`;
  if (cleaned.length === 10 && cleaned.startsWith("1")) return `+880${cleaned}`;
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

/**
 * Resolves the platform secret pepper for hashing phone numbers.
 * Uses RTO_PEPPER_SECRET if explicitly configured; otherwise deterministically derives
 * a 256-bit pepper from CREDENTIALS_ENCRYPTION_KEY using HMAC domain separation.
 */
function getRtoPepper(): string {
  const custom = process.env.RTO_PEPPER_SECRET;
  if (custom && custom.length >= 32) {
    return custom;
  }
  const fallback = process.env.CREDENTIALS_ENCRYPTION_KEY || (process.env.NODE_ENV === "test" ? "test-only-credentials-key-48-chars-padding-xxxx" : "");
  if (fallback) {
    return crypto.createHmac("sha256", fallback).update("commerceos:rto:pepper:v1").digest("hex");
  }
  return "test-only-rto-pepper-secret-48-chars-padding-xxxxxx";
}

/**
 * Computes an irreversible HMAC-SHA256 hash for phone reputation scoring.
 * Strict Tenant Isolation: raw phone numbers are NEVER stored or queried across tenants.
 */
export function hashPhoneForReputation(rawPhone: string): string {
  const normalized = normalizePhoneNumber(rawPhone);
  if (!normalized) return "";
  const pepper = getRtoPepper();
  return crypto.createHmac("sha256", pepper).update(normalized).digest("hex");
}
