import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 6: Automation Router Service
 * Subscribes to canonical commerce events, evaluates tenant automation triggers,
 * performs safety and loop checks, and dispatches tasks to n8n.
 */

import { db } from "@/infrastructure/db";
import { CommerceEvent } from "@/types/commerce";
import { N8nProviderService } from "./n8n-provider.service";
import { AutomationSafetyService } from "./automation-safety.service";

export interface RoutedExecutionSummary {
  automationId: string;
  workflowId: string;
  executionId: string;
  status: string;
  success: boolean;
}

export class AutomationRouterService {
  /**
   * Routes an incoming canonical domain event to all matching active automations for the tenant
   */
  public static async routeEvent(
    event: CommerceEvent,
    options?: { executionMode?: "DRY_RUN" | "TEST" | "PRODUCTION"; ancestorEventIds?: string[] }
  ): Promise<RoutedExecutionSummary[]> {
    const tenantId = event.tenant_id;
    const automations = db.getAutomations(tenantId);
    const results: RoutedExecutionSummary[] = [];

    // Filter active automations that match this event type
    const matchingAutomations = automations.filter((a) => {
      if (!a.enabled || a.status !== "ACTIVE") return false;
      const workflow = db.findAutomationWorkflowById(tenantId, a.workflow_id);
      if (!workflow) return false;
      return workflow.trigger === event.type || a.trigger_type === "EVENT";
    });

    for (const automation of matchingAutomations) {
      const workflow = db.findAutomationWorkflowById(tenantId, automation.workflow_id);
      if (!workflow) continue;

      // 1. Loop Protection check
      const loopCheck = AutomationSafetyService.checkLoopProtection(
        event.id,
        (event as any).causation_id,
        options?.ancestorEventIds || []
      );

      if (!loopCheck.isSafe) {
        db.createAutomationAuditLog({
          id: `aud_loop_${Date.now()}_${randomSuffix()}`,
          tenant_id: tenantId,
          actor_id: "SYSTEM",
          action: "LOOP_PROTECTION_TRIGGERED",
          resource_type: "automation",
          resource_id: automation.id,
          metadata: { reason: loopCheck.reason, event_id: event.id },
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      // 2. Kill switch check
      const killCheck = AutomationSafetyService.isHaltedByKillSwitch(tenantId, workflow.id);
      if (killCheck.isHalted) {
        continue;
      }

      // 3. Dispatch to n8n Provider
      const correlationId = (event as any).correlation_id || event.aggregate_id;
      const causationId = event.id;
      const idempotencyKey = `auto_exec_${automation.id}_${event.id}`;
      const webhookPath = workflow.n8n_workflow_id || `commerceos-${event.type.replace(/\./g, "-")}`;

      const invokeResult = await N8nProviderService.invokeWorkflow({
        tenantId,
        automationId: automation.id,
        workflowId: workflow.id,
        workflowVersionId: automation.workflow_version_id,
        n8nInstanceId: automation.n8n_instance_id,
        webhookPath,
        event: {
          id: event.id,
          type: event.type,
          version: event.version,
          tenant_id: event.tenant_id,
          aggregate_type: event.aggregate_type,
          aggregate_id: event.aggregate_id,
          actor_id: event.actor_id,
          correlation_id: correlationId,
          causation_id: causationId,
          timestamp: event.timestamp,
          payload: event.payload,
        },
        correlationId,
        causationId,
        idempotencyKey,
        executionMode: options?.executionMode || automation.execution_mode || "PRODUCTION",
      });

      results.push({
        automationId: automation.id,
        workflowId: workflow.id,
        executionId: invokeResult.execution.id,
        status: invokeResult.execution.status,
        success: invokeResult.success,
      });
    }

    return results;
  }
}
