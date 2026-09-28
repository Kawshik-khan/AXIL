import { resolveOrganizationId, resolveEnterpriseCaller } from "@/domains/enterprise/organization-access";
/**
 * CommerceOS Phase 9: Enterprise Intelligence & Ecosystem Tools
 * Implements the 16 authoritative enterprise tools grounded in domain services.
 * All tool actions are authenticated, tenant-isolated, and RBAC-controlled.
 */

import { z } from "zod";
import { IAgentTool } from "../tool.interface";
import { ToolDefinition, ToolRiskLevel } from "@/types/ai";
import { RequestContext } from "@/lib/context";
import { PERMISSIONS } from "@/lib/permissions";
import { db } from "@/infrastructure/db";
import { enterpriseOperationsService } from "@/domains/enterprise/services/enterprise-operations.service";
import { enterpriseAnalyticsService } from "@/domains/enterprise/services/enterprise-analytics.service";
import { enterpriseBenchmarkingService } from "@/domains/enterprise/services/enterprise-benchmarking.service";
import { enterpriseReportingService } from "@/domains/enterprise/services/enterprise-reporting.service";
import { semanticMetricsService } from "@/domains/enterprise/services/semantic-metrics.service";
import { integrationHubService, toPublicInstallation } from "@/domains/enterprise/services/integration-hub.service";
import { conflictResolutionService } from "@/domains/enterprise/services/conflict-resolution.service";
import { dataQualityService } from "@/domains/enterprise/services/data-quality.service";
import { dataLineageService } from "@/domains/enterprise/services/data-lineage.service";
import { enterpriseIncidentService } from "@/domains/enterprise/services/enterprise-incident.service";
import { enterpriseCustomerIdentityService } from "@/domains/enterprise/services/enterprise-customer-identity.service";
import { enterpriseAiGovernanceService } from "@/domains/enterprise/services/enterprise-ai-governance.service";
import { enterpriseInventoryService } from "@/domains/enterprise/services/enterprise-inventory.service";
import { enterpriseProcurementService } from "@/domains/enterprise/services/enterprise-procurement.service";
import { EnterpriseUserRecord } from "@/types/enterprise";

// The caller's real enterprise role and scope, not a synthetic all-access admin (N11)
function buildCaller(context: RequestContext, organizationId: string): EnterpriseUserRecord {
  return resolveEnterpriseCaller(context, organizationId);
}

// ============================================================
// 1. GET ENTERPRISE OVERVIEW TOOL
// ============================================================
const GetEnterpriseOverviewInputSchema = z.object({
  organization_id: z.string().optional().describe("Enterprise organization ID"),
});

export class GetEnterpriseOverviewTool implements IAgentTool<z.infer<typeof GetEnterpriseOverviewInputSchema>> {
  public readonly name = "get_enterprise_overview";
  public readonly description = "Retrieve multi-store portfolio summary metrics, entity health matrix, and open incident counts.";
  public readonly category = "ENTERPRISE";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.ENTERPRISE_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = GetEnterpriseOverviewInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 15000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {
          organization_id: { type: "string", description: "Organization ID" },
        },
        required: [],
      },
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof GetEnterpriseOverviewInputSchema>): Promise<any> {
    const orgId = resolveOrganizationId(context, input.organization_id);
    return enterpriseOperationsService.getOverview(orgId, context.tenant.id, buildCaller(context, orgId));
  }
}

// ============================================================
// 2. GET CROSS-ENTITY ANALYTICS TOOL
// ============================================================
const GetCrossEntityAnalyticsInputSchema = z.object({
  organization_id: z.string().optional().describe("Enterprise organization ID"),
});

export class GetCrossEntityAnalyticsTool implements IAgentTool<z.infer<typeof GetCrossEntityAnalyticsInputSchema>> {
  public readonly name = "get_cross_entity_analytics";
  public readonly description = "Compute consolidated cross-store and cross-brand analytics with server-side authorization scoping.";
  public readonly category = "ENTERPRISE";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.ENTERPRISE_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = GetCrossEntityAnalyticsInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 20000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {
          organization_id: { type: "string", description: "Organization ID" },
        },
        required: [],
      },
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof GetCrossEntityAnalyticsInputSchema>): Promise<any> {
    const caller = buildCaller(context, resolveOrganizationId(context, input.organization_id));
    return enterpriseAnalyticsService.getConsolidatedAnalytics(resolveOrganizationId(context, input.organization_id), caller, context.tenant.id);
  }
}

