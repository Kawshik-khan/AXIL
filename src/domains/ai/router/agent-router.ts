/**
 * CommerceOS Phase 4: Supervisor / Agent Router
 * Hybrid routing pipeline: Deterministic Rules -> Banglish Heuristics -> Lightweight LLM Classifier.
 */

import { db } from "@/infrastructure/db";
import { RequestContext } from "@/lib/context";
import {
  ClassifiedIntent,
  CanonicalIntent,
  IntentCategory,
  AgentType,
  TenantAIPolicy,
} from "@/types/ai";
import { BanglishNormalizer } from "@/domains/social/identity/banglish-normalizer";
import { modelRouter } from "@/domains/ai/providers/model-router";
import { jevClient } from "@/domains/ai/providers/jev/jev-client";

export class AgentRouter {
  /**
   * Routes customer input to the appropriate specialized agent and canonical intent.
   * Never invokes expensive LLM reasoning for trivial greetings or explicit human requests.
   */
  public static async route(
    context: RequestContext,
    conversationId: string,
    messageText: string,
    options?: { isCopilot?: boolean; forceLlm?: boolean; useJev?: boolean }
  ): Promise<ClassifiedIntent> {
    const tenantId = context.tenant.id;
    const policy = db.getAIPolicy(tenantId);
    const cleanText = messageText.trim();
    const lower = cleanText.toLowerCase();

    // 1. Check Automation Lock & Conversation Mode (Skip for operator Copilot assist)
    const conversation = db.findConversationById(tenantId, conversationId);
    if (!options?.isCopilot && conversation && (conversation.mode === "HUMAN" || conversation.automation_paused)) {
      return {
        intent: "HUMAN_REQUEST",
        category: "SYSTEM",
        confidence: 1.0,
        target_agent: "CUSTOMER_SUPPORT",
        extracted_entities: {},
        detected_language: this.detectLanguage(cleanText),
        requires_human: true,
        routing_strategy: "DETERMINISTIC_RULE",
      };
    }

    // 2. Stage 1: Deterministic Fast-Path Rules (Zero-Cost, Sub-Millisecond)
    const deterministic = this.evaluateDeterministicRules(lower, cleanText);
    if (deterministic) {
      return deterministic;
    }

    // 3. Stage 2: Lossless Banglish Analysis & Intent Heuristics
    const banglishAnalysis = BanglishNormalizer.analyze(cleanText);
    const heuristic = this.evaluateBanglishHeuristics(lower, cleanText, banglishAnalysis);
    if (heuristic && heuristic.confidence >= policy.confidence_threshold_high) {
      return heuristic;
    }

    // 4. Stage 3: Jev System One Fast Decision Engine (~15ms, parallel questions)
    if (options?.useJev !== false && !options?.forceLlm && !jevClient.isCircuitOpen()) {
      try {
        const jevRes = await jevClient.evaluate(tenantId, {
          state: [
            `Normalized Analysis: ${JSON.stringify(banglishAnalysis)}`,
            `<customer_message>${cleanText}</customer_message>`,
          ].join("\n"),
          questions: {
            target_agent: {
              type: "choice",
              options: [
                "CUSTOMER_SUPPORT",
                "SALES",
                "ORDER_ASSISTANT",
                "PRODUCT_INFO",
                "PAYMENT",
                "SHIPPING",
                "RETURNS",
              ],
              instructions: "Select the specialized agent best suited for this commerce inquiry.",
            },
            is_urgent: {
              type: "noul",
              instructions: "Does the user express immediate urgency, missing parcels, or deducted payments?",
            },
            requires_human: {
              type: "noul",
              instructions: "Is the user requesting a human manager or reporting an irate complaint?",
            },
          },
        });

        const target = (jevRes.results.target_agent?.choice as AgentType) || "CUSTOMER_SUPPORT";
        const isUrgent = (jevRes.results.is_urgent?.noul ?? 0) >= 0.8;
        const needsHuman = (jevRes.results.requires_human?.noul ?? 0) >= 0.75;
        const confidence = jevRes.results.target_agent?.confidence ?? 0.9;

        const canonical = this.resolveCanonicalIntent(target, cleanText, isUrgent);

        return {
          intent: canonical.intent,
          category: canonical.category,
          confidence,
          target_agent: target,
          extracted_entities: {
            phone_numbers: banglishAnalysis.extractedPhone ? [banglishAnalysis.extractedPhone] : undefined,
            order_numbers: banglishAnalysis.extractedOrderNumber ? [banglishAnalysis.extractedOrderNumber] : undefined,
          },
          detected_language: this.detectLanguage(cleanText),
          requires_human: needsHuman,
          routing_strategy: "JEV_SYSTEM_ONE",
        };
      } catch {
        // Fallback to Stage 4: Tier 1 Fast LLM Classifier
      }
    }

    // 5. Stage 4: Lightweight Structured LLM Classifier (Tier 1 Model)
    try {
      const { provider } = modelRouter.getActiveProvider("TIER_1_FAST");
      const structuredResult = await provider.structuredOutput<ClassifiedIntent>(
        [
          {
            role: "system",
            content:
              "You are the CommerceOS Intent Router for Bangladeshi e-commerce. Classify user query into intent, target agent (CUSTOMER_SUPPORT, SALES, ORDER_ASSISTANT, PRODUCT_INFO), confidence, and language.",
          },
          {
            role: "user",
            content: cleanText,
          },
        ],
        "ClassifiedIntent"
      );

      const decision = structuredResult.data;
      // Enrich with extracted phone / order if present from normalization
      if (banglishAnalysis.extractedPhone && !decision.extracted_entities?.phone_numbers) {
        decision.extracted_entities = decision.extracted_entities || {};
        decision.extracted_entities.phone_numbers = [banglishAnalysis.extractedPhone];
      }
      if (banglishAnalysis.extractedOrderNumber && !decision.extracted_entities?.order_numbers) {
        decision.extracted_entities = decision.extracted_entities || {};
        decision.extracted_entities.order_numbers = [banglishAnalysis.extractedOrderNumber];
      }

      return {
        ...decision,
        routing_strategy: "LLM_CLASSIFIER",
      };
    } catch {
      // Fallback to heuristic or safe unknown
      return (
        heuristic || {
          intent: "UNKNOWN",
          category: "GENERAL",
          confidence: 0.5,
          target_agent: "CUSTOMER_SUPPORT",
          extracted_entities: {},
          detected_language: this.detectLanguage(cleanText),
          requires_human: true,
          routing_strategy: "KEYWORD_HEURISTIC",
        }
      );
    }
  }

