import { N8nProviderService } from "./n8n-provider.service";
import { AppError } from "@/lib/errors";
import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 6: Automation Registry & Lifecycle Governance Service
 * Governs automation definitions, workflow version immutability, tenant template
 * installation, and operational health scoring.
 */

import { db } from "@/infrastructure/db";
import {
  AutomationRecord,
  AutomationWorkflow,
  AutomationWorkflowVersion,
  AutomationHealth,
  StandardWorkflowTemplate,
  ExecutionMode,
} from "@/types/automation";
import { STANDARD_WORKFLOW_TEMPLATES } from "../templates/standard-workflows";
import { ProviderCircuitBreakerService } from "./provider-circuit-breaker.service";
import { AutomationSafetyService } from "./automation-safety.service";

export class AutomationRegistryService {
  /**
   * Lists automations for a tenant
   */
  public static listAutomations(
    tenantId: string,
    options?: { category?: string; status?: string }
  ): AutomationRecord[] {
    let list = db.getAutomations(tenantId);
    if (options?.category) list = list.filter((a) => a.category === options.category);
    if (options?.status) list = list.filter((a) => a.status === options.status);
    return list;
  }

  /**
   * Gets automation by ID
   */
  public static getAutomationById(tenantId: string, id: string): AutomationRecord | undefined {
    return db.findAutomationById(tenantId, id);
  }

  /**
   * Creates a new automation
   */
  public static createAutomation(
    tenantId: string,
    actorId: string,
    payload: {
      name: string;
      description?: string;
      category: any;
      trigger_type: any;
      workflow_id?: string;
      configuration?: Record<string, unknown>;
      execution_mode?: ExecutionMode;
    }
  ): AutomationRecord {
    const id = `auto_${Date.now()}_${randomSuffix()}`;
    const now = new Date().toISOString();

    const record: AutomationRecord = {
      id,
      tenant_id: tenantId,
      name: payload.name,
      description: payload.description || "",
      status: "DRAFT",
      category: payload.category || "ORDER",
      trigger_type: payload.trigger_type || "EVENT",
      workflow_id: payload.workflow_id || `wf_${id}`,
      workflow_version_id: `v1_${id}`,
      enabled: false,
      execution_mode: payload.execution_mode || "PRODUCTION",
      configuration: payload.configuration || {},
      created_by: actorId,
      updated_by: actorId,
      created_at: now,
      updated_at: now,
    };

    db.createAutomation(record);

    db.createAutomationAuditLog({
      id: `aud_auto_create_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      actor_id: actorId,
      action: "AUTOMATION_CREATED",
      resource_type: "automation",
      resource_id: id,
      metadata: { name: record.name, category: record.category },
      timestamp: now,
    });

    return record;
  }

  /**
   * Installs a standard workflow template for a tenant
   */
  public static installTemplate(
    tenantId: string,
    templateId: string,
    actorId: string,
    customConfig?: Record<string, unknown>
  ): { automation: AutomationRecord; workflow: AutomationWorkflow; template: StandardWorkflowTemplate } {
    const template = STANDARD_WORKFLOW_TEMPLATES.find((t) => t.id === templateId || t.code === templateId);
    if (!template) {
      throw new AppError("NOT_FOUND", `Standard workflow template not found: ${templateId}`, 404);
    }

    const now = new Date().toISOString();
    const workflowId = `wf_${template.code.toLowerCase().replace(/[^a-z0-9]/g, "_")}_${Date.now()}`;
    const versionId = `ver_${workflowId}_v1`;

    // 1. Create Workflow Definition
    const workflow: AutomationWorkflow = {
      id: workflowId,
      tenant_id: tenantId,
      name: template.name,
      description: template.description,
      category: template.category,
      trigger: template.trigger_event || template.cron_schedule || "MANUAL",
      version: 1,
      status: "ACTIVE",
      configuration: { ...template.configuration_schema, ...customConfig },
      risk_level: template.risk_level,
      approval_requirement: template.approval_requirement,
      created_at: now,
      updated_at: now,
    };
    db.createAutomationWorkflow(workflow);

    // 2. Create Immutable Workflow Version
    const version: AutomationWorkflowVersion = {
      id: versionId,
      tenant_id: tenantId,
      workflow_id: workflowId,
      version_number: 1,
      status: "ACTIVE",
      definition: {
        template_code: template.code,
        n8n_file: template.n8n_workflow_file,
        retry_policy: template.retry_policy,
        failure_policy: template.failure_policy,
      },
      changelog: "Initial version from standard template catalog",
      created_at: now,
      activated_at: now,
    };
    db.createAutomationWorkflowVersion(version);

    // 3. Create Tenant Automation Instance
    const automationId = `auto_${Date.now()}_${randomSuffix()}`;
    const automation: AutomationRecord = {
      id: automationId,
      tenant_id: tenantId,
      name: template.name,
      description: template.description,
      status: "ACTIVE",
      category: template.category,
      trigger_type: template.trigger_type,
      workflow_id: workflowId,
      workflow_version_id: versionId,
      enabled: true,
      execution_mode: "PRODUCTION",
      configuration: { ...template.configuration_schema, ...customConfig },
      created_by: actorId,
      updated_by: actorId,
      created_at: now,
      updated_at: now,
    };
    db.createAutomation(automation);

    db.createAutomationAuditLog({
      id: `aud_install_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      actor_id: actorId,
      action: "TEMPLATE_INSTALLED",
      resource_type: "automation",
      resource_id: automationId,
      metadata: { template_code: template.code, workflow_id: workflowId },
      timestamp: now,
    });

    return { automation, workflow, template };
  }

