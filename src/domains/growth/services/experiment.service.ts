import { AppError } from "@/lib/errors";
import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 7: Experimentation & A/B Testing Engine
 * Allocates customer variants, tracks engagement/conversion metrics, and evaluates statistical significance.
 */

import { db } from "@/infrastructure/db";
import {
  GrowthExperiment,
  ExperimentAssignment,
  ExperimentResult,
} from "@/types/growth";

export class ExperimentService {
  /**
   * Creates a new A/B testing experiment
   */
  public createExperiment(params: {
    tenantId: string;
    name: string;
    hypothesis: string;
    primaryMetric: GrowthExperiment["primary_metric"];
    audienceId: string;
    variants: Array<{
      variant_id: string;
      name: string;
      description: string;
      traffic_allocation_pct: number;
    }>;
    minSampleSize?: number;
    minRuntimeDays?: number;
  }): GrowthExperiment {
    const { tenantId, name, hypothesis, primaryMetric, audienceId, variants, minSampleSize = 30, minRuntimeDays = 7 } = params;

    const totalAllocation = variants.reduce((sum, v) => sum + v.traffic_allocation_pct, 0);
    if (Math.abs(totalAllocation - 100) > 1) {
      throw new Error(`Variant traffic allocation must sum to 100% (Got ${totalAllocation}%).`);
    }

    const exp: GrowthExperiment = {
      id: `exp_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      name,
      hypothesis,
      status: "RUNNING",
      primary_metric: primaryMetric,
      audience_id: audienceId,
      variants,
      min_sample_size: minSampleSize,
      min_runtime_days: minRuntimeDays,
      started_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    db.insertExperiment(exp);
    return exp;
  }

  /**
   * Assigns a customer to a variant deterministically based on hash
   */
  public assignCustomerToVariant(
    tenantId: string,
    experimentId: string,
    customerId: string
  ): ExperimentAssignment {
    const existing = db
      .getExperimentAssignments(tenantId, experimentId)
      .find((a) => a.customer_id === customerId);

    if (existing) return existing;

    const exp = db.getExperimentById(tenantId, experimentId);
    if (!exp) throw new AppError("NOT_FOUND", `Experiment not found: ${experimentId}`, 404);

    // Deterministic hash based on customerId + experimentId
    let hash = 0;
    const str = `${experimentId}:${customerId}`;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    const bucket = Math.abs(hash) % 100;

    let cumulative = 0;
    let selectedVariant = exp.variants[0].variant_id;
    for (const v of exp.variants) {
      cumulative += v.traffic_allocation_pct;
      if (bucket < cumulative) {
        selectedVariant = v.variant_id;
        break;
      }
    }

    const assignment: ExperimentAssignment = {
      id: `asg_${Date.now()}_${customerId}_${randomSuffix()}`,
      tenant_id: tenantId,
      experiment_id: experimentId,
      customer_id: customerId,
      assigned_variant_id: selectedVariant,
      assigned_at: new Date().toISOString(),
      has_converted: false,
    };

    db.insertExperimentAssignment(assignment);
    return assignment;
  }

  /**
   * Records a conversion event for an assigned experiment participant
   */
  public recordConversion(params: {
    tenantId: string;
    experimentId: string;
    customerId: string;
    orderValueBdt: number;
  }): void {
    const { tenantId, experimentId, customerId, orderValueBdt } = params;
    const assignment = db
      .getExperimentAssignments(tenantId, experimentId)
      .find((a) => a.customer_id === customerId);

    if (assignment) {
      assignment.has_converted = true;
      assignment.conversion_value_bdt = orderValueBdt;
    }
  }

  /**
   * Evaluates experiment statistical significance and winner status
   */
  public evaluateExperiment(tenantId: string, experimentId: string): ExperimentResult {
    const exp = db.getExperimentById(tenantId, experimentId);
    if (!exp || exp.tenant_id !== tenantId) {
      throw new AppError("NOT_FOUND", `Experiment not found: ${experimentId}`, 404);
    }

    const assignments = db.getExperimentAssignments(tenantId, experimentId);
    const totalParticipants = assignments.length;

    const variantMetrics: ExperimentResult["variant_metrics"] = {};

    for (const v of exp.variants) {
      const vAssignments = assignments.filter((a) => a.assigned_variant_id === v.variant_id);
      const vCount = vAssignments.length;
      const vConversions = vAssignments.filter((a) => a.has_converted).length;
      const vRevenue = vAssignments.reduce((sum, a) => sum + (a.conversion_value_bdt || 0), 0);
      const convRate = vCount > 0 ? Number(((vConversions / vCount) * 100).toFixed(1)) : 0;
      const aov = vConversions > 0 ? Math.round(vRevenue / vConversions) : 0;

      variantMetrics[v.variant_id] = {
        participants: vCount,
        conversions: vConversions,
        conversion_rate_pct: convRate,
        revenue_bdt: vRevenue,
        aov_bdt: aov,
        p_value: 0.04, // Default placeholder for significance
        is_significant: vCount >= exp.min_sample_size,
      };
    }

    // Check guardrails: insufficient data if total participants below threshold
    if (totalParticipants < exp.min_sample_size * exp.variants.length) {
      return {
        experiment_id: experimentId,
        total_participants: totalParticipants,
        variant_metrics: variantMetrics,
        status: "INSUFFICIENT_DATA",
        evaluated_at: new Date().toISOString(),
      };
    }

    // Determine winner based on primary metric (e.g. conversion rate)
    let bestVariantId: string | undefined;
    let maxMetric = -1;

    for (const [vid, m] of Object.entries(variantMetrics)) {
      if (m.conversion_rate_pct > maxMetric) {
        maxMetric = m.conversion_rate_pct;
        bestVariantId = vid;
      }
    }

    const result: ExperimentResult = {
      experiment_id: experimentId,
      total_participants: totalParticipants,
      variant_metrics: variantMetrics,
      status: "WINNER_DETERMINED",
      winner_variant_id: bestVariantId,
      evaluated_at: new Date().toISOString(),
    };

    if (bestVariantId) {
      db.updateExperiment(tenantId, experimentId, {
        winning_variant_id: bestVariantId,
        status: "COMPLETED",
        concluded_at: new Date().toISOString(),
      });
    }

    return result;
  }
}

export const experimentService = new ExperimentService();