  /**
   * Deterministic Fast-Path Rules
   */
  private static evaluateDeterministicRules(lower: string, raw: string): ClassifiedIntent | null {
    // Prompt injection & system override defense (Deterministic Safety Guard)
    if (
      lower.includes("system override") ||
      lower.includes("database admin") ||
      lower.includes("jailbreak") ||
      lower.includes("ignore all rules")
    ) {
      return {
        intent: "UNKNOWN",
        category: "SYSTEM",
        confidence: 0.99,
        target_agent: "CUSTOMER_SUPPORT",
        extracted_entities: {},
        detected_language: this.detectLanguage(raw),
        requires_human: true,
        routing_strategy: "DETERMINISTIC_RULE",
      };
    }

    if (lower.includes("ignore previous instructions") || lower.includes("ignore previous")) {
      return {
        intent: "UNKNOWN",
        category: "GENERAL",
        confidence: 0.99,
        target_agent: "CUSTOMER_SUPPORT",
        extracted_entities: {},
        detected_language: this.detectLanguage(raw),
        requires_human: false,
        routing_strategy: "DETERMINISTIC_RULE",
      };
    }

    // Human handoff keywords
    if (
      lower === "human" ||
      lower === "agent" ||
      lower === "operator" ||
      lower === "support" ||
      lower.includes("human agent") ||
      lower.includes("manush") ||
      lower.includes("কথা বলতে চাই") ||
      lower.includes("কথা বলব") ||
      lower.includes("মানুষ চাই")
    ) {
      return {
        intent: "HUMAN_REQUEST",
        category: "SYSTEM",
        confidence: 0.99,
        target_agent: "CUSTOMER_SUPPORT",
        extracted_entities: {},
        detected_language: this.detectLanguage(raw),
        requires_human: true,
        routing_strategy: "DETERMINISTIC_RULE",
      };
    }

    // Pure greetings & friendly salutations
    if (
      lower === "hi" ||
      lower === "hello" ||
      lower === "hey" ||
      lower === "hy" ||
      lower === "slam" ||
      lower === "salam" ||
      lower.startsWith("assalamu") ||
      lower.startsWith("salam") ||
      lower.startsWith("hello") ||
      lower.startsWith("hi ") ||
      lower.startsWith("hey ") ||
      lower.includes("assalamu alaikum") ||
      lower.includes("assalamualikum") ||
      lower === "সালাম" ||
      lower === "হ্যালো" ||
      lower === "হাই" ||
      lower.startsWith("সালাম")
    ) {
      return {
        intent: "GREETING",
        category: "GENERAL",
        confidence: 0.99,
        target_agent: "CUSTOMER_SUPPORT",
        extracted_entities: {},
        detected_language: this.detectLanguage(raw),
        requires_human: false,
        routing_strategy: "DETERMINISTIC_RULE",
      };
    }

    // Gratitude / Thanks
    if (
      lower === "thanks" ||
      lower === "thank you" ||
      lower === "thx" ||
      lower === "dhonnobad" ||
      lower === "ধন্যবাদ"
    ) {
      return {
        intent: "THANKS",
        category: "GENERAL",
        confidence: 0.98,
        target_agent: "CUSTOMER_SUPPORT",
        extracted_entities: {},
        detected_language: this.detectLanguage(raw),
        requires_human: false,
        routing_strategy: "DETERMINISTIC_RULE",
      };
    }

    return null;
  }

