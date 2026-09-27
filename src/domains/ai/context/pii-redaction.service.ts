/**
 * CommerceOS Phase 4: PII Redaction Service
 * Redacts sensitive customer data before LLM dispatch without corrupting Commerce Core records.
 */

export class PIIRedactionService {
  /**
   * Redacts phone numbers, emails, and transaction credentials from raw text.
   */
  public static redactText(text: string): string {
    if (!text) return "";

    let redacted = text;

    // 1. Redact Bangladeshi Phone Numbers (+8801XXXXXXXXX or 01XXXXXXXXX)
    // Preserves prefix (e.g. 0171) and last 3 digits for operational identification
    redacted = redacted.replace(
      /(\+?880\s?|0)(1[3-9]\d)[-.\s]?(\d{4})[-.\s]?(\d{3})/g,
      (match, country, prefix, mid, last) => {
        const countryCode = country.trim() ? country.trim() : "";
        return `${countryCode}${prefix}****${last}`;
      }
    );

    // 2. Redact Email Addresses (user@example.com -> u***@example.com)
    redacted = redacted.replace(
      /\b([a-zA-Z0-9_\-.]+)@([a-zA-Z0-9_\-.]+\.[a-zA-Z]{2,5})\b/g,
      (match, name, domain) => {
        const maskedName = name.length <= 2 ? `${name[0]}*` : `${name.slice(0, 2)}***`;
        return `${maskedName}@${domain}`;
      }
    );

    // 3. Redact Credit / Debit Card Numbers (16 digits)
    redacted = redacted.replace(
      /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
      "****-****-****-****"
    );

    // 4. Redact OTPs and 4-6 digit PINs
    redacted = redacted.replace(
      /\b(?:pin|otp|password|secret)\s*[:=]?\s*(\d{4,6})\b/gi,
      "PIN: [REDACTED]"
    );

    return redacted;
  }

  /**
   * Recursively redacts strings inside arbitrary objects or arrays.
   */
  public static redactObject<T>(obj: T): T {
    if (obj === null || obj === undefined) return obj;

    if (typeof obj === "string") {
      return this.redactText(obj) as unknown as T;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.redactObject(item)) as unknown as T;
    }

    if (typeof obj === "object") {
      const copy: Record<string, any> = {};
      for (const [key, value] of Object.entries(obj)) {
        // Never redact internal IDs or dates
        if (key.endsWith("_id") || key === "id" || key.endsWith("_at")) {
          copy[key] = value;
        } else {
          copy[key] = this.redactObject(value);
        }
      }
      return copy as T;
    }

    return obj;
  }
}
