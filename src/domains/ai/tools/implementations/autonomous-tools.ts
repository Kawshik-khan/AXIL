import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 10: Autonomous Platform Tools
 * Implements 14 authoritative autonomous tools grounded in Phase 10 domain services.
 * All tool actions are authenticated, tenant-isolated, and RBAC-controlled.
 */

import { z } from "zod";
import { IAgentTool } from "../tool.interface";
import { ToolDefinition, ToolRiskLevel } from "@/types/ai";
import { ActionRiskLevel } from "@/types/orchestration";
import { RequestContext } from "@/lib/context";
import { PERMISSIONS } from "@/lib/permissions";
import {
  autonomousControlPlaneService,
  businessObjectivesService,
  globalDecisionEngineService,
  strategyEngineService,
  continuousLearningService,
  platformHealthService,
  platformEconomicsService,
  autonomousCyclesService,
} from "@/domains/autonomous/services";

// ============================================================
// 1. GET AUTONOMOUS OVERVIEW TOOL
// ============================================================
const GetAutonomousOverviewInputSchema = z.object({});

export class GetAutonomousOverviewTool implements IAgentTool<z.infer<typeof GetAutonomousOverviewInputSchema>> {
  public readonly name = "get_autonomous_overview";
  public readonly description = "Retrieve executive summary of the autonomous platform including system mode, health, active objectives, strategies, pending decisions, active workflows, and safety boundary status.";
  public readonly category = "AUTONOMOUS";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.AUTONOMOUS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = GetAutonomousOverviewInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: { type: "object", properties: {}, required: [] },
      timeout_ms: 15000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, _input: z.infer<typeof GetAutonomousOverviewInputSchema>): Promise<any> {
    const overview = autonomousControlPlaneService.getAutonomousOverview(context.tenant.id);
    return { success: true, data: overview };
  }
}

// ============================================================
// 2. GET BUSINESS OBJECTIVES TOOL
// ============================================================
const GetBusinessObjectivesInputSchema = z.object({
  status: z.enum(["PROPOSED", "ACTIVE", "AT_RISK", "PAUSED", "COMPLETED", "ABANDONED", "ALL"]).optional().default("ALL"),
  hierarchy_level: z.string().optional(),
});

export class GetBusinessObjectivesTool implements IAgentTool<z.infer<typeof GetBusinessObjectivesInputSchema>> {
  public readonly name = "get_business_objectives";
  public readonly description = "List active, completed, or at-risk business objectives across the enterprise hierarchy with progress and risk indicators.";
  public readonly category = "AUTONOMOUS";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.OBJECTIVES_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = GetBusinessObjectivesInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "Filter by status" },
          hierarchy_level: { type: "string", description: "Filter by hierarchy level" },
        },
        required: [],
      },
      timeout_ms: 15000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof GetBusinessObjectivesInputSchema>): Promise<any> {
    let objectives = businessObjectivesService.getObjectives(context.tenant.id);
    if (input.status && input.status !== "ALL") {
      objectives = objectives.filter((o) => o.status === input.status);
    }
    if (input.hierarchy_level) {
      objectives = objectives.filter((o) => o.hierarchy_level === input.hierarchy_level);
    }
    return { success: true, data: objectives, count: objectives.length };
  }
}

