/**
 * CommerceOS Phase 4: Mock Jev System One Provider
 * High-fidelity, offline, deterministic System 1 decision engine.
 * Evaluates Choice, Score, and Noul questions in parallel with zero external API dependencies.
 */

import {
  JevEvaluateRequest,
  JevEvaluateResponse,
  JevQuestionResult,
  JevQuestionDefinition,
} from "@/types/ai";

export class MockJevProvider {
  private forceError = false;
  private latencyMs = 12;

  public setForceError(force: boolean): void {
    this.forceError = force;
  }

  public setLatency(ms: number): void {
    this.latencyMs = ms;
  }

  public async evaluate(request: JevEvaluateRequest): Promise<JevEvaluateResponse> {
    if (this.forceError) {
      throw new Error("JEV_SIMULATED_FAILURE: TypeSafe AI provider unreachable");
    }

    const startTime = Date.now();
    const stateText = request.state.toLowerCase();
    const results: Record<string, JevQuestionResult> = {};

    for (const [key, q] of Object.entries(request.questions)) {
      const question = q as JevQuestionDefinition;
      if (question.type === "choice") {
        results[key] = this.evaluateChoice(key, question.options, stateText);
      } else if (question.type === "score") {
        results[key] = this.evaluateScore(key, question.levels, stateText);
      } else if (question.type === "noul") {
        results[key] = this.evaluateNoul(key, stateText);
      }
    }

    return {
      results,
      latency_ms: this.latencyMs,
      tokens_evaluated: stateText.split(/\s+/).length + Object.keys(request.questions).length * 4,
    };
  }

  private evaluateChoice(key: string, options: string[], state: string): JevQuestionResult {
    // 1. Agent Target Decision
    if (key.includes("target") || key.includes("agent")) {
      if (
        state.includes("human") ||
        state.includes("agent") ||
        state.includes("operator") ||
        state.includes("manush") ||
        state.includes("manus")
      ) {
        return {
          type: "choice",
          choice: options.includes("CUSTOMER_SUPPORT") ? "CUSTOMER_SUPPORT" : options[0],
          confidence: 0.98,
        };
      }
      if (
        state.includes("bkash") ||
        state.includes("nagad") ||
        state.includes("payment") ||
        state.includes("taka kete") ||
        state.includes("failed") ||
        state.includes("পেমেন্ট")
      ) {
        return {
          type: "choice",
          choice: options.includes("PAYMENT") ? "PAYMENT" : options[0],
          confidence: 0.96,
        };
      }
      if (
        state.includes("order") ||
        state.includes("tracking") ||
        state.includes("kothay") ||
        state.includes("com-") ||
        state.includes("ord-") ||
        state.includes("পার্সেল") ||
        state.includes("অর্ডার")
      ) {
        return {
          type: "choice",
          choice: options.includes("ORDER_ASSISTANT") ? "ORDER_ASSISTANT" : options[0],
          confidence: 0.97,
        };
      }
      if (
        state.includes("price") ||
        state.includes("dam") ||
        state.includes("koto") ||
        state.includes("discount") ||
        state.includes("offer") ||
        state.includes("buy") ||
        state.includes("kinbo") ||
        state.includes("দাম")
      ) {
        return {
          type: "choice",
          choice: options.includes("SALES") ? "SALES" : options[0],
          confidence: 0.95,
        };
      }
      if (
        state.includes("delivery") ||
        state.includes("charge") ||
        state.includes("courier") ||
        state.includes("dhaka") ||
        state.includes("ডেলিভারি")
      ) {
        return {
          type: "choice",
          choice: options.includes("SHIPPING") ? "SHIPPING" : options[0],
          confidence: 0.94,
        };
      }
      if (
        state.includes("return") ||
        state.includes("refund") ||
        state.includes("exchange") ||
        state.includes("ferot") ||
        state.includes("ফেরত")
      ) {
        return {
          type: "choice",
          choice: options.includes("RETURNS") ? "RETURNS" : options[0],
          confidence: 0.95,
        };
      }

      // Default customer support
      return {
        type: "choice",
        choice: options.includes("CUSTOMER_SUPPORT") ? "CUSTOMER_SUPPORT" : options[0],
        confidence: 0.88,
      };
    }

    // Default choice is the first matching or first option
    return {
      type: "choice",
      choice: options[0],
      confidence: 0.9,
    };
  }

