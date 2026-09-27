import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 4: Central Tool Registry & Server-Side Execution Gateway
 * Strictly enforces Zod validation, RBAC assertion, tenant isolation, and audit logging.
 */

import { IAgentTool } from "./tool.interface";
import { ToolDefinition, AgentToolCallRecord } from "@/types/ai";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { db } from "@/infrastructure/db";
import { AppError, BadRequestError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { LLMToolDefinition } from "@/domains/ai/providers/llm-provider.interface";

// Tool implementations
import { SearchProductsTool, GetProductTool, CheckInventoryTool } from "./implementations/product-tools";
import { GetOrderTool, GetOrderStatusTool } from "./implementations/order-tools";
import { GetShipmentStatusTool, GetShippingEstimateTool } from "./implementations/shipping-tools";
import { GetPaymentStatusTool } from "./implementations/payment-tools";
import { CreateLeadTool } from "./implementations/lead-tools";
import { CalculateCheckoutTool, CreateOrderDraftTool } from "./implementations/checkout-tools";
import { GetCustomerTool, GetCustomerOrdersTool } from "./implementations/customer-tools";
import { RequestHumanHandoffTool } from "./implementations/human-tools";
import { SearchKnowledgeTool } from "./implementations/knowledge-tools";
import {
  GetAudienceTool,
  CreateAudienceTool,
  EvaluateSegmentTool,
  GetCustomerLifecycleTool,
  GetProductRecommendationsTool,
  GetCampaignMetricsTool,
  CreateCampaignDraftTool,
  GenerateContentTool,
  ValidateContentTool,
  SimulateCampaignTool,
  CheckConsentTool,
  CheckFrequencyCapTool,
  ScheduleCampaignTool,
  SendCampaignTool,
  PauseCampaignTool,
  ResumeCampaignTool,
  GetCampaignResultTool,
  GetAttributionTool,
} from "./implementations/growth-tools";
import {
  GetInventoryLevelsTool,
  GetInventoryForecastTool,
  CreatePurchaseOrderTool,
  SimulatePriceChangeTool,
  ExecutePriceChangeTool,
  GetShipmentTrackingTool,
  SwitchCourierTool,
  VerifyPaymentTransactionTool,
  ReconcilePaymentBatchTool,
  RunFinancialReconciliationTool,
  GetOperationalExceptionsTool,
  ResolveOperationalExceptionTool,
  GetAutonomyBudgetTool,
  TriggerKillSwitchTool,
} from "./implementations/operations-tools";
import {
  GetEnterpriseOverviewTool,
  GetCrossEntityAnalyticsTool,
  RunEnterpriseBenchmarkTool,
  GenerateEnterpriseReportTool,
  ResolveSemanticMetricTool,
  GetIntegrationStatusTool,
  TriggerIntegrationSyncTool,
  ResolveIntegrationConflictTool,
  GetDataQualityIssuesTool,
  TraceDataLineageTool,
  GetEnterpriseIncidentsTool,
  ResolveEnterpriseIncidentTool,
  AuditCustomerIdentityTool,
  CheckEnterpriseAIBudgetTool,
  BalanceCrossStoreInventoryTool,
  ConsolidateProcurementDemandTool,
} from "./implementations/enterprise-tools";
import {
  GetAutonomousOverviewTool,
  GetBusinessObjectivesTool,
  CreateBusinessObjectiveTool,
  SimulateObjectiveStrategyTool,
  EvaluateGlobalDecisionTool,
  ApproveAutonomousDecisionTool,
  GetPlatformHealthTool,
  GetQualityScorecardTool,
  GetPlatformCostsTool,
  GetLearningCandidatesTool,
  EvaluateLearningCandidateTool,
  GetActiveStrategiesTool,
  PauseDomainAutonomyTool,
  ExecuteAutonomousCycleTool,
} from "./implementations/autonomous-tools";

export class ToolRegistry {
  private static instance: ToolRegistry;
  private tools: Map<string, IAgentTool> = new Map();

  private constructor() {
    this.registerDefaultTools();
  }

  public static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  private registerDefaultTools(): void {
    this.register(new SearchProductsTool());
    this.register(new GetProductTool());
    this.register(new CheckInventoryTool());
    this.register(new GetOrderTool());
    this.register(new GetOrderStatusTool());
    this.register(new GetShipmentStatusTool());
    this.register(new GetShippingEstimateTool());
    this.register(new GetPaymentStatusTool());
    this.register(new CreateLeadTool());
    this.register(new CalculateCheckoutTool());
    this.register(new CreateOrderDraftTool());
    this.register(new GetCustomerTool());
    this.register(new GetCustomerOrdersTool());
    this.register(new RequestHumanHandoffTool());
    this.register(new SearchKnowledgeTool());

    // Phase 7 Growth & Marketing Tools
    this.register(new GetAudienceTool());
    this.register(new CreateAudienceTool());
    this.register(new EvaluateSegmentTool());
    this.register(new GetCustomerLifecycleTool());
    this.register(new GetProductRecommendationsTool());
    this.register(new GetCampaignMetricsTool());
    this.register(new CreateCampaignDraftTool());
    this.register(new GenerateContentTool());
    this.register(new ValidateContentTool());
    this.register(new SimulateCampaignTool());
    this.register(new CheckConsentTool());
    this.register(new CheckFrequencyCapTool());
    this.register(new ScheduleCampaignTool());
    this.register(new SendCampaignTool());
    this.register(new PauseCampaignTool());
    this.register(new ResumeCampaignTool());
    this.register(new GetCampaignResultTool());
    this.register(new GetAttributionTool());

    // Phase 8 Operational Tools
    this.register(new GetInventoryLevelsTool());
    this.register(new GetInventoryForecastTool());
    this.register(new CreatePurchaseOrderTool());
    this.register(new SimulatePriceChangeTool());
    this.register(new ExecutePriceChangeTool());
    this.register(new GetShipmentTrackingTool());
    this.register(new SwitchCourierTool());
    this.register(new VerifyPaymentTransactionTool());
    this.register(new ReconcilePaymentBatchTool());
    this.register(new RunFinancialReconciliationTool());
    this.register(new GetOperationalExceptionsTool());
    this.register(new ResolveOperationalExceptionTool());
    this.register(new GetAutonomyBudgetTool());
    this.register(new TriggerKillSwitchTool());

    // Phase 9 Enterprise Tools
    this.register(new GetEnterpriseOverviewTool());
    this.register(new GetCrossEntityAnalyticsTool());
    this.register(new RunEnterpriseBenchmarkTool());
    this.register(new GenerateEnterpriseReportTool());
    this.register(new ResolveSemanticMetricTool());
    this.register(new GetIntegrationStatusTool());
    this.register(new TriggerIntegrationSyncTool());
    this.register(new ResolveIntegrationConflictTool());
    this.register(new GetDataQualityIssuesTool());
    this.register(new TraceDataLineageTool());
    this.register(new GetEnterpriseIncidentsTool());
    this.register(new ResolveEnterpriseIncidentTool());
    this.register(new AuditCustomerIdentityTool());
    this.register(new CheckEnterpriseAIBudgetTool());
    this.register(new BalanceCrossStoreInventoryTool());
    this.register(new ConsolidateProcurementDemandTool());

    // Phase 10 Autonomous Platform Tools
    this.register(new GetAutonomousOverviewTool());
    this.register(new GetBusinessObjectivesTool());
    this.register(new CreateBusinessObjectiveTool());
    this.register(new SimulateObjectiveStrategyTool());
    this.register(new EvaluateGlobalDecisionTool());
    this.register(new ApproveAutonomousDecisionTool());
    this.register(new GetPlatformHealthTool());
    this.register(new GetQualityScorecardTool());
    this.register(new GetPlatformCostsTool());
    this.register(new GetLearningCandidatesTool());
    this.register(new EvaluateLearningCandidateTool());
    this.register(new GetActiveStrategiesTool());
    this.register(new PauseDomainAutonomyTool());
    this.register(new ExecuteAutonomousCycleTool());
  }

  public register(tool: IAgentTool): void {
    this.tools.set(tool.name, tool);
  }

  public getTool(name: string): IAgentTool | undefined {
    return this.tools.get(name);
  }

  public listTools(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.getDefinition());
  }

  public getToolsByCategory(category: string): ToolDefinition[] {
    return this.listTools().filter((t) => t.category === category);
  }

  public getLLMToolDefinitions(allowedToolNames?: string[]): LLMToolDefinition[] {
    const list = Array.from(this.tools.values());
    const filtered = allowedToolNames && allowedToolNames.length > 0
      ? list.filter((t) => allowedToolNames.includes(t.name))
      : list;

    return filtered.map((t) => {
      const def = t.getDefinition();
      return {
        name: def.name,
        description: def.description,
        parameters: def.parameters,
      };
    });
  }

  /**
   * Direct Tool Execution Convenience Helper
   */
  public async execute(
    context: RequestContext,
    toolName: string,
    args: Record<string, unknown>,
    options?: { conversationId?: string; agentRunId?: string; idempotencyKey?: string }
  ): Promise<any> {
    const res = await this.executeTool(context, {
      toolName,
      arguments: args,
      agentRunId: options?.agentRunId || `run_direct_${Date.now()}_${randomSuffix()}`,
      conversationId: options?.conversationId || `conv_direct_${Date.now()}_${randomSuffix()}`,
      idempotencyKey: options?.idempotencyKey,
    });
    if (!res.success) {
      throw new AppError("VALIDATION_ERROR", res.error || "Tool validation failed", 400);
    }
    return res.result;
  }

  /**
   * Authoritative Tool Gateway Execution
   * Enforces: Schema Validation -> Tenant Assertion -> RBAC Check -> Policy Enforcement -> Execution -> Audit
   */
  public async executeTool(
    context: RequestContext,
    params: {
      toolName: string;
      arguments: Record<string, unknown>;
      agentRunId: string;
      conversationId: string;
      idempotencyKey?: string;
    }
  ): Promise<{ success: boolean; result: any; error?: string }> {
    const startTime = Date.now();
    const tool = this.getTool(params.toolName);

    if (!tool) {
      const duration = Date.now() - startTime;
      db.createAgentToolCall({
        id: `tcall_${Date.now()}_${randomSuffix()}`,
        tenant_id: context.tenant.id,
        agent_run_id: params.agentRunId,
        conversation_id: params.conversationId,
        tool_name: params.toolName,
        input_arguments: params.arguments,
        status: "ERROR",
        duration_ms: duration,
        error_message: `Tool '${params.toolName}' is not registered.`,
        created_at: new Date().toISOString(),
      });
      throw new NotFoundError(`AI Tool '${params.toolName}' does not exist.`);
    }

    // 1. Check Tenant Policy
    const policy = db.getAIPolicy(context.tenant.id);
    if (policy.disallowed_tool_names && policy.disallowed_tool_names.includes(params.toolName)) {
      const duration = Date.now() - startTime;
      db.createAgentToolCall({
        id: `tcall_${Date.now()}_${randomSuffix()}`,
        tenant_id: context.tenant.id,
        agent_run_id: params.agentRunId,
        conversation_id: params.conversationId,
        tool_name: params.toolName,
        input_arguments: params.arguments,
        status: "POLICY_REJECTED",
        duration_ms: duration,
        error_message: `Tool '${params.toolName}' is disallowed by tenant AI policy.`,
        created_at: new Date().toISOString(),
      });
      throw new ForbiddenError(`AI Tool '${params.toolName}' is disabled by store policy.`);
    }

    // 2. Server-side RBAC Permission Assertion
    try {
      RbacService.assertCan(context, tool.requiredPermission as any);
    } catch (err: any) {
      const duration = Date.now() - startTime;
      db.createAgentToolCall({
        id: `tcall_${Date.now()}_${randomSuffix()}`,
        tenant_id: context.tenant.id,
        agent_run_id: params.agentRunId,
        conversation_id: params.conversationId,
        tool_name: params.toolName,
        input_arguments: params.arguments,
        status: "POLICY_REJECTED",
        duration_ms: duration,
        error_message: `Permission denied: ${tool.requiredPermission}`,
        created_at: new Date().toISOString(),
      });
      throw err;
    }

    // 3. Strict Zod Schema Validation
    const parseResult = tool.schema.safeParse(params.arguments);
    if (!parseResult.success) {
      const duration = Date.now() - startTime;
      const errorMsg = parseResult.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
      db.createAgentToolCall({
        id: `tcall_${Date.now()}_${randomSuffix()}`,
        tenant_id: context.tenant.id,
        agent_run_id: params.agentRunId,
        conversation_id: params.conversationId,
        tool_name: params.toolName,
        input_arguments: params.arguments,
        status: "ERROR",
        duration_ms: duration,
        error_message: `Invalid tool arguments: ${errorMsg}`,
        created_at: new Date().toISOString(),
      });
      return { success: false, result: null, error: `Validation error: ${errorMsg}` };
    }

    // 4. Execute Authorized Domain Service
    try {
      const rawResult = await tool.execute(context, parseResult.data, {
        conversationId: params.conversationId,
        idempotencyKey: params.idempotencyKey,
      });
      const duration = Date.now() - startTime;

      // 5. Audit Tool Call
      db.createAgentToolCall({
        id: `tcall_${Date.now()}_${randomSuffix()}`,
        tenant_id: context.tenant.id,
        agent_run_id: params.agentRunId,
        conversation_id: params.conversationId,
        tool_name: params.toolName,
        input_arguments: params.arguments,
        sanitized_result: rawResult,
        status: "SUCCESS",
        duration_ms: duration,
        idempotency_key: params.idempotencyKey,
        created_at: new Date().toISOString(),
      });

      return { success: true, result: rawResult };
    } catch (err: any) {
      const duration = Date.now() - startTime;
      db.createAgentToolCall({
        id: `tcall_${Date.now()}_${randomSuffix()}`,
        tenant_id: context.tenant.id,
        agent_run_id: params.agentRunId,
        conversation_id: params.conversationId,
        tool_name: params.toolName,
        input_arguments: params.arguments,
        status: "ERROR",
        duration_ms: duration,
        error_message: err.message || "Tool execution failed.",
        created_at: new Date().toISOString(),
      });
      return { success: false, result: null, error: err.message || "Tool execution failed." };
    }
  }
}

export const toolRegistry = ToolRegistry.getInstance();