// ============================================================
// 3. CREATE BUSINESS OBJECTIVE TOOL
// ============================================================
const CreateBusinessObjectiveInputSchema = z.object({
  name: z.string().min(3).describe("Objective name"),
  description: z.string().describe("Detailed objective statement"),
  hierarchy_level: z.enum(["ENTERPRISE", "BUSINESS_UNIT", "BRAND", "STORE", "DOMAIN", "WORKFLOW", "AGENT_TASK"]).default("ENTERPRISE"),
  scope_entity_id: z.string().optional(),
  priority: z.number().int().min(1).max(10).default(1),
  target_metric: z.string().default("REVENUE_BDT"),
  // The merchant's numbers, never defaults: these were 10,00,000 / 5,00,000 / 50,000 (FX-30, N15)
  target_value: z.number().finite(),
  baseline_value: z.number().finite(),
  unit: z.string().default("BDT"),
  allowed_domains: z
    .array(z.enum(["COMMERCE", "OPERATIONS", "INTELLIGENCE", "GROWTH", "ENTERPRISE", "PRICING", "MARKETING", "INVENTORY", "PROCUREMENT", "FULFILLMENT", "FINANCE", "SUPPORT"]))
    .min(1)
    .default(["COMMERCE", "OPERATIONS", "INTELLIGENCE", "GROWTH", "ENTERPRISE"]),
  budget_allocated_bdt: z.number().nonnegative().default(0),
  constraints: z.array(z.object({
    type: z.enum(["BUDGET", "MARGIN", "RISK", "TIME", "INVENTORY", "APPROVAL", "POLICY", "CUSTOM"]).default("BUDGET"),
    name: z.string(),
    operator: z.enum(["MIN", "MAX", "EQUALS", "BETWEEN", "NOT_EXCEEDS"]).default("NOT_EXCEEDS"),
    value: z.number(),
    description: z.string().optional(),
  })).optional().default([]),
});

export class CreateBusinessObjectiveTool implements IAgentTool<z.infer<typeof CreateBusinessObjectiveInputSchema>> {
  public readonly name = "create_business_objective";
  public readonly description = "Define a new business objective with hierarchy assignment, target metrics, constraints, and autonomy boundaries.";
  public readonly category = "AUTONOMOUS";
  public readonly riskLevel: ToolRiskLevel = "MEDIUM_RISK";
  public readonly requiredPermission = PERMISSIONS.OBJECTIVES_MANAGE;
  public readonly requiresConfirmation = false;
  public readonly schema = CreateBusinessObjectiveInputSchema;
  public readonly idempotent = false;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Objective name" },
          description: { type: "string", description: "Detailed statement" },
          hierarchy_level: { type: "string", description: "Hierarchy tier" },
          target_value: { type: "number", description: "Target value, as stated by the merchant" },
          baseline_value: { type: "number", description: "Current or baseline value, as stated by the merchant" },
        },
        required: ["name", "description", "target_value", "baseline_value"],
      },
      timeout_ms: 15000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof CreateBusinessObjectiveInputSchema>): Promise<any> {
    const now = new Date().toISOString();
    const objective = businessObjectivesService.createObjective({
      id: `obj_${Date.now()}_${randomSuffix()}`,
      tenant_id: context.tenant.id,
      name: input.name,
      description: input.description,
      hierarchy_level: input.hierarchy_level as any,
      scope_entity_id: input.scope_entity_id,
      status: "PROPOSED", // an agent proposes; a person activates it (N15)
      target_metric: input.target_metric,
      target_value: input.target_value,
      baseline_value: input.baseline_value,
      current_value: input.baseline_value,
      unit: input.unit,
      time_horizon_start: now,
      time_horizon_end: new Date(Date.now() + 90 * 86400000).toISOString(),
      priority: input.priority,
      risk_tolerance: "MODERATE",
      budget_allocated_bdt: input.budget_allocated_bdt,
      budget_spent_bdt: 0,
      allowed_domains: input.allowed_domains,
      allowed_actions: ["OPTIMIZE_PRICING", "REBALANCE_STOCK", "TRIGGER_CAMPAIGN"],
      required_approvals: ["HIGH_RISK_PRICING", "BUDGET_OVERRUN"],
      constraints: input.constraints.map((c) => ({
        type: c.type,
        name: c.name,
        operator: c.operator,
        value: c.value,
        description: c.description,
      })),
      progress_percent: 0,
      forecast_achievement_percent: null,
      created_by: context.user.id,
      created_at: now,
      updated_at: now,
    });
    return { success: true, data: objective };
  }
}

// ============================================================
// 4. SIMULATE OBJECTIVE STRATEGY TOOL
// ============================================================
const SimulateObjectiveStrategyInputSchema = z.object({
  objective_id: z.string().describe("Target business objective ID"),
  strategy_name: z.string().describe("Strategy title to simulate"),
  parameters: z.record(z.unknown()).optional().default({}),
});