// ============================================================
// 3. RUN ENTERPRISE BENCHMARK TOOL
// ============================================================
const RunEnterpriseBenchmarkInputSchema = z.object({
  organization_id: z.string().optional(),
  metric_key: z.string().describe("Metric to benchmark, e.g. gross_revenue, average_order_value, delivery_sla_pct"),
});

export class RunEnterpriseBenchmarkTool implements IAgentTool<z.infer<typeof RunEnterpriseBenchmarkInputSchema>> {
  public readonly name = "run_enterprise_benchmark";
  public readonly description = "Calculate cross-store and cross-brand percentile rankings and performance variance drivers.";
  public readonly category = "ENTERPRISE";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.BENCHMARKS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = RunEnterpriseBenchmarkInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 20000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {
          organization_id: { type: "string", description: "Organization ID" },
          metric_key: { type: "string", description: "Metric key to benchmark" },
        },
        required: ["metric_key"],
      },
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof RunEnterpriseBenchmarkInputSchema>): Promise<any> {
    const caller = buildCaller(context, resolveOrganizationId(context, input.organization_id));
    return enterpriseBenchmarkingService.generateStoreBenchmark(resolveOrganizationId(context, input.organization_id), input.metric_key, caller, context.tenant.id);
  }
}

// ============================================================
// 4. GENERATE ENTERPRISE REPORT TOOL
// ============================================================
const GenerateEnterpriseReportInputSchema = z.object({
  organization_id: z.string().optional(),
  title: z.string().describe("Title of report"),
  format: z.enum(["JSON", "CSV", "PDF"]).default("CSV"),
  metrics: z.array(z.string()).default(["gross_revenue", "order_count"]),
});

export class GenerateEnterpriseReportTool implements IAgentTool<z.infer<typeof GenerateEnterpriseReportInputSchema>> {
  public readonly name = "generate_enterprise_report";
  public readonly description = "Generate an executive or compliance reporting package across stores.";
  public readonly category = "ENTERPRISE";
  public readonly riskLevel: ToolRiskLevel = "LOW_RISK";
  public readonly requiredPermission = PERMISSIONS.EXPORTS_CREATE;
  public readonly requiresConfirmation = false;
  public readonly schema = GenerateEnterpriseReportInputSchema;
  public readonly idempotent = false;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 25000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {
          organization_id: { type: "string", description: "Organization ID" },
          title: { type: "string", description: "Title of report" },
          format: { type: "string", enum: ["JSON", "CSV", "PDF"] },
          metrics: { type: "array", items: { type: "string" } },
        },
        required: ["title"],
      },
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof GenerateEnterpriseReportInputSchema>): Promise<any> {
    const caller = buildCaller(context, resolveOrganizationId(context, input.organization_id));
    const def = enterpriseReportingService.createReportDefinition(resolveOrganizationId(context, input.organization_id), {
      title: input.title,
      category: "EXECUTIVE",
      metrics: input.metrics,
      dimensions: ["STORE"],
      format: input.format,
    });
    return enterpriseReportingService.executeReport(resolveOrganizationId(context, input.organization_id), def.id, caller, context.tenant.id);
  }
}

// ============================================================
// 5. RESOLVE SEMANTIC METRIC TOOL
// ============================================================
const ResolveSemanticMetricInputSchema = z.object({
  organization_id: z.string().optional(),
  metric_key: z.string().describe("Semantic metric key, e.g. gross_revenue, net_revenue, average_order_value"),
});

export class ResolveSemanticMetricTool implements IAgentTool<z.infer<typeof ResolveSemanticMetricInputSchema>> {
  public readonly name = "resolve_semantic_metric";
  public readonly description = "Evaluate governed semantic metrics with standard formulas and dimensions.";
  public readonly category = "ENTERPRISE";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.METRICS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = ResolveSemanticMetricInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 15000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {
          organization_id: { type: "string", description: "Organization ID" },
          metric_key: { type: "string", description: "Metric key" },
        },
        required: ["metric_key"],
      },
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof ResolveSemanticMetricInputSchema>): Promise<any> {
    const orgId = resolveOrganizationId(context, input.organization_id);
    return semanticMetricsService.queryMetric(
      orgId,
      { metric_key: input.metric_key, entity_type: "ORGANIZATION", entity_id: orgId },
      context.tenant.id,
      buildCaller(context, orgId)
    );
  }
}

// ============================================================
// 6. GET INTEGRATION STATUS TOOL
// ============================================================
const GetIntegrationStatusInputSchema = z.object({
  organization_id: z.string().optional(),
});

