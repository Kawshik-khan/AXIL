export interface BanglishAnalysis {
  originalText: string;
  normalizedText: string;
  detectedIntent?: "PRICE_QUERY" | "ORDER_STATUS_QUERY" | "PRODUCT_QUERY" | "RETURN_QUERY" | "PAYMENT_QUERY" | "GENERAL";
  extractedPhone?: string;
  extractedOrderNumber?: string;
}

export class BanglishNormalizer {
  /**
   * Deterministic normalization and intent extraction for Bangladeshi retail conversations
   * Never mutates original text!
   */
  public static analyze(rawText: string): BanglishAnalysis {
    if (!rawText || !rawText.trim()) {
      return { originalText: "", normalizedText: "" };
    }

    const trimmed = rawText.trim();
    const lower = trimmed.toLowerCase();

    // 1. Extract Bangladeshi phone numbers (013-019) or international (+8801...)
    const phoneRegex = /(?:\+?880\s?|0)1[3-9]\d{8}/;
    const phoneMatch = trimmed.match(phoneRegex);
    const extractedPhone = phoneMatch ? phoneMatch[0].replace(/[\s\-]/g, "") : undefined;

    // 2. Extract Order Numbers (ORD-2026-..., COM-...)
    const orderRegex = /(?:ORD|COM)-\d{4}-\d+/i;
    const orderMatch = trimmed.match(orderRegex);
    const extractedOrderNumber = orderMatch ? orderMatch[0].toUpperCase() : undefined;

    // 3. Detect Conversational Intent
    let detectedIntent: BanglishAnalysis["detectedIntent"] = undefined;

    if (
      lower.includes("price") ||
      lower.includes("dam") ||
      lower.includes("daam") ||
      lower.includes("koto") ||
      lower.includes("কত") ||
      lower.includes("দাম") ||
      lower.includes("টাকা")
    ) {
      detectedIntent = "PRICE_QUERY";
    } else if (
      lower.includes("order") ||
      lower.includes("delivery") ||
      lower.includes("kobe") ||
      lower.includes("pabo") ||
      lower.includes("tracking") ||
      lower.includes("অর্ডার") ||
      lower.includes("কবে পাব")
    ) {
      detectedIntent = "ORDER_STATUS_QUERY";
    } else if (
      lower.includes("return") ||
      lower.includes("ferot") ||
      lower.includes("change") ||
      lower.includes("damage") ||
      lower.includes("ফেরত") ||
      lower.includes("বদল")
    ) {
      detectedIntent = "RETURN_QUERY";
    } else if (
      lower.includes("bkash") ||
      lower.includes("nagad") ||
      lower.includes("payment") ||
      lower.includes("টাকা পাঠাইছি") ||
      lower.includes("পেমেন্ট")
    ) {
      detectedIntent = "PAYMENT_QUERY";
    } else if (
      lower.includes("ache") ||
      lower.includes("achhe") ||
      lower.includes("available") ||
      lower.includes("size") ||
      lower.includes("color") ||
      lower.includes("আছে")
    ) {
      detectedIntent = "PRODUCT_QUERY";
    }

    // 4. Normalized search string (lowercase with whitespace collapsed)
    const normalizedText = trimmed
      .replace(/\s+/g, " ")
      .trim();

    return {
      originalText: trimmed,
      normalizedText,
      detectedIntent,
      extractedPhone,
      extractedOrderNumber,
    };
  }
}