export class SimulateObjectiveStrategyTool implements IAgentTool<z.infer<typeof SimulateObjectiveStrategyInputSchema>> {
  public readonly name = "simulate_objective_strategy";
  public readonly description = "Run a non-destructive multi-agent simulation of a strategic proposal against an objective, checking constraint compliance, expected lift, and risk profile.";
  public readonly category = "AUTONOMOUS";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.STRATEGY_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = SimulateObjectiveStrategyInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: {
        type: "object",
        properties: {
          objective_id: { type: "string", description: "Objective ID" },
          strategy_name: { type: "string", description: "Strategy name" },
        },
        required: ["objective_id", "strategy_name"],
      },
      timeout_ms: 25000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof SimulateObjectiveStrategyInputSchema>): Promise<any> {
    let strategy = strategyEngineService.getStrategies(context.tenant.id).find((s) => s.objective_id === input.objective_id);
    if (!strategy) {
      strategy = strategyEngineService.createStrategy({
        id: `strat_${Date.now()}_${randomSuffix()}`,
        tenant_id: context.tenant.id,
        objective_id: input.objective_id,
        name: input.strategy_name,
        description: `Strategy formulation for ${input.strategy_name}`,
        status: "DRAFT",
        version: 1,
        domains_involved: ["COMMERCE", "OPERATIONS"],
        plan: {
          steps: [
            { order: 1, domain: "OPERATIONS", action: "AUDIT_INVENTORY", parameters: {}, depends_on: [], estimated_duration_ms: 5000 },
            { order: 2, domain: "COMMERCE", action: "ADJUST_SAFETY_STOCK", parameters: {}, depends_on: [1], estimated_duration_ms: 10000 },
          ],
          expected_duration_ms: 15000,
          estimated_cost_bdt: 20000,
        },
        constraints: [],
        created_by: context.user?.id || "strategy_agent",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    const simulation = strategyEngineService.simulateStrategy(context.tenant.id, strategy.id);
    return { success: true, data: simulation };
  }
}

// ============================================================
// 5. EVALUATE GLOBAL DECISION TOOL
// ============================================================
const EvaluateGlobalDecisionInputSchema = z.object({
  title: z.string().describe("Decision title"),
  category: z.enum(["PRICING", "INVENTORY", "PROMOTION", "FULFILLMENT", "EXPANSION", "BUDGET", "POLICY"]).default("INVENTORY"),
  objective_ids: z.array(z.string()).default([]),
  options: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    expected_impact: z.record(z.number()),
    estimated_cost_bdt: z.number().default(0),
    risk_score: z.number().default(20),
  })).min(1),
  constraints: z.array(z.string()).optional().default([]),
});

