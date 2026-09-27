/**
 * CommerceOS Phase 4: Bangladesh Cash-on-Delivery (COD) & RTO Risk Engine
 * Uses Jev System One to assess doorstep refusal risk for Bangladeshi retail.
 * Enforces bKash advance fee for high-risk Outside Dhaka orders per BANGLADESH_COMMERCE.md.
 */

import { jevClient } from "@/domains/ai/providers/jev/jev-client";

export interface RtoRiskAssessment {
  riskScore: number; // 0.0 - 1.0
  recommendation: "AUTO_CONFIRM_COD" | "REQUIRE_BKASH_ADVANCE" | "FLAG_FOR_CALL_VERIFICATION";
  advanceFeeBdt?: number;
  reason: string;
  evaluatedAt: string;
}

export interface OrderRiskContext {
  deliveryZone: "INSIDE_DHAKA" | "OUTSIDE_DHAKA";
  grandTotalBdt: number;
  customerAddress: string;
  pastOrdersCount: number;
  pastRtoCount: number;
  chatTranscript: string;
}

export class RtoRiskEngine {
  /**
   * Assesses customer COD risk before parcel dispatch or courier booking
   */
  public static async assessOrderRisk(
    tenantId: string,
    orderContext: OrderRiskContext
  ): Promise<RtoRiskAssessment> {
    const evaluatedAt = new Date().toISOString();

    if (jevClient.isCircuitOpen()) {
      // Conservative fallback
      const isOutside = orderContext.deliveryZone === "OUTSIDE_DHAKA";
      return {
        riskScore: isOutside ? 0.6 : 0.2,
        recommendation: isOutside ? "REQUIRE_BKASH_ADVANCE" : "AUTO_CONFIRM_COD",
        advanceFeeBdt: isOutside ? 150 : undefined,
        reason: "Jev offline: standard geographical rule applied.",
        evaluatedAt,
      };
    }

    try {
      const res = await jevClient.evaluate(tenantId, {
        state: [
          `Delivery Zone: ${orderContext.deliveryZone}, Grand Total: ${orderContext.grandTotalBdt} BDT`,
          `Customer History: ${orderContext.pastOrdersCount} past orders, ${orderContext.pastRtoCount} RTO returns`,
          `Address: "${orderContext.customerAddress}"`,
          `<customer_message>${orderContext.chatTranscript}</customer_message>`,
        ].join("\n"),
        questions: {
          rto_risk: {
            type: "noul",
            instructions: "Is there high probability the customer will refuse parcel delivery at the doorstep?",
          },
          address_vagueness: {
            type: "score",
            levels: ["SPECIFIC_HOUSE_ROAD", "GENERAL_AREA", "VAGUE_DISTRICT_ONLY"],
            instructions: "Evaluate address precision for courier delivery.",
          },
        },
      });

      const rtoProb = res.results.rto_risk?.noul ?? 0.2;
      const addressVagueness = res.results.address_vagueness?.score ?? 0;

      // Rule 1: Outside Dhaka with high risk or vague address -> require bKash advance delivery fee
      if (orderContext.deliveryZone === "OUTSIDE_DHAKA" && (rtoProb > 0.6 || addressVagueness > 1.5)) {
        return {
          riskScore: rtoProb,
          recommendation: "REQUIRE_BKASH_ADVANCE",
          advanceFeeBdt: 150,
          reason: "High RTO risk outside Dhaka. Require 150 BDT bKash advance delivery fee.",
          evaluatedAt,
        };
      }

      // Rule 2: Moderate hesitation or prior return history -> flag for phone call verification
      if (rtoProb > 0.45 || orderContext.pastRtoCount > 0) {
        return {
          riskScore: rtoProb,
          recommendation: "FLAG_FOR_CALL_VERIFICATION",
          reason: "Moderate hesitation or prior return history detected. Verify customer by phone.",
          evaluatedAt,
        };
      }

      // Rule 3: Safe profile -> auto confirm COD
      return {
        riskScore: rtoProb,
        recommendation: "AUTO_CONFIRM_COD",
        reason: "Safe customer profile. Immediate courier dispatch permitted.",
        evaluatedAt,
      };
    } catch {
      // Conservative heuristic fallback
      const isOutside = orderContext.deliveryZone === "OUTSIDE_DHAKA";
      return {
        riskScore: isOutside ? 0.6 : 0.2,
        recommendation: isOutside ? "REQUIRE_BKASH_ADVANCE" : "AUTO_CONFIRM_COD",
        advanceFeeBdt: isOutside ? 150 : undefined,
        reason: "Fallback rule applied.",
        evaluatedAt,
      };
    }
  }
}