export class GetIntegrationStatusTool implements IAgentTool<z.infer<typeof GetIntegrationStatusInputSchema>> {
  public readonly name = "get_integration_status";
  public readonly description = "Inspect connection health, sync stats, and error rates of installed enterprise connectors.";
  public readonly category = "ENTERPRISE";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.INTEGRATIONS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = GetIntegrationStatusInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 10000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {
          organization_id: { type: "string", description: "Organization ID" },
        },
        required: [],
      },
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof GetIntegrationStatusInputSchema>): Promise<any> {
    // Never put stored credentials into model context or tool output (Phase 3 security review F1)
    const installations = db.getIntegrationInstallations(resolveOrganizationId(context, input.organization_id)).map(toPublicInstallation);
    return {
      total_connectors: installations.length,
      connectors: installations,
    };
  }
}

// ============================================================
// 7. TRIGGER INTEGRATION SYNC TOOL
// ============================================================
const TriggerIntegrationSyncInputSchema = z.object({
  organization_id: z.string().optional(),
  integration_id: z.string().describe("Integration connector ID"),
  entity_type: z.string().default("ORDER").describe("Entity type to sync: ORDER, PRODUCT, INVENTORY"),
});

export class TriggerIntegrationSyncTool implements IAgentTool<z.infer<typeof TriggerIntegrationSyncInputSchema>> {
  public readonly name = "trigger_integration_sync";
  public readonly description = "Trigger a controlled sync run for an external ERP, CRM, or marketplace connector.";
  public readonly category = "ENTERPRISE";
  public readonly riskLevel: ToolRiskLevel = "MEDIUM_RISK";
  public readonly requiredPermission = PERMISSIONS.INTEGRATIONS_SYNC;
  public readonly requiresConfirmation = false;
  public readonly schema = TriggerIntegrationSyncInputSchema;
  public readonly idempotent = false;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 30000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {
          organization_id: { type: "string", description: "Organization ID" },
          integration_id: { type: "string", description: "Integration ID" },
          entity_type: { type: "string", description: "Entity type" },
        },
        required: ["integration_id"],
      },
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof TriggerIntegrationSyncInputSchema>): Promise<any> {
    // No provider adapter exists: refuses instead of recording a placeholder sync as COMPLETED (FX-31)
    return integrationHubService.triggerProviderSync(resolveOrganizationId(context, input.organization_id), input.integration_id);
  }
}

// ============================================================
// 8. RESOLVE INTEGRATION CONFLICT TOOL
// ============================================================
const ResolveIntegrationConflictInputSchema = z.object({
  conflict_id: z.string().describe("Integration conflict ID"),
  decision: z.enum(["COMMERCEOS_ACCEPTED", "EXTERNAL_ACCEPTED", "MANUAL_MERGED"]).describe("Resolution decision"),
});

export class ResolveIntegrationConflictTool implements IAgentTool<z.infer<typeof ResolveIntegrationConflictInputSchema>> {
  public readonly name = "resolve_integration_conflict";
  public readonly description = "Resolve an integration data sync conflict by applying an explicit resolution strategy.";
  public readonly category = "ENTERPRISE";
  public readonly riskLevel: ToolRiskLevel = "MEDIUM_RISK";
  public readonly requiredPermission = PERMISSIONS.INTEGRATIONS_MANAGE;
  public readonly requiresConfirmation = false;
  public readonly schema = ResolveIntegrationConflictInputSchema;
  public readonly idempotent = false;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 15000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {
          conflict_id: { type: "string", description: "Conflict ID" },
          decision: { type: "string", enum: ["COMMERCEOS_ACCEPTED", "EXTERNAL_ACCEPTED", "MANUAL_MERGED"] },
        },
        required: ["conflict_id", "decision"],
      },
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof ResolveIntegrationConflictInputSchema>): Promise<any> {
    return conflictResolutionService.manuallyResolve(
      input.conflict_id,
      input.decision,
      context.user?.id || "agent"
    );
  }
}

// ============================================================
// 9. GET DATA QUALITY ISSUES TOOL
// ============================================================
const GetDataQualityIssuesInputSchema = z.object({
  organization_id: z.string().optional(),
});

