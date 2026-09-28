import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 6: n8n Provider Adapter Service
 * Manages external HTTP webhook invocation to n8n instances, propagates tenant,
 * correlation, and idempotency headers, handles circuit breaker status, and records
 * step-level telemetry.
 */

import { db } from "@/infrastructure/db";
import {
  AutomationExecution,
  AutomationExecutionStep,
  ExecutionMode,
  N8nInstance,
} from "@/types/automation";
import { ProviderCircuitBreakerService } from "./provider-circuit-breaker.service";
import { AutomationSafetyService } from "./automation-safety.service";
import { RetryQueueService } from "./retry-queue.service";

export interface N8nInvokeParams {
  tenantId: string;
  automationId: string;
  workflowId: string;
  workflowVersionId: string;
  n8nInstanceId?: string;
  webhookPath: string;
  event: Record<string, unknown>;
  correlationId: string;
  causationId?: string;
  idempotencyKey: string;
  executionMode?: ExecutionMode;
}

export interface N8nInvokeResult {
  execution: AutomationExecution;
  success: boolean;
  statusCode?: number;
  responseBody?: Record<string, unknown>;
  error?: string;
}

export class N8nProviderService {
  private static readonly REQUEST_TIMEOUT_MS = 10000;

  /**
   * Resolves target n8n instance for tenant
   */
  public static resolveInstance(tenantId: string, instanceId?: string): N8nInstance {
    if (instanceId) {
      const inst = db.findN8nInstanceById(tenantId, instanceId);
      if (inst) return inst;
    }

    const instances = db.getN8nInstances(tenantId);
    const active = instances.find((i) => i.status === "ACTIVE");
    if (active) return active;

    // Default development/fallback instance reference
    return {
      id: `n8n_default_${tenantId}`,
      tenant_id: tenantId,
      name: "Default CommerceOS n8n Cluster",
      base_url: process.env.N8N_HOST || process.env.COMMERCEOS_N8N_BASE_URL || "http://localhost:5678",
      environment: "PRODUCTION",
      status: "ACTIVE",
      health_status: "HEALTHY",
      credential_reference: "COMMERCEOS_N8N_API_KEY",
      workflow_namespace: "commerceos",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  /**
   * Invokes an n8n workflow webhook endpoint
   */
  public static async invokeWorkflow(params: N8nInvokeParams): Promise<N8nInvokeResult> {
    const executionMode = params.executionMode || "PRODUCTION";
    const executionId = `exec_${Date.now()}_${randomSuffix()}`;
    const startTime = Date.now();

    // 1. Check emergency kill switch
    const killCheck = AutomationSafetyService.isHaltedByKillSwitch(
      params.tenantId,
      params.workflowId,
      "N8N"
    );
    if (killCheck.isHalted) {
      const execution: AutomationExecution = {
        id: executionId,
        tenant_id: params.tenantId,
        automation_id: params.automationId,
        workflow_version_id: params.workflowVersionId,
        status: "CANCELLED",
        execution_mode: executionMode,
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: 0,
        error_code: "KILL_SWITCH_HALTED",
        error_message_reference: killCheck.reason,
        correlation_id: params.correlationId,
        causation_id: params.causationId,
        idempotency_key: params.idempotencyKey,
        created_at: new Date(startTime).toISOString(),
      };
      db.createAutomationExecution(execution);
      return { execution, success: false, error: killCheck.reason };
    }

    // 2. Resolve n8n instance and verify circuit breaker
    const instance = this.resolveInstance(params.tenantId, params.n8nInstanceId);
    if (!ProviderCircuitBreakerService.canExecute(params.tenantId, "N8N")) {
      const errorMsg = "n8n Provider circuit breaker is OPEN. Deferring workflow invocation.";
      const execution: AutomationExecution = {
        id: executionId,
        tenant_id: params.tenantId,
        automation_id: params.automationId,
        workflow_version_id: params.workflowVersionId,
        status: "QUEUED",
        execution_mode: executionMode,
        started_at: new Date(startTime).toISOString(),
        duration_ms: 0,
        error_code: "CIRCUIT_BREAKER_OPEN",
        error_message_reference: errorMsg,
        correlation_id: params.correlationId,
        causation_id: params.causationId,
        idempotency_key: params.idempotencyKey,
        created_at: new Date(startTime).toISOString(),
      };
      db.createAutomationExecution(execution);

      RetryQueueService.handleExecutionFailure(params.tenantId, {
        automationId: params.automationId,
        workflowId: params.workflowId,
        executionId,
        event: params.event,
        error: { code: "CIRCUIT_BREAKER_OPEN", message: errorMsg },
        statusCode: 503,
        correlationId: params.correlationId,
        causationId: params.causationId,
      });

      return { execution, success: false, statusCode: 503, error: errorMsg };
    }

    // 3. Create initial execution record
    const execution: AutomationExecution = {
      id: executionId,
      tenant_id: params.tenantId,
      automation_id: params.automationId,
      workflow_version_id: params.workflowVersionId,
      status: "RUNNING",
      execution_mode: executionMode,
      started_at: new Date(startTime).toISOString(),
      correlation_id: params.correlationId,
      causation_id: params.causationId,
      idempotency_key: params.idempotencyKey,
      created_at: new Date(startTime).toISOString(),
    };
    db.createAutomationExecution(execution);

    // Step 1 Telemetry: Webhook Trigger Dispatched
    const triggerStep: AutomationExecutionStep = {
      id: `step_${executionId}_1`,
      execution_id: executionId,
      step_name: "Trigger n8n Webhook",
      step_type: "TRIGGER",
      status: "RUNNING",
      started_at: new Date().toISOString(),
      provider: "N8N",
    };
    db.createAutomationExecutionStep(triggerStep);

    // 4. Handle DRY_RUN mode (Simulation with zero irreversible side effects)
    if (executionMode === "DRY_RUN") {
      const duration = Date.now() - startTime;
      db.updateAutomationExecutionStep(triggerStep.id, {
        status: "SUCCESS",
        completed_at: new Date().toISOString(),
        duration_ms: duration,
        metadata: { dry_run: true, simulated: true },
      });

      const updatedExec = db.updateAutomationExecution(params.tenantId, executionId, {
        status: "SUCCESS",
        completed_at: new Date().toISOString(),
        duration_ms: duration,
        output_result_reference: JSON.stringify({ dry_run: true, simulated: true }),
      });

      return {
        execution: updatedExec,
        success: true,
        statusCode: 200,
        // n8n was not called; nothing here was verified by n8n (FX-31)
        responseBody: { dry_run: true, simulated: true, message: "Dry run: n8n was not called." },
      };
    }

    // 5. Real invocation. There used to be a "mock" branch here: any localhost or example.com URL (including the
    // localhost default used when no n8n is configured) returned success without a request (FX-31).
    try {
      const targetUrl = `${instance.base_url.replace(/\/$/, "")}/webhook/${params.webhookPath.replace(/^\//, "")}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT_MS);

      const res = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant-ID": params.tenantId,
          "X-Correlation-ID": params.correlationId,
          "X-Causation-ID": params.causationId || "",
          "Idempotency-Key": params.idempotencyKey,
          "X-Execution-Mode": executionMode,
        },
        body: JSON.stringify({
          event: params.event,
          correlation_id: params.correlationId,
          causation_id: params.causationId,
          idempotency_key: params.idempotencyKey,
          timestamp: new Date().toISOString(),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`n8n responded with HTTP ${res.status}: ${res.statusText}`);
      }

      const responseBody = (await res.json().catch(() => ({}))) as Record<string, unknown>;

      const duration = Date.now() - startTime;
      ProviderCircuitBreakerService.recordSuccess(params.tenantId, "N8N");

      db.updateAutomationExecutionStep(triggerStep.id, {
        status: "SUCCESS",
        completed_at: new Date().toISOString(),
        duration_ms: duration,
        metadata: { response: responseBody },
      });

      const completedExecution = db.updateAutomationExecution(params.tenantId, executionId, {
        status: "SUCCESS",
        completed_at: new Date().toISOString(),
        duration_ms: duration,
        output_result_reference: JSON.stringify(responseBody),
      });

      return {
        execution: completedExecution,
        success: true,
        statusCode: 200,
        responseBody,
      };
    } catch (err) {
      const duration = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : "n8n invocation failed";
      ProviderCircuitBreakerService.recordFailure(params.tenantId, "N8N");

      db.updateAutomationExecutionStep(triggerStep.id, {
        status: "FAILED",
        completed_at: new Date().toISOString(),
        duration_ms: duration,
        error_code: "N8N_INVOCATION_FAILED",
        metadata: { error: errorMsg },
      });

      const failedExecution = db.updateAutomationExecution(params.tenantId, executionId, {
        status: "FAILED",
        completed_at: new Date().toISOString(),
        duration_ms: duration,
        error_code: "N8N_INVOCATION_FAILED",
        error_message_reference: errorMsg,
      });

      // Schedule bounded retry or send to DLQ
      RetryQueueService.handleExecutionFailure(params.tenantId, {
        automationId: params.automationId,
        workflowId: params.workflowId,
        executionId,
        event: params.event,
        error: { code: "N8N_INVOCATION_FAILED", message: errorMsg },
        statusCode: 502,
        correlationId: params.correlationId,
        causationId: params.causationId,
      });

      return {
        execution: failedExecution,
        success: false,
        statusCode: 502,
        error: errorMsg,
      };
    }
  }
}
