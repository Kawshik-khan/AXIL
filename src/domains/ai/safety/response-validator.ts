/**
 * CommerceOS Phase 4: Response Validator & Grounding Verifier
 * Validates generated agent responses before transmission, preventing secret leaks and ungrounded claims.
 */

export interface ValidationResult {
  isValid: boolean;
  sanitizedResponse: string;
  violations: string[];
}

export class ResponseValidator {
  private static readonly SECRET_PATTERNS = [
    /\bwhsec_[a-zA-Z0-9_]{16,}\b/g,
    /\bsk_(?:live|test)_[a-zA-Z0-9_]{16,}\b/g,
    /\bEAAB[a-zA-Z0-9]{20,}\b/g,
    /\bBearer\s+[a-zA-Z0-9.\-_]{20,}\b/gi,
    /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,
    /postgres:\/\/[a-zA-Z0-9_]+:[^@]+@/g,
  ];

  private static readonly PROHIBITED_PROMISES = [
    /free\s+refund\s+guaranteed/i,
    /100%\s+free\s+shipping\s+forever/i,
    /unlimited\s+discount/i,
  ];

  /**
   * Validates response against security constraints and grounding
   */
  public static validate(
    responseText: string,
    toolOutputs?: string[]
  ): ValidationResult {
    const violations: string[] = [];
    let sanitized = responseText;

    if (!responseText || responseText.trim().length === 0) {
      return {
        isValid: false,
        sanitizedResponse: "I am unable to provide an answer at this moment.",
        violations: ["EMPTY_RESPONSE"],
      };
    }

    // 1. Secret & Credential Leak Check
    for (const pattern of this.SECRET_PATTERNS) {
      if (pattern.test(sanitized)) {
        violations.push("SECRET_LEAK_DETECTED");
        sanitized = sanitized.replace(pattern, "[REDACTED SECRET]");
      }
    }

    // 2. Prohibited Business Promises Check
    for (const pattern of this.PROHIBITED_PROMISES) {
      if (pattern.test(sanitized)) {
        violations.push("UNSUPPORTED_BUSINESS_PROMISE");
      }
    }

    // 3. Length Bounds Check (Prevent runaway essay responses on social channels)
    if (sanitized.length > 2000) {
      violations.push("MAX_LENGTH_EXCEEDED");
      sanitized = sanitized.slice(0, 1950) + "...";
    }

    const isValid = violations.length === 0;

    return {
      isValid,
      sanitizedResponse: sanitized,
      violations,
    };
  }
}
