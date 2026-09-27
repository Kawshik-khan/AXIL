import {
  ApprovalRequest,
  ApprovalStatus,
  TaskStatus,
  WorkflowStatus,
} from '@/types/orchestration';
import { db } from '@/infrastructure/db';
import { workflowEngine } from '../engine/workflow-engine';

export interface ApprovalResolutionResult {
  success: boolean;
  approval: ApprovalRequest;
  stale?: boolean;
  reason?: string;
}

export class ApprovalEngine {
  /**
   * Approves a pending action with mandatory pre-execution entity state revalidation.
   */
  public async approveAction(
    approvalId: string,
    approvedBy: string
  ): Promise<ApprovalResolutionResult> {
    const approval = db.getApprovalRequestById(approvalId);
    if (!approval) {
      throw new Error(`Approval request not found: ${approvalId}`);
    }

    if (approval.status !== ApprovalStatus.PENDING) {
      return {
        success: false,
        approval,
        reason: `Approval request is already in status: ${approval.status}`,
      };
    }

    // 1. Expiration check
    if (new Date() > new Date(approval.expires_at)) {
      const expired = db.updateApprovalRequest(approvalId, {
        status: ApprovalStatus.EXPIRED,
      });
      return {
        success: false,
        approval: expired,
        reason: 'Approval request has expired.',
      };
    }

    // 2. Pre-Execution Entity State Revalidation
    const isStale = this.checkEntityStaleness(approval);
    if (isStale.stale) {
      const staleApproval = db.updateApprovalRequest(approvalId, {
        status: ApprovalStatus.REJECTED,
        rejected_by: "SYSTEM_VALIDATOR",
        rejected_at: new Date().toISOString(),
        rejection_reason: `Stale state detected: ${isStale.reason}`,
      });

      // Fail or cancel associated task due to stale concurrency if it exists
      const associatedTask = db.getTaskById(approval.task_id);
      if (associatedTask) {
        db.updateTask(approval.task_id, {
          status: TaskStatus.FAILED,
          error: `Stale state rejection: ${isStale.reason}`,
        });
      }

      return {
        success: false,
        approval: staleApproval,
        stale: true,
        reason: isStale.reason,
      };
    }

    // 3. Mark Approved
    const approved = db.updateApprovalRequest(approvalId, {
      status: ApprovalStatus.APPROVED,
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
    });

    // 4. Update task to READY or RUNNING and resume workflow
    const task = db.getTaskById(approval.task_id);
    if (task) {
      db.updateTask(task.id, {
        status: TaskStatus.READY,
        approval_id: approval.id,
      });

      const workflow = db.getWorkflowById(approval.workflow_id);
      if (workflow && workflow.status === WorkflowStatus.WAITING) {
        // Automatically resume workflow execution asynchronously
        workflowEngine.resumeWorkflow(workflow.id).catch((err) => {
          console.error(`Error resuming workflow ${workflow.id}:`, err);
        });
      }
    }

    return {
      success: true,
      approval: approved,
    };
  }

  /**
   * Rejects an approval request with explicit operator reason
   */
  public async rejectAction(
    approvalId: string,
    rejectedBy: string,
    reason: string
  ): Promise<ApprovalResolutionResult> {
    const approval = db.getApprovalRequestById(approvalId);
    if (!approval) {
      throw new Error(`Approval request not found: ${approvalId}`);
    }

    const rejected = db.updateApprovalRequest(approvalId, {
      status: ApprovalStatus.REJECTED,
      rejected_by: rejectedBy,
      rejected_at: new Date().toISOString(),
      rejection_reason: reason,
    });

    // Cancel or fail the task
    const task = db.getTaskById(approval.task_id);
    if (task) {
      db.updateTask(task.id, {
        status: TaskStatus.CANCELLED,
        error: `Rejected by operator (${rejectedBy}): ${reason}`,
      });
    }

    return {
      success: true,
      approval: rejected,
    };
  }

  /**
   * Validates whether target entity was altered between planning time and approval time.
   */
  private checkEntityStaleness(approval: ApprovalRequest): {
    stale: boolean;
    reason?: string;
  } {
    const tenantId = approval.tenant_id;
    const snapshot = approval.entity_state_snapshot || {};

    if (approval.target_entity_type === "ORDER") {
      const order = db.findOrderById(tenantId, approval.target_entity_id);
      if (!order) {
        return { stale: true, reason: "Target order no longer exists." };
      }

      // If planning snapshot recorded order status, ensure it hasn't mutated
      if (snapshot.order_status && snapshot.order_status !== order.status) {
        return {
          stale: true,
          reason: `Order status changed from ${snapshot.order_status} to ${order.status}`,
        };
      }

      // If planning snapshot recorded payment status
      if (snapshot.payment_status && snapshot.payment_status !== order.payment_status) {
        return {
          stale: true,
          reason: `Order payment status changed from ${snapshot.payment_status} to ${order.payment_status}`,
        };
      }
    }

    return { stale: false };
  }
}

export const approvalEngine = new ApprovalEngine();
