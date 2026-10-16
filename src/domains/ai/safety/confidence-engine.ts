/**
 * CommerceOS Phase 4: Dynamic Turn Confidence & Sentiment Scoring Engine
 * Computes a composite 0-100 confidence score and sentiment signal for conversational agent turns.
 */

export interface ConfidenceEvaluationInput {
  customerMessage: string;
  agentReply: string;
  isCatalogGrounded?: boolean;
  consecutiveUnresolvedTurns?: number;
  hasToolExecutionError?: boolean;
}

export type CustomerSentiment = "POSITIVE" | "NEUTRAL" | "FRUSTRATED" | "HOSTILE";

export interface ConfidenceEvaluationResult {
  confidenceScore: number; // 0 to 100
  sentiment: CustomerSentiment;
  penaltiesApplied: Array<{ reason: string; deduction: number }>;
  requiresEscalation: boolean;
  escalationReason?: string;
}

export class ConfidenceEngine {
  private static readonly HOSTILE_KEYWORDS = [
    /\b(?:scam|scammer|dhoka|dhokabaaj|chor|chura|police|cheat)\b/i,
    /(?:প্রতারক|বাটপার|চোর|মামলা|চিটার)/u,
  ];

  private static readonly FRUSTRATED_KEYWORDS = [
    /\b(?:faltu|kharap|baje|vul\s*bal|bekar|ghonta|hate|angry|worst)\b/i,
    /(?:ফালতু|খারাপ|বাজে|ভুলভাল|জঘন্য|রাগ)/u,
  ];

  private static readonly POSITIVE_KEYWORDS = [
    /\b(?:thanks|dhonnobad|thank\s*you|great|valoi|good|shundor)\b/i,
    /(?:ধন্যবাদ|ভালো|সুন্দর|থ্যাঙ্কস)/u,
  ];

  private static readonly AMBIGUITY_INDICATORS = [
    /\b(?:janina|bujhina|maybe|hoi\s*to|naki|ki\s*je)\b/i,
    /(?:জানি\s*না|বুঝি\s*না|নাকি|হয়তো)/u,
  ];

  /**
   * Evaluates the sentiment of a customer message.
   */
  public static evaluateSentiment(message: string): CustomerSentiment {
    if (!message) return "NEUTRAL";

    for (const pattern of this.HOSTILE_KEYWORDS) {
      if (pattern.test(message)) return "HOSTILE";
    }

    for (const pattern of this.FRUSTRATED_KEYWORDS) {
      if (pattern.test(message)) return "FRUSTRATED";
    }

    for (const pattern of this.POSITIVE_KEYWORDS) {
      if (pattern.test(message)) return "POSITIVE";
    }

    return "NEUTRAL";
  }

  /**
   * Computes composite confidence score for an agent turn.
   */
  public static evaluate(
    input: ConfidenceEvaluationInput,
    confidenceThreshold = 75
  ): ConfidenceEvaluationResult {
    let score = 100;
    const penaltiesApplied: Array<{ reason: string; deduction: number }> = [];

    // 1. Tool / Catalog Grounding Penalty (up to -35)
    if (input.isCatalogGrounded === false) {
      const deduction = 35;
      score -= deduction;
      penaltiesApplied.push({ reason: "UNGROUNDED_CATALOG_FACT", deduction });
    }

    // 2. Tool Execution Failure Penalty (-30)
    if (input.hasToolExecutionError) {
      const deduction = 30;
      score -= deduction;
      penaltiesApplied.push({ reason: "TOOL_EXECUTION_FAILURE", deduction });
    }

    // 3. Repeated Unresolved Turns Penalty (-15 per turn beyond 1)
    const repeated = input.consecutiveUnresolvedTurns ?? 0;
    if (repeated > 1) {
      const deduction = Math.min(30, (repeated - 1) * 15);
      score -= deduction;
      penaltiesApplied.push({ reason: `REPEATED_INTENT_TURNS_${repeated}`, deduction });
    }

    // 4. Ambiguity / Indecision Penalty (-15)
    const hasAmbiguity = this.AMBIGUITY_INDICATORS.some((p) => p.test(input.customerMessage));
    if (hasAmbiguity) {
      const deduction = 15;
      score -= deduction;
      penaltiesApplied.push({ reason: "CUSTOMER_AMBIGUITY_DETECTED", deduction });
    }

    // 5. Sentiment Penalties
    const sentiment = this.evaluateSentiment(input.customerMessage);
    if (sentiment === "HOSTILE") {
      const deduction = 40;
      score -= deduction;
      penaltiesApplied.push({ reason: "HOSTILE_CUSTOMER_SENTIMENT", deduction });
    } else if (sentiment === "FRUSTRATED") {
      const deduction = 25;
      score -= deduction;
      penaltiesApplied.push({ reason: "FRUSTRATED_CUSTOMER_SENTIMENT", deduction });
    }

    // Clamp score
    const finalScore = Math.max(0, Math.min(100, score));
    const requiresEscalation = finalScore < confidenceThreshold || sentiment === "HOSTILE";

    let escalationReason: string | undefined;
    if (requiresEscalation) {
      if (sentiment === "HOSTILE") {
        escalationReason = "Hostile customer sentiment detected";
      } else if (input.isCatalogGrounded === false) {
        escalationReason = "Catalog grounding mismatch or unverified pricing claim";
      } else if (repeated > 1) {
        escalationReason = `Repeated unresolved turns (${repeated} attempts)`;
      } else {
        escalationReason = `Confidence score (${finalScore}) below threshold (${confidenceThreshold})`;
      }
    }

    return {
      confidenceScore: finalScore,
      sentiment,
      penaltiesApplied,
      requiresEscalation,
      escalationReason,
    };
  }
}
