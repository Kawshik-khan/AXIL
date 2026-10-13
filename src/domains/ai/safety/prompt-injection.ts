/**
 * CommerceOS Phase 4: Multilingual Prompt Injection & Jailbreak Classifier
 * Intercepts adversarial prompt injection, roleplay overrides, and jailbreak attempts across
 * English, Bangla script, and Banglish (Latin Bengali) BEFORE any model call occurs.
 */

export interface InjectionAnalysis {
  isInjection: boolean;
  matchedPatterns: string[];
  confidence: number; // 0 to 100
  recommendedAction: "BLOCK_AND_ESCALATE" | "ALLOW";
  fallbackResponse: string;
}

export class PromptInjectionClassifier {
  // English jailbreak and override patterns
  private static readonly ENGLISH_PATTERNS: RegExp[] = [
    /\b(?:system\s+prompt|system\s+override|developer\s+mode|unrestricted\s+mode)\b/i,
    /\b(?:ignore\s+(?:all\s+)?previous\s+(?:instructions|prompts|rules))\b/i,
    /\b(?:disregard\s+(?:all\s+)?prior\s+instructions)\b/i,
    /\b(?:you\s+are\s+now|act\s+as|pretend\s+to\s+be)\s+(?:an?\s+)?(?:unfiltered|unrestricted|jailbroken|dan)\b/i,
    /\b(?:bypass\s+(?:all\s+)?safety\s+filters|jailbreak\s+prompt)\b/i,
    /\b(?:reveal|print|leak|show|dump)\s+(?:your\s+)?(?:system\s+prompt|initial\s+prompt|core\s+instructions)\b/i,
    /\b(?:confirm\s+order\s+for\s+(?:0|1)\s*(?:tk|taka|bdt|dollar|usd))\b/i,
    /\b(?:grant\s+(?:100%|free|infinite|unlimited)\s+discount)\b/i,
  ];

  // Bengali script adversarial vectors
  private static readonly BANGLA_PATTERNS: RegExp[] = [
    /(?:আগের\s*সব\s*(?:নিয়ম|ইনস্ট্রাকশন|কথা)\s*(?:ভুলে\s*যাও|বাদ\s*দাও))/u,
    /(?:পূর্বের\s*(?:সব\s*)?নিয়ম\s*(?:বাতিল|বাদ\s*দাও|ভুলো))/u,
    /(?:তুমি\s*এখন\s*(?:ডেভেলপার|আনরেস্ট্রিক্টেড)\s*মোডে)/u,
    /(?:তুমি\s*এখন\s*ফ্রি\s*ডিসকাউন্ট\s*মোডে)/u,
    /(?:সিস্টেম\s*প্রম্পট\s*(?:দেখাও|বলো|ফাঁস\s*করো))/u,
    /(?:১\s*টাকায়\s*অর্ডার\s*কনফার্ম\s*করো)/u,
    /(?:ফ্রি\s*তে\s*অর্ডার\s*(?:দাও|কনফার্ম\s*করো))/u,
    /(?:সীমাহীন\s*ডিসকাউন্ট\s*দাও)/u,
  ];

  // Banglish (Latin Bengali) phonetic adversarial vectors
  private static readonly BANGLISH_PATTERNS: RegExp[] = [
    /\b(?:ager\s+shob\s+(?:vule\s+jao|bule\s+jao|bad\s+dao|dhoro\s+na))\b/i,
    /\b(?:shob\s+(?:rule|rules|instruction|instructions)\s+(?:bad|cancel|vule\s+jao))\b/i,
    /\b(?:purber\s+shob\s+(?:niyom|instruction)\s+bad)\b/i,
    /\b(?:tumi\s+ekhon\s+(?:developer\s+mode|discount\s+mode|free\s+mode))\b/i,
    /\b(?:system\s+prompt\s+(?:bolo|dekhao|dao))\b/i,
    /\b(?:1\s*taka\s*te\s*order\s*confirm\s*koro)\b/i,
    /\b(?:free\s+te\s*order\s*confirm\s*koro)\b/i,
    /\b(?:free\s+te\s*delivery\s*ar\s*product\s*confirm\s*koro)\b/i,
    /\b(?:discount\s+mode\s+on\s+koro)\b/i,
  ];

  /** Standard polite fallback in Bengali script and Banglish */
  public static readonly CANNED_FALLBACK_BANGLA =
    "দুঃখিত, আমি আপনার অনুরোধটি প্রক্রিয়া করতে পারছি না। আমাদের একজন প্রতিনিধি শীঘ্রই আপনার সাথে যোগাযোগ করবেন।";

  public static readonly CANNED_FALLBACK_BANGLISH =
    "Dukkhito, ami apnar ei onurodh ti process korte parchhi na. Amader customer representative khub shighroi apnar shathe jogajog korben.";

  /**
   * Analyzes an inbound text message for prompt injection or adversarial jailbreak intent.
   */
  public static analyze(text: string): InjectionAnalysis {
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return {
        isInjection: false,
        matchedPatterns: [],
        confidence: 0,
        recommendedAction: "ALLOW",
        fallbackResponse: "",
      };
    }

    const normalized = text.toLowerCase().trim();
    const matchedPatterns: string[] = [];

    // 1. Check English patterns
    for (const pattern of this.ENGLISH_PATTERNS) {
      if (pattern.test(normalized)) {
        matchedPatterns.push(`EN_JAILBREAK: ${pattern.source}`);
      }
    }

    // 2. Check Bengali Script patterns
    for (const pattern of this.BANGLA_PATTERNS) {
      if (pattern.test(text)) {
        matchedPatterns.push(`BN_SCRIPT_OVERRIDE: ${pattern.source}`);
      }
    }

    // 3. Check Banglish patterns
    for (const pattern of this.BANGLISH_PATTERNS) {
      if (pattern.test(normalized)) {
        matchedPatterns.push(`BANGLISH_JAILBREAK: ${pattern.source}`);
      }
    }

    const isInjection = matchedPatterns.length > 0;
    const confidence = isInjection ? Math.min(100, 80 + matchedPatterns.length * 10) : 0;

    // Determine fallback script based on input script
    const hasBengaliChars = /[\u0980-\u09FF]/.test(text);
    const fallbackResponse = isInjection
      ? hasBengaliChars
        ? this.CANNED_FALLBACK_BANGLA
        : this.CANNED_FALLBACK_BANGLISH
      : "";

    return {
      isInjection,
      matchedPatterns,
      confidence,
      recommendedAction: isInjection ? "BLOCK_AND_ESCALATE" : "ALLOW",
      fallbackResponse,
    };
  }
}