export class GetDataQualityIssuesTool implements IAgentTool<z.infer<typeof GetDataQualityIssuesInputSchema>> {
  public readonly name = "get_data_quality_issues";
  public readonly description = "Run automated data quality profiling to surface missing fields, zero pricing, and broken references.";
  public readonly category = "ENTERPRISE";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.DATA_QUALITY_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = GetDataQualityIssuesInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 15000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {
          organization_id: { type: "string", description: "Organization ID" },
        },
        required: [],
      },
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof GetDataQualityIssuesInputSchema>): Promise<any> {
    const issues = dataQualityService.runQualityAudit(resolveOrganizationId(context, input.organization_id), context.tenant.id);
    return {
      total_defects: issues.length,
      issues,
    };
  }
}

// ============================================================
// 10. TRACE DATA LINEAGE TOOL
// ============================================================
const TraceDataLineageInputSchema = z.object({
  organization_id: z.string().optional(),
  asset_name: z.string().default("orders").describe("Data asset name, e.g. orders, inventory, customers"),
});

export class TraceDataLineageTool implements IAgentTool<z.infer<typeof TraceDataLineageInputSchema>> {
  public readonly name = "trace_data_lineage";
  public readonly description = "Trace upstream sources and downstream consumers for an enterprise data asset.";
  public readonly category = "ENTERPRISE";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.DATA_LINEAGE_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = TraceDataLineageInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 15000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {
          organization_id: { type: "string", description: "Organization ID" },
          asset_name: { type: "string", description: "Data asset name" },
        },
        required: ["asset_name"],
      },
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof TraceDataLineageInputSchema>): Promise<any> {
    return dataLineageService.getProvenance(resolveOrganizationId(context, input.organization_id), input.asset_name);
  }
}

// ============================================================
// 11. GET ENTERPRISE INCIDENTS TOOL
// ============================================================
const GetEnterpriseIncidentsInputSchema = z.object({
  organization_id: z.string().optional(),
  status: z.enum(["OPEN", "INVESTIGATING", "RESOLVED"]).optional(),
});

export class GetEnterpriseIncidentsTool implements IAgentTool<z.infer<typeof GetEnterpriseIncidentsInputSchema>> {
  public readonly name = "get_enterprise_incidents";
  public readonly description = "Retrieve operational incidents across all business units, stores, and external connectors.";
  public readonly category = "ENTERPRISE";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.INCIDENTS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = GetEnterpriseIncidentsInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 10000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {
          organization_id: { type: "string", description: "Organization ID" },
          status: { type: "string", enum: ["OPEN", "INVESTIGATING", "RESOLVED"] },
        },
        required: [],
      },
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof GetEnterpriseIncidentsInputSchema>): Promise<any> {
    let incidents = db.getEnterpriseIncidents(resolveOrganizationId(context, input.organization_id));
    if (input.status) {
      incidents = incidents.filter((i: any) => i.status === input.status);
    }
    return {
      total_incidents: incidents.length,
      incidents,
    };
  }
}

// ============================================================
// 12. RESOLVE ENTERPRISE INCIDENT TOOL
// ============================================================
const ResolveEnterpriseIncidentInputSchema = z.object({
  incident_id: z.string().describe("Incident ID to resolve"),
  resolution_notes: z.string().describe("Details of corrective action taken"),
  organization_id: z.string().optional().describe("Organization ID (defaults to this workspace's organization)"),
});

export class ResolveEnterpriseIncidentTool implements IAgentTool<z.infer<typeof ResolveEnterpriseIncidentInputSchema>> {
  public readonly name = "resolve_enterprise_incident";
  public readonly description = "Mark an operational incident as RESOLVED with audit trace notes.";
  public readonly category = "ENTERPRISE";
  public readonly riskLevel: ToolRiskLevel = "MEDIUM_RISK";
  public readonly requiredPermission = PERMISSIONS.INCIDENTS_MANAGE;
  public readonly requiresConfirmation = false;
  public readonly schema = ResolveEnterpriseIncidentInputSchema;
  public readonly idempotent = false;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 15000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {
          incident_id: { type: "string", description: "Incident ID" },
          resolution_notes: { type: "string", description: "Resolution notes" },
        },
        required: ["incident_id", "resolution_notes"],
      },
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof ResolveEnterpriseIncidentInputSchema>): Promise<any> {
    return enterpriseIncidentService.transitionStatus(resolveOrganizationId(context, input.organization_id), input.incident_id, "RESOLVED", input.resolution_notes);
  }
}

// ============================================================
// 13. AUDIT CUSTOMER IDENTITY TOOL
// ============================================================
const AuditCustomerIdentityInputSchema = z.object({
  organization_id: z.string().optional(),
  phone: z.string().describe("Customer phone number to resolve cross-store identities"),
});

