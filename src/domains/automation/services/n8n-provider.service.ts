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
import { OutboundBlockedError, OutboundTimeoutError, outboundRequest } from "@/lib/outbound-http";
import { signOutbound } from "@/lib/outbound-signing";
import { logger } from "@/lib/logger";

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

/** An n8n call that answered with an error status (the tenant sees only the status). */
class N8nHttpError extends Error {
  constructor(readonly status: number) {
    super(`n8n responded with HTTP ${status}`);
  }
}

export class N8nProviderService {
  private static readonly REQUEST_TIMEOUT_MS = 10000;
  private static warnedUnsigned = false;

  /** The deployment's own instance (from N8N_HOST): its URL is platform configuration, not tenant data. */
  private static isEnvironmentInstance(instance: N8nInstance): boolean {
    const envUrl = process.env.N8N_HOST || process.env.COMMERCEOS_N8N_BASE_URL;
    return instance.id.startsWith("n8n_env_") && !!envUrl && instance.base_url === envUrl;
  }

  /**
   * Resolves target n8n instance for tenant
   */
  public static resolveInstance(tenantId: string, instanceId?: string): N8nInstance | null {
    if (instanceId) {
      const inst = db.findN8nInstanceById(tenantId, instanceId);
      if (inst) return inst;
    }

    const instances = db.getN8nInstances(tenantId);
    const active = instances.find((i) => i.status === "ACTIVE");
    if (active) return active;

    // An instance configured by environment for the whole deployment. Without one there is no n8n to call: this used
    // to fall back to http://localhost:5678, which the removed mock branch then reported as a success (FX-31).
    const baseUrl = process.env.N8N_HOST || process.env.COMMERCEOS_N8N_BASE_URL;
    if (!baseUrl) return null;
    return {
      id: `n8n_env_${tenantId}`,
      tenant_id: tenantId,
      name: "CommerceOS n8n (environment)",
      base_url: baseUrl,
      environment: "PRODUCTION",
      status: "ACTIVE",
      health_status: "UNKNOWN",
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
    if (!instance && executionMode !== "DRY_RUN") {
      const execution: AutomationExecution = {
        id: executionId,
        tenant_id: params.tenantId,
        automation_id: params.automationId,
        workflow_version_id: params.workflowVersionId,
        status: "FAILED",
        execution_mode: executionMode,
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: 0,
        error_code: "N8N_NOT_CONFIGURED",
        error_message_reference: "No n8n instance is configured; nothing was sent.",
        correlation_id: params.correlationId,
        causation_id: params.causationId,
        idempotency_key: params.idempotencyKey,
        created_at: new Date(startTime).toISOString(),
      };
      db.createAutomationExecution(execution);
      return { execution, success: false, statusCode: 424, error: "No n8n instance is configured; nothing was sent." };
    }
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
      if (!instance) throw new Error("No n8n instance is configured");
      const targetUrl = `${instance.base_url.replace(/\/$/, "")}/webhook/${params.webhookPath.replace(/^\//, "")}`;
      const body = JSON.stringify({
        event: params.event,
        correlation_id: params.correlationId,
        causation_id: params.causationId,
        idempotency_key: params.idempotencyKey,
        timestamp: new Date().toISOString(),
      });
      // Signed so the n8n Webhook node can refuse forged calls (FX-55); see n8n/deployment/import.md
      const secret = process.env.COMMERCEOS_N8N_WEBHOOK_SECRET;
      if (!secret && !this.warnedUnsigned) {
        this.warnedUnsigned = true;
        logger.warn("n8n.calls_unsigned", { reason: "COMMERCEOS_N8N_WEBHOOK_SECRET is not set" });
      }

      // The deployment's own n8n (N8N_HOST) may be a local server; a stored instance URL gets the full SSRF guard (M17)
      const res = await outboundRequest(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant-ID": params.tenantId,
          "X-Correlation-ID": params.correlationId,
          "X-Causation-ID": params.causationId || "",
          "Idempotency-Key": params.idempotencyKey,
          "X-Execution-Mode": executionMode,
          ...(secret ? signOutbound(secret, body) : {}),
        },
        body,
        timeoutMs: this.REQUEST_TIMEOUT_MS,
        platformConfigured: this.isEnvironmentInstance(instance),
      });

      if (res.status < 200 || res.status >= 300) throw new N8nHttpError(res.status);

      let responseBody: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(res.body);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) responseBody = parsed as Record<string, unknown>;
      } catch {
        // not JSON: an empty result
      }

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
      // Tenants see a generic reason: network errors name internal hosts and ports (Phase 3 security review F3)
      const errorMsg =
        err instanceof N8nHttpError
          ? err.message
          : err instanceof OutboundBlockedError
            ? "the n8n address is not allowed"
            : err instanceof OutboundTimeoutError
              ? "n8n did not answer in time"
              : "n8n could not be reached";
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
