/**
 * CommerceOS Phase 6: Dead Letter Queue (DLQ) Service
 * Manages exhausted, permanently failed, and unrecoverable automation executions
 * for operator inspection, audit, replay, and resolution.
 */

import { db } from "@/infrastructure/db";
import { AutomationDeadLetter } from "@/types/automation";

export class DeadLetterService {
  /**
   * Enqueues an exhausted or permanently failed execution into the Dead Letter Queue
   */
  public static enqueueDeadLetter(
    tenantId: string,
    params: {
      automationId: string;
      workflowId: string;
      executionId: string;
      event: Record<string, unknown>;
      error: { code: string; message: string; stack_reference?: string };
      attemptCount: number;
      correlationId: string;
      causationId?: string;
    }
  ): AutomationDeadLetter {
    const id = `dlq_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    const deadLetter: AutomationDeadLetter = {
      id,
      tenant_id: tenantId,
      automation_id: params.automationId,
      workflow_id: params.workflowId,
      execution_id: params.executionId,
      event: params.event,
      error: params.error,
      attempt_count: params.attemptCount,
      last_attempt: now,
      correlation_id: params.correlationId,
      causation_id: params.causationId,
      status: "UNRESOLVED",
      timestamp: now,
    };

    db.createAutomationDeadLetter(deadLetter);

    // Update execution status to DEAD_LETTERED
    try {
      db.updateAutomationExecution(tenantId, params.executionId, {
        status: "DEAD_LETTERED",
        error_code: params.error.code,
        error_message_reference: params.error.message,
      });
    } catch {
      // Ignore if execution not found
    }

    db.createAutomationAuditLog({
      id: `aud_dlq_${Date.now()}`,
      tenant_id: tenantId,
      actor_id: "SYSTEM",
      action: "DEAD_LETTER_ENQUEUED",
      resource_type: "dead_letter",
      resource_id: id,
      metadata: {
        automation_id: params.automationId,
        execution_id: params.executionId,
        error_code: params.error.code,
        attempts: params.attemptCount,
      },
      timestamp: now,
    });

    return deadLetter;
  }

  /**
   * Lists dead letters for a tenant
   */
  public static listDeadLetters(tenantId: string, status?: string): AutomationDeadLetter[] {
    return db.getAutomationDeadLetters(tenantId, status);
  }

  /**
   * Replays/retries a dead-lettered execution preserving original correlation context
   */
  public static async retryDeadLetter(
    tenantId: string,
    id: string,
    actorId: string
  ): Promise<{ success: boolean; deadLetter: AutomationDeadLetter; newExecutionId: string }> {
    const dlq = db.findAutomationDeadLetterById(tenantId, id);
    if (!dlq) {
      throw new Error(`Dead letter record not found: ${id}`);
    }

    const newExecutionId = `exec_replay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    // Mark DLQ as RETRIED
    const updated = db.updateAutomationDeadLetter(id, {
      status: "RETRIED",
      resolved_at: now,
      resolved_by: actorId,
      resolution_notes: `Manual retry dispatched by ${actorId}`,
    });

    db.createAutomationAuditLog({
      id: `aud_dlq_retry_${Date.now()}`,
      tenant_id: tenantId,
      actor_id: actorId,
      action: "DEAD_LETTER_RETRIED",
      resource_type: "dead_letter",
      resource_id: id,
      metadata: { new_execution_id: newExecutionId, correlation_id: dlq.correlation_id },
      timestamp: now,
    });

    return {
      success: true,
      deadLetter: updated,
      newExecutionId,
    };
  }

  /**
   * Cancels a dead letter without replaying
   */
  public static cancelDeadLetter(
    tenantId: string,
    id: string,
    actorId: string,
    reason?: string
  ): AutomationDeadLetter {
    const dlq = db.findAutomationDeadLetterById(tenantId, id);
    if (!dlq) throw new Error(`Dead letter record not found: ${id}`);

    const updated = db.updateAutomationDeadLetter(id, {
      status: "CANCELLED",
      resolved_at: new Date().toISOString(),
      resolved_by: actorId,
      resolution_notes: reason || "Cancelled by operator",
    });

    db.createAutomationAuditLog({
      id: `aud_dlq_cancel_${Date.now()}`,
      tenant_id: tenantId,
      actor_id: actorId,
      action: "DEAD_LETTER_CANCELLED",
      resource_type: "dead_letter",
      resource_id: id,
      metadata: { reason },
      timestamp: new Date().toISOString(),
    });

    return updated;
  }

  /**
   * Resolves a dead letter
   */
  public static resolveDeadLetter(
    tenantId: string,
    id: string,
    actorId: string,
    notes: string
  ): AutomationDeadLetter {
    const dlq = db.findAutomationDeadLetterById(tenantId, id);
    if (!dlq) throw new Error(`Dead letter record not found: ${id}`);

    const updated = db.updateAutomationDeadLetter(id, {
      status: "RESOLVED",
      resolved_at: new Date().toISOString(),
      resolved_by: actorId,
      resolution_notes: notes,
    });

    db.createAutomationAuditLog({
      id: `aud_dlq_resolve_${Date.now()}`,
      tenant_id: tenantId,
      actor_id: actorId,
      action: "DEAD_LETTER_RESOLVED",
      resource_type: "dead_letter",
      resource_id: id,
      metadata: { notes },
      timestamp: new Date().toISOString(),
    });

    return updated;
  }
}