export class AuditCustomerIdentityTool implements IAgentTool<z.infer<typeof AuditCustomerIdentityInputSchema>> {
  public readonly name = "audit_customer_identity";
  public readonly description = "Audit cross-store customer profile, linked social accounts, and lifetime order history.";
  public readonly category = "ENTERPRISE";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.GOVERNANCE_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = AuditCustomerIdentityInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 15000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {
          organization_id: { type: "string", description: "Organization ID" },
          phone: { type: "string", description: "Phone number" },
        },
        required: ["phone"],
      },
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof AuditCustomerIdentityInputSchema>): Promise<any> {
    return enterpriseCustomerIdentityService.resolveIdentity({
      organizationId: resolveOrganizationId(context, input.organization_id),
      storeId: "store_main",
      name: "Customer",
      phone: input.phone,
    });
  }
}

// ============================================================
// 14. CHECK ENTERPRISE AI BUDGET TOOL
// ============================================================
const CheckEnterpriseAIBudgetInputSchema = z.object({
  organization_id: z.string().optional(),
  store_id: z.string().optional().describe("Store ID to check budget for"),
});

export class CheckEnterpriseAIBudgetTool implements IAgentTool<z.infer<typeof CheckEnterpriseAIBudgetInputSchema>> {
  public readonly name = "check_enterprise_ai_budget";
  public readonly description = "Check monthly AI token and dollar budget consumption, remaining quota, and alert state.";
  public readonly category = "ENTERPRISE";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.GOVERNANCE_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = CheckEnterpriseAIBudgetInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 10000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {
          organization_id: { type: "string", description: "Organization ID" },
          store_id: { type: "string", description: "Store ID" },
        },
        required: [],
      },
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof CheckEnterpriseAIBudgetInputSchema>): Promise<any> {
    const entityId = input.store_id || "store_default";
    const budget = db.getEnterpriseAIBudget(resolveOrganizationId(context, input.organization_id), entityId);
    const executionCheck = enterpriseAiGovernanceService.canExecute(resolveOrganizationId(context, input.organization_id), entityId, 0.05, 500);
    return {
      budget,
      can_execute: executionCheck.allowed,
      reason: executionCheck.reason,
    };
  }
}

// ============================================================
// 15. BALANCE CROSS-STORE INVENTORY TOOL
// ============================================================
const BalanceCrossStoreInventoryInputSchema = z.object({
  organization_id: z.string().optional(),
});

export class BalanceCrossStoreInventoryTool implements IAgentTool<z.infer<typeof BalanceCrossStoreInventoryInputSchema>> {
  public readonly name = "balance_cross_store_inventory";
  public readonly description = "Detect stock imbalances across store locations and generate optimal transfer recommendations.";
  public readonly category = "ENTERPRISE";
  public readonly riskLevel: ToolRiskLevel = "MEDIUM_RISK";
  public readonly requiredPermission = PERMISSIONS.ENTERPRISE_MANAGE;
  public readonly requiresConfirmation = false;
  public readonly schema = BalanceCrossStoreInventoryInputSchema;
  public readonly idempotent = false;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 25000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {
          organization_id: { type: "string", description: "Organization ID" },
        },
        required: [],
      },
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof BalanceCrossStoreInventoryInputSchema>): Promise<any> {
    return enterpriseInventoryService.proposeNetworkBalancing(resolveOrganizationId(context, input.organization_id), context.tenant.id);
  }
}

// ============================================================
// 16. CONSOLIDATE PROCUREMENT DEMAND TOOL
// ============================================================
const ConsolidateProcurementDemandInputSchema = z.object({
  organization_id: z.string().optional(),
});

export class ConsolidateProcurementDemandTool implements IAgentTool<z.infer<typeof ConsolidateProcurementDemandInputSchema>> {
  public readonly name = "consolidate_procurement_demand";
  public readonly description = "Aggregate multi-store stock requirements into a unified bulk purchase order with volume discount tiering.";
  public readonly category = "ENTERPRISE";
  public readonly riskLevel: ToolRiskLevel = "HIGH_RISK";
  public readonly requiredPermission = PERMISSIONS.ENTERPRISE_MANAGE;
  public readonly requiresConfirmation = true;
  public readonly schema = ConsolidateProcurementDemandInputSchema;
  public readonly idempotent = false;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 30000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {
          organization_id: { type: "string", description: "Organization ID" },
        },
        required: [],
      },
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof ConsolidateProcurementDemandInputSchema>): Promise<any> {
    return enterpriseProcurementService.consolidateDemand(resolveOrganizationId(context, input.organization_id), context.tenant.id);
  }
}