  /**
   * Updates an automation
   */
  public static updateAutomation(
    tenantId: string,
    id: string,
    actorId: string,
    updates: Partial<AutomationRecord>
  ): AutomationRecord {
    const existing = db.findAutomationById(tenantId, id);
    if (!existing) throw new AppError("NOT_FOUND", `Automation '${id}' not found.`, 404);

    const updated = db.updateAutomation(tenantId, id, {
      ...updates,
      updated_by: actorId,
    });

    db.createAutomationAuditLog({
      id: `aud_auto_update_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      actor_id: actorId,
      action: "AUTOMATION_UPDATED",
      resource_type: "automation",
      resource_id: id,
      metadata: updates,
      timestamp: new Date().toISOString(),
    });

    return updated;
  }

  /**
   * Sets automation state (enable, disable, pause, resume)
   */
  public static setAutomationStatus(
    tenantId: string,
    id: string,
    actorId: string,
    action: "ENABLE" | "DISABLE" | "PAUSE" | "RESUME"
  ): AutomationRecord {
    const statusMap = {
      ENABLE: { status: "ACTIVE" as const, enabled: true },
      DISABLE: { status: "DISABLED" as const, enabled: false },
      PAUSE: { status: "PAUSED" as const, enabled: false },
      RESUME: { status: "ACTIVE" as const, enabled: true },
    };

    const target = statusMap[action];
    const updated = this.updateAutomation(tenantId, id, actorId, target);

    db.createAutomationAuditLog({
      id: `aud_status_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      actor_id: actorId,
      action: `AUTOMATION_${action}D`,
      resource_type: "automation",
      resource_id: id,
      metadata: { new_status: target.status },
      timestamp: new Date().toISOString(),
    });

    return updated;
  }

  /**
   * Lists standard workflow templates
   */
  public static listTemplates(category?: string): StandardWorkflowTemplate[] {
    if (category) {
      return STANDARD_WORKFLOW_TEMPLATES.filter((t) => t.category === category);
    }
    return STANDARD_WORKFLOW_TEMPLATES;
  }

