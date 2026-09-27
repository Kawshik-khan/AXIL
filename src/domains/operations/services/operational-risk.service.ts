/**
 * CommerceOS Phase 8: Operational Risk Engine
 * Multi-factor operational risk evaluation determining safety, containment,
 * and whether human authorization is required prior to execution.
 */

import { OperationalRisk } from "@/types/operations";
import { ActionRiskLevel } from "@/types/orchestration";

export interface RiskEvaluationParams {
  actionName: string;
  financialAmountBdt?: number;
  customerCountAffected?: number;
  reversibility?: "FULLY_REVERSIBLE" | "PARTIALLY_REVERSIBLE" | "IRREVERSIBLE";
  providerReliabilityScore?: number;
  agentConfidence?: number;
}

export class OperationalRiskService {
  /**
   * Evaluates a planned operational mutation and calculates the composite risk score
   */
  public evaluateRisk(params: RiskEvaluationParams): OperationalRisk {
    const amount = params.financialAmountBdt || 0;
    const customerCount = params.customerCountAffected || 1;
    const reversibility = params.reversibility || "PARTIALLY_REVERSIBLE";
    const providerScore = params.providerReliabilityScore !== undefined ? params.providerReliabilityScore : 0.95;
    const confidence = params.agentConfidence !== undefined ? params.agentConfidence : 0.9;

    let customerImpact: OperationalRisk["customer_impact_score"] = "LOW";
    if (customerCount > 50) {
      customerImpact = "CRITICAL";
    } else if (customerCount > 10) {
      customerImpact = "HIGH";
    } else if (customerCount > 1) {
      customerImpact = "MEDIUM";
    }

    const controls: string[] = [];
    let riskLevel: ActionRiskLevel = "LOW";
    let requiresHuman = false;

    // Financial threshold rules
    if (amount > 50000) {
      riskLevel = "CRITICAL";
      requiresHuman = true;
      controls.push("Financial disbursement > ৳50,000 mandates explicit executive signoff.");
    } else if (amount > 15000) {
      riskLevel = "HIGH";
      requiresHuman = true;
      controls.push("Financial transaction > ৳15,000 requires manager authorization.");
    } else if (amount > 3000) {
      riskLevel = "MEDIUM";
    }

    // Irreversibility & Customer Impact escalation
    if (reversibility === "IRREVERSIBLE") {
      controls.push("Irreversible physical state mutation requires audit snapshot.");
      if (riskLevel === "LOW") riskLevel = "MEDIUM";
    }

    if (customerImpact === "CRITICAL" || customerImpact === "HIGH") {
      riskLevel = "HIGH";
      requiresHuman = true;
      controls.push("High customer blast radius requires human-in-the-loop review.");
    }

    if (confidence < 0.7) {
      riskLevel = "HIGH";
      requiresHuman = true;
      controls.push(`Low AI agent confidence (${Math.round(confidence * 100)}%) triggers safety approval gate.`);
    }

    return {
      action_name: params.actionName,
      financial_impact_bdt: amount,
      customer_impact_score: customerImpact,
      reversibility,
      provider_reliability_score: providerScore,
      confidence_score: confidence,
      calculated_risk_level: riskLevel,
      required_controls: controls,
      requires_human_approval: requiresHuman,
    };
  }
}

export const operationalRiskService = new OperationalRiskService();