  private evaluateScore(key: string, levels: string[], state: string): JevQuestionResult {
    // Financial risk evaluation
    if (key.includes("financial")) {
      if (state.includes("refund") || state.includes("cancel") || state.includes("write_off") || state.includes("5000") || state.includes("3500")) {
        return {
          type: "score",
          score: 3.0,
          confidence: 0.92,
        };
      }
      return {
        type: "score",
        score: 0.5,
        confidence: 0.95,
      };
    }

    // Address vagueness evaluation
    if (key.includes("address")) {
      const isSpecific = state.includes("road") || state.includes("house") || state.includes("sector") || state.includes("thana") || state.includes("holding");
      const isVague = state.includes("only") || (!isSpecific && (state.includes("chittagong") || state.includes("sylhet") || state.includes("rajshahi")));
      return {
        type: "score",
        score: isVague ? 2.5 : isSpecific ? 0.3 : 1.2,
        confidence: 0.91,
      };
    }

    // Frustration level
    if (key.includes("frustration")) {
      const isAngry = state.includes("case korbo") || state.includes("police") || state.includes("fraud") || state.includes("fakibaj") || state.includes("harass");
      return {
        type: "score",
        score: isAngry ? 3.0 : 0.8,
        confidence: 0.94,
      };
    }

    // Generic score: mid-level
    return {
      type: "score",
      score: levels.length / 2,
      confidence: 0.85,
    };
  }

  private evaluateNoul(key: string, state: string): JevQuestionResult {
    // Urgency check
    if (key.includes("urgent") || key.includes("urgency")) {
      const isUrgent =
        state.includes("asap") ||
        state.includes("emergency") ||
        state.includes("urgent") ||
        state.includes("taratari") ||
        state.includes("failed") ||
        state.includes("taka kete") ||
        state.includes("দয়া করে দ্রুত");
      return {
        type: "noul",
        noul: isUrgent ? 0.985 : 0.08,
        confidence: 0.95,
      };
    }

    // Human escalation check
    if (key.includes("human") || key.includes("escalat")) {
      const needsHuman =
        state.includes("human") ||
        state.includes("operator") ||
        state.includes("manush") ||
        state.includes("case korbo") ||
        state.includes("police");
      return {
        type: "noul",
        noul: needsHuman ? 0.97 : 0.05,
        confidence: 0.96,
      };
    }

    // Irreversible / destructive check
    if (key.includes("irreversible") || key.includes("destructive")) {
      const isDestructive =
        state.includes("refund") ||
        state.includes("cancel") ||
        state.includes("delete") ||
        state.includes("write_off") ||
        state.includes("hard_delete");
      return {
        type: "noul",
        noul: isDestructive ? 0.92 : 0.04,
        confidence: 0.93,
      };
    }

    // Prompt injection check
    if (key.includes("injection") || key.includes("override")) {
      const hasInjection =
        state.includes("system override") ||
        state.includes("database admin") ||
        state.includes("ignore all rules") ||
        state.includes("jailbreak") ||
        state.includes("transfer 500 bdt to my bkash");
      return {
        type: "noul",
        noul: hasInjection ? 0.999 : 0.01,
        confidence: 0.99,
      };
    }

    // RTO risk check
    if (key.includes("rto")) {
      const isHighRisk = state.includes("outside_dhaka") && (state.includes("vague") || state.includes("past_rto: 2") || state.includes("rto returns: 1"));
      return {
        type: "noul",
        noul: isHighRisk ? 0.85 : 0.15,
        confidence: 0.92,
      };
    }

    // Default neutral probability
    return {
      type: "noul",
      noul: 0.5,
      confidence: 0.8,
    };
  }
}
