/**
 * PII masking for stored diagnostics (FX-83, audit F25). Pure functions with no imports, so the store can use them.
 * - Phone numbers keep only their last 3 digits (`********001`): enough for staff to tell two numbers apart.
 * - Addresses keep only area, upazila and district.
 */

// Whole numbers only: never digits inside an id such as ord_1759812345678_x or a longer number
const BD_PHONE = /(?<![\p{L}\p{N}_+])(?:\+?৮৮০|\+?880|\+?88)?[0০]?[1১][3-9৩-৯](?:[\s.-]?[\d০-৯]){8}(?![\p{N}])/gu;
const toAscii = (s: string) => s.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)));

/** `01711000001` → `********001`. */
export function maskPhone(phone: string): string {
  const digits = toAscii(phone).replace(/\D/g, "");
  return digits.length <= 3 ? "***" : `${"*".repeat(8)}${digits.slice(-3)}`;
}

/** Every Bangladeshi mobile number in a text, masked to its last 3 digits. */
export function maskPhonesInText(text: string): string {
  return text.replace(BD_PHONE, (m) => maskPhone(m));
}

const PHONE_KEY = /phone|mobile|msisdn|wa_id|whatsapp/i;
const ADDRESS_KEY = /^(address|address_line\w*|street|house|road|flat|holding|delivery_address_text)$/i;
const KEEP_KEY = /^(area|upazila|district|division|city|country|postal_code|zone)$/i;

/**
 * A tool call's arguments or result as stored (FX-83): phone fields masked, street lines removed (area and district
 * stay), and any phone number inside free text masked. Ids, dates and numbers are kept.
 */
export function redactToolPayload<T>(value: T): T {
  const walk = (v: unknown, key = ""): unknown => {
    if (v === null || v === undefined) return v;
    if (typeof v === "string") {
      // Already redacted upstream (e.g. "[redacted]") stays as it is
      if (PHONE_KEY.test(key)) return toAscii(v).replace(/\D/g, "").length >= 6 ? maskPhone(v) : v;
      if (ADDRESS_KEY.test(key) && !KEEP_KEY.test(key)) return v === "[redacted]" ? v : "[address removed]";
      return maskPhonesInText(v);
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = walk(x, k);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}