  /**
   * Banglish & Domain Intent Heuristics
   */
  private static evaluateBanglishHeuristics(
    lower: string,
    raw: string,
    analysis: ReturnType<typeof BanglishNormalizer.analyze>
  ): ClassifiedIntent | null {
    const language = this.detectLanguage(raw);

    // 1. Order Status Tracking
    const hasOrderIdentifier =
      analysis.extractedOrderNumber ||
      /COM-2026-\d+/i.test(raw) ||
      /ORD-\d+/i.test(raw) ||
      /#\d{3,}/i.test(raw);

    if (
      hasOrderIdentifier ||
      lower.includes("order kothay") ||
      lower.includes("order status") ||
      lower.includes("parcel kothay") ||
      lower.includes("কখন পাব") ||
      lower.includes("অর্ডার কোথায়") ||
      lower.includes("কুরিয়ার")
    ) {
      const orderMatches = raw.match(/COM-2026-\d+/i) || raw.match(/ORD-\d+/i) || raw.match(/#\d{3,}/i);
      return {
        intent: "ORDER_STATUS",
        category: "ORDER",
        confidence: hasOrderIdentifier ? 0.96 : 0.88,
        target_agent: "ORDER_ASSISTANT",
        extracted_entities: {
          order_numbers: orderMatches ? [orderMatches[0].replace("#", "")] : [],
        },
        detected_language: language,
        requires_human: false,
        routing_strategy: "KEYWORD_HEURISTIC",
      };
    }

    // 2. Order Cancellation
    if (
      lower.includes("cancel") ||
      lower.includes("বাতিল") ||
      lower.includes("bondho korte chai") ||
      lower.includes("bad dite chai")
    ) {
      return {
        intent: "ORDER_CANCELLATION",
        category: "ORDER",
        confidence: 0.92,
        target_agent: "ORDER_ASSISTANT",
        extracted_entities: {},
        detected_language: language,
        requires_human: false,
        routing_strategy: "KEYWORD_HEURISTIC",
      };
    }

    // 3. Payment Issues / Verification
    if (
      lower.includes("taka kete") ||
      lower.includes("টাকা কেটে") ||
      lower.includes("payment failed") ||
      lower.includes("bkash payment") ||
      lower.includes("টাকা দিয়েছি") ||
      ((lower.includes("bkash") || lower.includes("nagad")) && (lower.includes("transfer") || lower.includes("send") || lower.includes("pay") || lower.includes("taka") || lower.includes("bdt"))) ||
      (lower.includes("transfer") && (lower.includes("bdt") || lower.includes("taka")))
    ) {
      return {
        intent: "PAYMENT_FAILURE",
        category: "PAYMENT",
        confidence: 0.94,
        target_agent: "CUSTOMER_SUPPORT",
        extracted_entities: {},
        detected_language: language,
        requires_human: true, // Payment discrepancies require human assistance
        routing_strategy: "KEYWORD_HEURISTIC",
      };
    }

    // 4. Return Policy & Refund
    if (
      lower.includes("return") ||
      lower.includes("রিটার্ন") ||
      lower.includes("ferot") ||
      lower.includes("ফেরত") ||
      lower.includes("refund")
    ) {
      return {
        intent: "RETURN_POLICY",
        category: "RETURN",
        confidence: 0.93,
        target_agent: "CUSTOMER_SUPPORT",
        extracted_entities: {},
        detected_language: language,
        requires_human: false,
        routing_strategy: "KEYWORD_HEURISTIC",
      };
    }

    // 5. Shipping Cost & Delivery
    if (
      lower.includes("delivery charge") ||
      lower.includes("ডেলিভারি চার্জ") ||
      lower.includes("inside dhaka") ||
      lower.includes("outside dhaka") ||
      lower.includes("ঢাকার বাইরে") ||
      lower.includes("ঢাকার ভিতরে") ||
      lower.includes("shipping cost")
    ) {
      const isOutside = lower.includes("outside") || lower.includes("বাইরে");
      return {
        intent: "SHIPPING_COST",
        category: "SHIPPING",
        confidence: 0.94,
        target_agent: "CUSTOMER_SUPPORT",
        extracted_entities: {
          delivery_locations: [isOutside ? "OUTSIDE_DHAKA" : "INSIDE_DHAKA"],
        },
        detected_language: language,
        requires_human: false,
        routing_strategy: "KEYWORD_HEURISTIC",
      };
    }

    // 6. Wholesale & Buying Intent
    if (
      lower.includes("wholesale") ||
      lower.includes("পাইকারি") ||
      lower.includes("100 piece") ||
      lower.includes("১০০ পিস") ||
      lower.includes("bulk")
    ) {
      return {
        intent: "WHOLESALE_REQUEST",
        category: "SALES",
        confidence: 0.95,
        target_agent: "SALES",
        extracted_entities: {
          quantities: [100],
        },
        detected_language: language,
        requires_human: false,
        routing_strategy: "KEYWORD_HEURISTIC",
      };
    }

    // 7. Product Availability & Sizing
    if (
      lower.includes("available") ||
      lower.includes("stock") ||
      lower.includes("ase") ||
      lower.includes("achhe") ||
      lower.includes("আছে") ||
      lower.includes("সাইজ") ||
      lower.includes("size")
    ) {
      const sizeMatch = raw.match(/\b(XS|S|M|L|XL|XXL|XXXL|38|39|40|41|42|43|44|৪২|৪০)\b/i);
      return {
        intent: "PRODUCT_AVAILABILITY",
        category: "PRODUCT",
        confidence: 0.93,
        target_agent: "SALES",
        extracted_entities: {
          variant_attributes: sizeMatch ? { size: sizeMatch[0].toUpperCase() } : {},
        },
        detected_language: language,
        requires_human: false,
        routing_strategy: "KEYWORD_HEURISTIC",
      };
    }

    // 8. Product Price Query
    if (
      lower.includes("price") ||
      lower.includes("dam") ||
      lower.includes("daam") ||
      lower.includes("koto") ||
      lower.includes("দাম") ||
      lower.includes("কত")
    ) {
      return {
        intent: "PRODUCT_PRICE",
        category: "PRODUCT",
        confidence: 0.92,
        target_agent: "SALES",
        extracted_entities: {},
        detected_language: language,
        requires_human: false,
        routing_strategy: "KEYWORD_HEURISTIC",
      };
    }

    return null;
  }

  /**
   * Resolves canonical intent and category from target agent and customer text
   */
  private static resolveCanonicalIntent(
    agent: AgentType,
    text: string,
    isUrgent: boolean
  ): { intent: CanonicalIntent; category: IntentCategory } {
    const lower = text.toLowerCase();
    switch (agent) {
      case "SALES":
        if (
          lower.includes("price") ||
          lower.includes("dam") ||
          lower.includes("daam") ||
          lower.includes("koto") ||
          lower.includes("দাম") ||
          lower.includes("কত")
        ) {
          return { intent: "PRODUCT_PRICE", category: "PRODUCT" };
        }
        if (lower.includes("wholesale") || lower.includes("পাইকারি")) {
          return { intent: "WHOLESALE_REQUEST", category: "SALES" };
        }
        if (
          lower.includes("available") ||
          lower.includes("stock") ||
          lower.includes("ase") ||
          lower.includes("achhe") ||
          lower.includes("আছে") ||
          lower.includes("size")
        ) {
          return { intent: "PRODUCT_AVAILABILITY", category: "PRODUCT" };
        }
        return { intent: "PURCHASE_INTENT", category: "SALES" };
      case "ORDER_ASSISTANT":
        if (lower.includes("cancel") || lower.includes("বাতিল")) {
          return { intent: "ORDER_CANCELLATION", category: "ORDER" };
        }
        return { intent: "ORDER_STATUS", category: "ORDER" };
      case "PAYMENT":
        if (
          isUrgent ||
          lower.includes("failed") ||
          lower.includes("kat") ||
          lower.includes("কাটা") ||
          lower.includes("error")
        ) {
          return { intent: "PAYMENT_FAILURE", category: "PAYMENT" };
        }
        return { intent: "PAYMENT_STATUS", category: "PAYMENT" };
      case "SHIPPING":
        if (
          lower.includes("charge") ||
          lower.includes("koto") ||
          lower.includes("cost") ||
          lower.includes("কত")
        ) {
          return { intent: "SHIPPING_COST", category: "SHIPPING" };
        }
        return { intent: "SHIPPING_STATUS", category: "SHIPPING" };
      case "RETURNS":
        return { intent: "RETURN_REQUEST", category: "RETURN" };
      case "PRODUCT_INFO":
        return { intent: "PRODUCT_INFORMATION", category: "PRODUCT" };
      default:
        return { intent: "CUSTOMER_SUPPORT", category: "CUSTOMER" };
    }
  }

  /**
   * Helper to detect language
   */
  private static detectLanguage(text: string): "bn" | "en" | "banglish" | "mixed" {
    const hasBangla = /[\u0980-\u09FF]/.test(text);
    const hasEnglishLetters = /[a-zA-Z]/.test(text);
    const hasBanglishWords = /\b(vai|bhai|koto|dam|daam|ache|achhe|ase|korte|chai|hobey|hobe|pabo|kobe|taka|ferot|khujchi)\b/i.test(text);

    if (hasBangla && hasEnglishLetters) return "mixed";
    if (hasBangla) return "bn";
    if (hasBanglishWords) return "banglish";
    return "en";
  }
}