  /**
   * Computes holistic health score and operational metrics for a tenant
   */
  public static getAutomationHealth(tenantId: string): AutomationHealth {
    const automations = db.getAutomations(tenantId);
    const executions = db.getAutomationExecutions(tenantId);
    const deadLetters = db.getAutomationDeadLetters(tenantId);
    const retries = db.getAutomationRetries(tenantId);
    const webhooks = db.getAutomationWebhooks(tenantId);
    const deliveries = db.getAutomationWebhookDeliveries(tenantId);

    const activeCount = automations.filter((a) => a.enabled && a.status === "ACTIVE").length;
    const totalExec = executions.length;
    // Dry runs don't call n8n, so they don't count towards success; no real runs means no rate (was a made-up 100%)
    const realRuns = executions.filter((e) => e.execution_mode !== "DRY_RUN");
    const successExec = realRuns.filter((e) => e.status === "SUCCESS").length;
    const failedExec = realRuns.filter((e) => e.status === "FAILED" || e.status === "DEAD_LETTERED").length;

    const successRate = realRuns.length > 0 ? Math.round((successExec / realRuns.length) * 100) / 100 : null;
    const failureRate = realRuns.length > 0 ? Math.round((failedExec / realRuns.length) * 100) / 100 : 0.0;

    const durations = executions.filter((e) => e.duration_ms).map((e) => e.duration_ms!);
    const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 120;

    const totalDeliveries = deliveries.length;
    const verifiedDeliveries = deliveries.filter((d) => d.status === "VERIFIED" || d.status === "PROCESSED").length;
    const webhookSuccessRate = totalDeliveries > 0 ? Math.round((verifiedDeliveries / totalDeliveries) * 100) / 100 : 1.0;

    const pendingRetries = retries.filter((r) => r.status === "PENDING").length;
    const killSwitch = AutomationSafetyService.getKillSwitchStatus(tenantId);

    let overallStatus: "HEALTHY" | "DEGRADED" | "FAILING" | "PAUSED" | "UNKNOWN" = "HEALTHY";
    if (killSwitch.isGlobalPaused || killSwitch.isTenantPaused) {
      overallStatus = "PAUSED";
    } else if (failureRate > 0.3 || deadLetters.filter((d) => d.status === "UNRESOLVED").length > 5) {
      overallStatus = "FAILING";
    } else if (failureRate > 0.1 || pendingRetries > 10) {
      overallStatus = "DEGRADED";
    }

    const providerCircuits = ProviderCircuitBreakerService.getAllProviderStates(tenantId);
    const providerHealth: Record<string, "HEALTHY" | "DEGRADED" | "UNAVAILABLE"> = {};
    for (const [p, stat] of Object.entries(providerCircuits)) {
      if (stat.state === "NORMAL") providerHealth[p] = "HEALTHY";
      else if (stat.state === "DEGRADED" || stat.state === "HALF_OPEN") providerHealth[p] = "DEGRADED";
      else providerHealth[p] = "UNAVAILABLE";
    }

    // Untracked providers used to be filled in as HEALTHY (Steadfast, Pathao, bKash, n8n) although none is integrated
    // (FX-31). They're left out; n8n reports whether it is configured at all.
    const n8nConfigured = N8nProviderService.resolveInstance(tenantId) !== null;

    const lastSuccess = executions.find((e) => e.status === "SUCCESS")?.completed_at;
    const lastFailed = executions.find((e) => e.status === "FAILED")?.completed_at;

    return {
      tenant_id: tenantId,
      overall_status: overallStatus,
      active_automations_count: activeCount,
      executions_today: totalExec,
      success_rate: successRate,
      failure_rate: failureRate,
      retry_count: pendingRetries,
      dead_letter_count: deadLetters.filter((d) => d.status === "UNRESOLVED").length,
      average_duration_ms: avgDuration,
      queue_depth: pendingRetries,
      provider_health: providerHealth,
      n8n_health: providerHealth["N8N"] ?? (n8nConfigured ? "UNKNOWN" : "NOT_CONFIGURED"),
      webhook_success_rate: webhookSuccessRate,
      last_successful_execution_at: lastSuccess,
      last_failed_execution_at: lastFailed,
      kill_switch_active: killSwitch.isGlobalPaused || killSwitch.isTenantPaused,
      kill_switch_reason: killSwitch.reason,
    };
  }
}