export class EvaluateGlobalDecisionTool implements IAgentTool<z.infer<typeof EvaluateGlobalDecisionInputSchema>> {
  public readonly name = "evaluate_global_decision";
  public readonly description = "Submit a cross-domain decision candidate to the Global Decision Engine for multi-objective scoring, policy verification, and risk evaluation.";
  public readonly category = "AUTONOMOUS";
  public readonly riskLevel: ToolRiskLevel = "MEDIUM_RISK";
  public readonly requiredPermission = PERMISSIONS.DECISIONS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = EvaluateGlobalDecisionInputSchema;
  public readonly idempotent = false;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Decision title" },
          category: { type: "string", description: "Decision category" },
        },
        required: ["title", "options"],
      },
      timeout_ms: 20000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof EvaluateGlobalDecisionInputSchema>): Promise<any> {
    const decisionId = `dec_${Date.now()}_${randomSuffix()}`;
    const decision = globalDecisionEngineService.createDecision({
      id: decisionId,
      tenant_id: context.tenant.id,
      category: (input.category === "PROMOTION" ? "MARKETING" : input.category) as any,
      title: input.title,
      description: input.title,
      status: "PENDING",
      risk_level: "MEDIUM" as ActionRiskLevel,
      context: {
        domains_involved: ["COMMERCE", "OPERATIONS"],
        agents_involved: ["AUTONOMOUS_SUPERVISOR", "DECISION_AGENT"],
        current_state: {},
        trigger: "TOOL_INVOCATION",
        urgency: "MEDIUM",
        evidence: [],
      },
      options: input.options.map((opt) => ({
        id: opt.id,
        name: opt.name,
        description: opt.description,
        actions: ["EXECUTE_OPTION"],
        expected_outcome: opt.expected_impact,
        estimated_cost_bdt: opt.estimated_cost_bdt,
        estimated_revenue_impact_bdt: null, // not estimated (was cost x 2.5) (FX-30)
        risk_score: opt.risk_score,
        confidence: 0.85,
        pros: ["Quick implementation"],
        cons: ["Operational attention required"],
        tradeoffs: ["Cost vs Speed"],
      })),
      constraints: input.constraints.map((c) => ({
        name: c,
        type: "POLICY" as const,
        satisfied: true,
        value: 1,
        threshold: 1,
        description: c,
      })),
      requires_approval: true,
      initiated_by: context.user?.id || "autonomous_supervisor",
      initiated_at: new Date().toISOString(),
      correlation_id: `corr_${Date.now()}_${randomSuffix()}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return { success: true, data: decision };
  }
}

// ============================================================
// 6. APPROVE AUTONOMOUS DECISION TOOL
// ============================================================
const ApproveAutonomousDecisionInputSchema = z.object({
  decision_id: z.string().describe("Global decision ID to approve"),
  selected_option_id: z.string().describe("Option ID selected for execution"),
  reason: z.string().optional().default("Approved via autonomous platform governance"),
});

export class ApproveAutonomousDecisionTool implements IAgentTool<z.infer<typeof ApproveAutonomousDecisionInputSchema>> {
  public readonly name = "approve_autonomous_decision";
  public readonly description = "Approve and transition an autonomous decision from AWAITING_APPROVAL into APPROVED state for downstream execution.";
  public readonly category = "AUTONOMOUS";
  public readonly riskLevel: ToolRiskLevel = "HIGH_RISK";
  public readonly requiredPermission = PERMISSIONS.DECISIONS_APPROVE;
  public readonly requiresConfirmation = true;
  public readonly schema = ApproveAutonomousDecisionInputSchema;
  public readonly idempotent = false;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: {
        type: "object",
        properties: {
          decision_id: { type: "string", description: "Decision ID" },
          selected_option_id: { type: "string", description: "Option ID" },
          reason: { type: "string", description: "Approval justification" },
        },
        required: ["decision_id", "selected_option_id"],
      },
      timeout_ms: 20000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof ApproveAutonomousDecisionInputSchema>): Promise<any> {
    const decision = globalDecisionEngineService.approveDecision(
      context.tenant.id,
      input.decision_id,
      context.user?.id || "admin"
    );
    return { success: true, data: decision };
  }
}

// ============================================================
// 7. GET PLATFORM HEALTH TOOL
// ============================================================
const GetPlatformHealthInputSchema = z.object({});

export class GetPlatformHealthTool implements IAgentTool<z.infer<typeof GetPlatformHealthInputSchema>> {
  public readonly name = "get_platform_health";
  public readonly description = "Retrieve system-wide health evaluation across all 11 dimensions with active incident summaries and anomaly alerts.";
  public readonly category = "AUTONOMOUS";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.AUTONOMOUS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = GetPlatformHealthInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: { type: "object", properties: {}, required: [] },
      timeout_ms: 15000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, _input: z.infer<typeof GetPlatformHealthInputSchema>): Promise<any> {
    const health = platformHealthService.getSystemHealth(context.tenant.id);
    return { success: true, data: health };
  }
}

// ============================================================
// 8. GET QUALITY SCORECARD TOOL
// ============================================================
const GetQualityScorecardInputSchema = z.object({});

export class GetQualityScorecardTool implements IAgentTool<z.infer<typeof GetQualityScorecardInputSchema>> {
  public readonly name = "get_quality_scorecard";
  public readonly description = "Retrieve the Autonomous Quality Scorecard evaluating decision accuracy, verification success, policy compliance, and rollback rates.";
  public readonly category = "AUTONOMOUS";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.AUTONOMOUS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = GetQualityScorecardInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: { type: "object", properties: {}, required: [] },
      timeout_ms: 15000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, _input: z.infer<typeof GetQualityScorecardInputSchema>): Promise<any> {
    const scorecard = platformHealthService.getQualityScorecard(context.tenant.id, "DAILY");
    return { success: true, data: scorecard };
  }
}

// ============================================================
// 9. GET PLATFORM COSTS TOOL
// ============================================================
const GetPlatformCostsInputSchema = z.object({
  period: z.enum(["HOURLY", "DAILY", "WEEKLY", "MONTHLY"]).optional().default("DAILY"),
});

export class GetPlatformCostsTool implements IAgentTool<z.infer<typeof GetPlatformCostsInputSchema>> {
  public readonly name = "get_platform_costs";
  public readonly description = "Inspect cost-aware autonomy breakdown: LLM token expenditure, tool execution cost, cost per order, and cost per decision.";
  public readonly category = "AUTONOMOUS";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.AUTONOMOUS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = GetPlatformCostsInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", description: "Period: HOURLY | DAILY | WEEKLY | MONTHLY" },
        },
        required: [],
      },
      timeout_ms: 15000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof GetPlatformCostsInputSchema>): Promise<any> {
    const breakdown = platformEconomicsService.getCostBreakdown(context.tenant.id, input.period);
    return { success: true, data: breakdown };
  }
}

// ============================================================
// 10. GET LEARNING CANDIDATES TOOL
// ============================================================
const GetLearningCandidatesInputSchema = z.object({
  status: z.string().optional(),
});

export class GetLearningCandidatesTool implements IAgentTool<z.infer<typeof GetLearningCandidatesInputSchema>> {
  public readonly name = "get_learning_candidates";
  public readonly description = "Query the continuous learning candidate pipeline (Shadow, Canary, Governance, Production stages) and active model versions.";
  public readonly category = "AUTONOMOUS";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.LEARNING_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = GetLearningCandidatesInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "Filter candidate status" },
        },
        required: [],
      },
      timeout_ms: 15000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof GetLearningCandidatesInputSchema>): Promise<any> {
    const candidates = continuousLearningService.getCandidates(context.tenant.id, input.status as any);
    return { success: true, data: candidates, count: candidates.length };
  }
}

// ============================================================
// 11. EVALUATE LEARNING CANDIDATE TOOL
// ============================================================
const EvaluateLearningCandidateInputSchema = z.object({
  candidate_id: z.string().describe("Learning candidate ID"),
});

export class EvaluateLearningCandidateTool implements IAgentTool<z.infer<typeof EvaluateLearningCandidateInputSchema>> {
  public readonly name = "evaluate_learning_candidate";
  public readonly description = "Trigger rigorous evaluation on a learning candidate before promoting from Shadow to Canary or Production.";
  public readonly category = "AUTONOMOUS";
  public readonly riskLevel: ToolRiskLevel = "MEDIUM_RISK";
  public readonly requiredPermission = PERMISSIONS.LEARNING_MANAGE;
  public readonly requiresConfirmation = false;
  public readonly schema = EvaluateLearningCandidateInputSchema;
  public readonly idempotent = false;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: {
        type: "object",
        properties: {
          candidate_id: { type: "string", description: "Candidate ID" },
        },
        required: ["candidate_id"],
      },
      timeout_ms: 20000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof EvaluateLearningCandidateInputSchema>): Promise<any> {
    const evaluation = continuousLearningService.evaluateCandidate(context.tenant.id, input.candidate_id);
    return { success: true, data: evaluation };
  }
}

// ============================================================
// 12. GET ACTIVE STRATEGIES TOOL
// ============================================================
const GetActiveStrategiesInputSchema = z.object({});

export class GetActiveStrategiesTool implements IAgentTool<z.infer<typeof GetActiveStrategiesInputSchema>> {
  public readonly name = "get_active_strategies";
  public readonly description = "Retrieve list of active business strategies linked to enterprise objectives with their current execution status and tradeoff scores.";
  public readonly category = "AUTONOMOUS";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.STRATEGY_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = GetActiveStrategiesInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: { type: "object", properties: {}, required: [] },
      timeout_ms: 15000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, _input: z.infer<typeof GetActiveStrategiesInputSchema>): Promise<any> {
    const strategies = strategyEngineService.getStrategies(context.tenant.id, "ACTIVE");
    return { success: true, data: strategies, count: strategies.length };
  }
}

// ============================================================
// 13. PAUSE DOMAIN AUTONOMY TOOL
// ============================================================
const PauseDomainAutonomyInputSchema = z.object({
  domain: z.string().describe("Domain to pause (e.g. PRICING, INVENTORY, MARKETING, ALL)"),
  reason: z.string().describe("Reason for pausing domain autonomy"),
});

export class PauseDomainAutonomyTool implements IAgentTool<z.infer<typeof PauseDomainAutonomyInputSchema>> {
  public readonly name = "pause_domain_autonomy";
  public readonly description = "Immediately pause autonomous execution in a specific business domain or platform-wide, forcing all decisions into manual human approval.";
  public readonly category = "AUTONOMOUS";
  public readonly riskLevel: ToolRiskLevel = "HIGH_RISK";
  public readonly requiredPermission = PERMISSIONS.AUTONOMOUS_MANAGE;
  public readonly requiresConfirmation = true;
  public readonly schema = PauseDomainAutonomyInputSchema;
  public readonly idempotent = false;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: {
        type: "object",
        properties: {
          domain: { type: "string", description: "Domain name or ALL" },
          reason: { type: "string", description: "Reason for pausing" },
        },
        required: ["domain", "reason"],
      },
      timeout_ms: 15000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof PauseDomainAutonomyInputSchema>): Promise<any> {
    const isAll = input.domain.toUpperCase() === "ALL";
    const result = autonomousControlPlaneService.pauseAutonomy(
      context.tenant.id,
      { level: isAll ? "ALL" : "DOMAIN", target: isAll ? undefined : input.domain },
      input.reason,
      context.user?.id || "admin"
    );
    return { success: true, data: result };
  }
}

// ============================================================
// 14. EXECUTE AUTONOMOUS CYCLE TOOL
// ============================================================
const ExecuteAutonomousCycleInputSchema = z.object({
  cycle_type: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).default("DAILY"),
});

export class ExecuteAutonomousCycleTool implements IAgentTool<z.infer<typeof ExecuteAutonomousCycleInputSchema>> {
  public readonly name = "execute_autonomous_cycle";
  public readonly description = "Trigger a scheduled autonomous business cycle (Daily operational review, Weekly strategy review, or Monthly enterprise review).";
  public readonly category = "AUTONOMOUS";
  public readonly riskLevel: ToolRiskLevel = "MEDIUM_RISK";
  public readonly requiredPermission = PERMISSIONS.AUTONOMOUS_EXECUTE;
  public readonly requiresConfirmation = false;
  public readonly schema = ExecuteAutonomousCycleInputSchema;
  public readonly idempotent = false;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: {
        type: "object",
        properties: {
          cycle_type: { type: "string", description: "DAILY | WEEKLY | MONTHLY" },
        },
        required: ["cycle_type"],
      },
      timeout_ms: 30000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof ExecuteAutonomousCycleInputSchema>): Promise<any> {
    let result;
    if (input.cycle_type === "DAILY") {
      result = autonomousCyclesService.startDailyCycle(context.tenant.id);
    } else if (input.cycle_type === "WEEKLY") {
      result = autonomousCyclesService.startWeeklyCycle(context.tenant.id);
    } else {
      result = autonomousCyclesService.startMonthlyCycle(context.tenant.id);
    }
    return { success: true, data: result };
  }
}
