/**
 * CommerceOS Phase 6: Durable Automation Retry Queue Service
 * Implements bounded retries with exponential backoff and randomized jitter,
 * failure classification (transient vs. permanent vs. unknown), and graceful DLQ transition.
 */

import { db } from "@/infrastructure/db";
import { AutomationRetry } from "@/types/automation";
import { DeadLetterService } from "./dead-letter.service";

export type FailureClassification = "TRANSIENT" | "PERMANENT" | "UNKNOWN_SECURITY";

export class RetryQueueService {
  public static readonly DEFAULT_MAX_ATTEMPTS = 3;
  public static readonly ABSOLUTE_MAX_ATTEMPTS = 5;
  private static readonly INITIAL_DELAY_MS = 1000;
  private static readonly BACKOFF_MULTIPLIER = 2;
  private static readonly JITTER_MS = 500;

  /**
   * Classifies error to ensure non-retryable errors fail-closed immediately
   */
  public static classifyFailure(statusCode?: number, errorCode?: string): FailureClassification {
    if (!statusCode && !errorCode) return "TRANSIENT";

    // Permanent HTTP errors
    if (statusCode && [400, 401, 403, 404, 422].includes(statusCode)) {
      return "PERMANENT";
    }

    // Transient HTTP errors
    if (statusCode && [408, 429, 500, 502, 503, 504].includes(statusCode)) {
      return "TRANSIENT";
    }

    // Permanent error codes
    const permanentCodes = [
      "SCHEMA_VALIDATION_FAILED",
      "AUTHENTICATION_REQUIRED",
      "FORBIDDEN",
      "INVALID_PAYLOAD",
      "RESOURCE_NOT_FOUND",
      "STATE_MACHINE_TRANSITION_INVALID",
      "INSUFFICIENT_PERMISSIONS",
      "SIGNATURE_VERIFICATION_FAILED",
    ];

    if (errorCode && permanentCodes.includes(errorCode)) {
      return "PERMANENT";
    }

    // Security failures
    if (errorCode && ["REPLAY_ATTACK", "PROMPT_INJECTION", "TAMPERED_HASH"].includes(errorCode)) {
      return "UNKNOWN_SECURITY";
    }

    return "TRANSIENT";
  }

  /**
   * Calculates exponential backoff with jitter
   */
  public static calculateDelayMs(attemptNumber: number): number {
    const base = this.INITIAL_DELAY_MS * Math.pow(this.BACKOFF_MULTIPLIER, attemptNumber - 1);
    const jitter = Math.floor(Math.random() * this.JITTER_MS);
    return Math.min(60000, base + jitter);
  }

  /**
   * Handles a failed execution step. If retryable and attempts remain, schedules retry.
   * If permanent, security-related, or attempts exhausted, routes directly to DLQ.
   */
  public static handleExecutionFailure(
    tenantId: string,
    params: {
      automationId: string;
      workflowId: string;
      executionId: string;
      event: Record<string, unknown>;
      error: { code: string; message: string };
      statusCode?: number;
      correlationId: string;
      causationId?: string;
      customMaxAttempts?: number;
    }
  ): { action: "SCHEDULED_RETRY" | "SENT_TO_DLQ" | "FAILED_PERMANENT"; delayMs?: number; retry?: AutomationRetry } {
    const classification = this.classifyFailure(params.statusCode, params.error.code);
    const maxAttempts = Math.min(
      this.ABSOLUTE_MAX_ATTEMPTS,
      params.customMaxAttempts || this.DEFAULT_MAX_ATTEMPTS
    );

    // Look for existing retry record for this execution
    const retries = db.getAutomationRetries(tenantId);
    const existingRetry = retries.find((r) => r.execution_id === params.executionId);
    const currentAttempt = existingRetry ? existingRetry.attempt_number + 1 : 1;

    // Fail closed on security or permanent business failure
    if (classification === "PERMANENT" || classification === "UNKNOWN_SECURITY") {
      DeadLetterService.enqueueDeadLetter(tenantId, {
        automationId: params.automationId,
        workflowId: params.workflowId,
        executionId: params.executionId,
        event: params.event,
        error: params.error,
        attemptCount: currentAttempt,
        correlationId: params.correlationId,
        causationId: params.causationId,
      });

      return { action: "FAILED_PERMANENT" };
    }

    // Check if attempts exhausted
    if (currentAttempt > maxAttempts) {
      if (existingRetry) {
        db.updateAutomationRetry(tenantId, existingRetry.id, {
          status: "EXHAUSTED",
          last_error: params.error.message,
        });
      }

      DeadLetterService.enqueueDeadLetter(tenantId, {
        automationId: params.automationId,
        workflowId: params.workflowId,
        executionId: params.executionId,
        event: params.event,
        error: params.error,
        attemptCount: currentAttempt,
        correlationId: params.correlationId,
        causationId: params.causationId,
      });

      return { action: "SENT_TO_DLQ" };
    }

    // Schedule next retry
    const delayMs = this.calculateDelayMs(currentAttempt);
    const nextRetryAt = new Date(Date.now() + delayMs).toISOString();

    let retryRecord: AutomationRetry;
    if (existingRetry) {
      retryRecord = db.updateAutomationRetry(tenantId, existingRetry.id, {
        attempt_number: currentAttempt,
        next_retry_at: nextRetryAt,
        delay_ms: delayMs,
        last_error: params.error.message,
        error_code: params.error.code,
        status: "PENDING",
      });
    } else {
      retryRecord = {
        id: `ret_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        tenant_id: tenantId,
        automation_id: params.automationId,
        execution_id: params.executionId,
        attempt_number: currentAttempt,
        max_attempts: maxAttempts,
        next_retry_at: nextRetryAt,
        delay_ms: delayMs,
        error_code: params.error.code,
        last_error: params.error.message,
        status: "PENDING",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      db.createAutomationRetry(retryRecord);
    }

    // Update execution status to RETRYING
    try {
      db.updateAutomationExecution(tenantId, params.executionId, {
        status: "RETRYING",
        error_code: params.error.code,
        error_message_reference: params.error.message,
      });
    } catch {
      // Ignore
    }

    return {
      action: "SCHEDULED_RETRY",
      delayMs,
      retry: retryRecord,
    };
  }
}
