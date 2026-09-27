import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 9: Enterprise AI Governance & Cost Control Service
 * Multi-entity AI budgets, token quotas, model authorization, and anomalous usage enforcement.
 */

import { db } from "@/infrastructure/db";
import { EnterpriseAIBudget, AIUsageRecord, EntityType } from "@/types/enterprise";

export class EnterpriseAiGovernanceService {
  /**
   * Configures or updates an enterprise AI budget for an entity
   */
  public setBudget(params: {
    organizationId: string;
    entityType: EntityType;
    entityId: string;
    monthlyBudgetUsd: number;
    maxTokensPerMonth: number;
    allowedModels?: string[];
    blockedTools?: string[];
  }): EnterpriseAIBudget {
    const budget: EnterpriseAIBudget = {
      id: `aibud_${params.entityType.toLowerCase()}_${params.entityId}`,
      organization_id: params.organizationId,
      entity_type: params.entityType,
      entity_id: params.entityId,
      monthly_budget_usd: params.monthlyBudgetUsd,
      monthly_spent_usd: 0,
      max_tokens_per_month: params.maxTokensPerMonth,
      tokens_consumed_month: 0,
      allowed_models: params.allowedModels || ["gemini-1.5-pro", "gemini-1.5-flash", "claude-3-5-sonnet"],
      blocked_tools: params.blockedTools || [],
      approval_required_for_tier2: true,
      status: "ACTIVE",
      updated_at: new Date().toISOString(),
    };

    return db.upsertEnterpriseAIBudget(budget);
  }

  /**
   * Verifies if an AI action or tool call is authorized within budget
   */
  public canExecute(
    orgId: string,
    entityId: string,
    estimatedCostUsd: number,
    tokens: number
  ): { allowed: boolean; reason?: string } {
    const budget = db.getEnterpriseAIBudget(orgId, entityId);
    if (!budget) {
      return { allowed: true }; // Unbounded default
    }

    if (budget.status === "RESTRICTED") {
      return { allowed: false, reason: "AI operations for this entity are restricted by enterprise policy" };
    }

    if (budget.monthly_spent_usd + estimatedCostUsd > budget.monthly_budget_usd) {
      budget.status = "EXCEEDED";
      db.upsertEnterpriseAIBudget(budget);
      return {
        allowed: false,
        reason: `Monthly AI budget exceeded ($${budget.monthly_spent_usd + estimatedCostUsd} / $${budget.monthly_budget_usd})`,
      };
    }

    if (budget.tokens_consumed_month + tokens > budget.max_tokens_per_month) {
      budget.status = "EXCEEDED";
      db.upsertEnterpriseAIBudget(budget);
      return {
        allowed: false,
        reason: `Monthly AI token quota exceeded (${budget.tokens_consumed_month + tokens} / ${budget.max_tokens_per_month})`,
      };
    }

    return { allowed: true };
  }

  /**
   * Records completed AI usage and increments entity counters
   */
  public recordUsage(params: {
    organizationId: string;
    storeId?: string;
    agentType: string;
    modelName: string;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    workflowId?: string;
  }): AIUsageRecord {
    const record: AIUsageRecord = {
      id: `aiuse_${Date.now()}_${randomSuffix()}`,
      organization_id: params.organizationId,
      store_id: params.storeId,
      agent_type: params.agentType,
      model_name: params.modelName,
      input_tokens: params.inputTokens,
      output_tokens: params.outputTokens,
      estimated_cost_usd: params.estimatedCostUsd,
      workflow_id: params.workflowId,
      timestamp: new Date().toISOString(),
    };

    db.createAIUsageRecord(record);

    if (params.storeId) {
      const budget = db.getEnterpriseAIBudget(params.organizationId, params.storeId);
      if (budget) {
        budget.monthly_spent_usd += params.estimatedCostUsd;
        budget.tokens_consumed_month += params.inputTokens + params.outputTokens;
        db.upsertEnterpriseAIBudget(budget);
      }
    }

    return record;
  }
}

export const enterpriseAiGovernanceService = new EnterpriseAiGovernanceService();
